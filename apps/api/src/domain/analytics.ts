/**
 * 洞察分析计算引擎（A3）。
 *
 * 口径来源：`docs/ANALYTICS.md`（唯一统计口径，逐字段对齐 §1 分桶 / §2 通用结构 /
 * §3 模板洞察 / §4 字段类型产物 / §5 全局概览 / §6 CSV / §7 实现约束）。
 * 接口契约：`docs/SPEC.md` §5（数据模型）、§6（字段类型）、§8.4（分析 API）、§9.7（性能）。
 *
 * 设计要点：
 * - **取数只做常数次 SQL**：区间内的 memo 一次查完，随后全部内存计算，禁止 N+1；
 * - 分日/分桶/分位数/标准差/直方图全部复用 `packages/shared/src/stats.ts` 与
 *   `apps/api/src/lib/time.ts`，不另起口径；
 * - 输出统一经 `toJsonSafe()` 收尾：`NaN`/`Infinity` → `null`、`undefined` 剔除、
 *   `BigInt` → `number`、`Date` → ISO 字符串，保证 JSON 可序列化。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { FieldDefinition, FieldType, FieldValue } from '@flomo/shared';
import {
  buildHistogram,
  charLength,
  countBy,
  effectiveCurrency,
  effectiveScale,
  iqr,
  isFieldValueEmpty,
  maxOf,
  mean,
  median,
  minOf,
  optionLabelOf,
  percentile,
  rangeOf,
  roundTo,
  sortAscending,
  stddevSample,
  streaks,
  sum,
  topCounts,
  type Histogram,
} from '@flomo/shared';
import { notFound, validationError } from '../lib/errors.js';
import {
  addDaysToDayKey,
  dayKeyDiff,
  enumerateDayKeys,
  formatLocalDayTime,
  localDayKeyOf,
  localHourOf,
  monthKeyOf,
  normalizeRange,
  parseIsoToEpochMs,
  toZonedIso,
  weekdayOf,
  weekStartDayKey,
} from '../lib/time.js';

/* -------------------------------------------------------------------------- */
/* 类型定义                                                                    */
/* -------------------------------------------------------------------------- */

/** 时间粒度（ANALYTICS §1） */
export type Granularity = 'day' | 'week' | 'month';

/** 归一化后的区间（ANALYTICS §2） */
export interface RangeInfo {
  from: string;
  to: string;
  timezone: string;
  days: number;
  granularity: Granularity;
  label: string;
}

/** 趋势/时间线的单个数据点（ANALYTICS §3） */
export interface TimelinePoint {
  bucket: string;
  label: string;
  count: number;
  chars: number;
}

export interface Timeline {
  granularity: Granularity;
  points: TimelinePoint[];
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface Heatmap {
  max: number;
  days: HeatmapDay[];
}

export interface WeekdayBucket {
  weekday: number;
  label: string;
  count: number;
}

export interface WeekdayStats {
  buckets: WeekdayBucket[];
}

export interface HourBucket {
  hour: number;
  count: number;
}

export interface HourOfDayStats {
  buckets: HourBucket[];
}

export interface TagStat {
  tag: string;
  count: number;
  share: number;
}

export interface OutlierInfo {
  method: 'iqr';
  lower: number;
  upper: number;
  count: number;
}

/** 数值统计（ANALYTICS §4.1） */
export interface NumericStats {
  count: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  stddev: number;
  range: number;
  histogram: Histogram;
  outliers: OutlierInfo;
}

export interface NumericTrendPoint {
  bucket: string;
  label: string;
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
}

export interface NumericTrend {
  granularity: Granularity;
  points: NumericTrendPoint[];
}

/** 选择型分布条目（ANALYTICS §4.2） */
export interface DistributionEntry {
  value: string | number;
  label: string;
  count: number;
  share: number;
}

/** 布尔统计（ANALYTICS §4.3） */
export interface BooleanInsight {
  trueCount: number;
  falseCount: number;
  trueRatio: number;
}

/** 日期/日期时间统计（ANALYTICS §4.4） */
export interface DateStats {
  min: string | null;
  max: string | null;
  spanDays: number;
  byMonth: Array<{ bucket: string; count: number }>;
  byWeekday: Array<{ weekday: number; count: number }>;
  byHour?: Array<{ hour: number; count: number }>;
}

/** 文本直方图（ANALYTICS §4.5 示例仅含 from/to/count） */
export interface TextHistogram {
  binCount: number;
  binWidth: number;
  bins: Array<{ from: number; to: number; count: number }>;
}

export interface TextStats {
  totalChars: number;
  avgChars: number;
  minChars: number;
  maxChars: number;
  medianChars: number;
  histogram: TextHistogram;
  topWords: Array<{ word: string; count: number }>;
  topWordsNote: string;
}

/** 链接统计（ANALYTICS §4.6） */
export interface UrlStats {
  distinctDomains: Array<{ domain: string; count: number }>;
  distinctCount: number;
  httpsRatio: number;
}

/**
 * 单个字段的统计产物（ANALYTICS §4）。
 * 公共字段恒在；类型专属键仅在对应类型出现（`numeric`/`trend` 在无值时显式为 `null`）。
 */
export interface TemplateFieldInsight {
  key: string;
  label: string;
  type: FieldType;
  filled: number;
  missing: number;
  fillRatio: number;
  valueUnion: string[] | null;
  numeric?: NumericStats | null;
  trend?: NumericTrend | null;
  currency?: string;
  unit?: string;
  scale?: number;
  distribution?: DistributionEntry[];
  boolean?: BooleanInsight;
  date?: DateStats;
  text?: TextStats;
  url?: UrlStats;
}

export interface FieldFillRate {
  key: string;
  label: string;
  filled: number;
  missing: number;
  ratio: number;
}

export interface TemplateSummary {
  memoCount: number;
  allMemoCount: number;
  shareOfAllMemos: number;
  totalChars: number;
  avgChars: number;
  memosWithContent: number;
  activeDays: number;
  dayCoverage: number;
  longestStreak: number;
  currentStreak: number;
  busiestDay: { date: string; count: number } | null;
  firstMemoAt: string | null;
  lastMemoAt: string | null;
  fieldFillRate: FieldFillRate[];
}

export interface TemplateHeader {
  id: string;
  name: string;
  icon: string;
  color: string;
  fields: FieldDefinition[];
}

/** CSV 导出所需的原始行（内部字段，HTTP 响应会剔除） */
export interface CsvRow {
  createdAt: string;
  content: string;
  tags: string[];
  values: Record<string, unknown>;
}

/** `GET /api/analytics/templates/:id/insights` 响应体（ANALYTICS §3） */
export interface TemplateInsights {
  template: TemplateHeader;
  range: RangeInfo;
  generatedAt: string;
  tookMs: number;
  summary: TemplateSummary;
  timeline: Timeline;
  heatmap: Heatmap;
  weekday: WeekdayStats;
  hourOfDay: HourOfDayStats;
  tags: TagStat[];
  fields: TemplateFieldInsight[];
  /** 内部字段：仅供 `buildInsightsCsv()` 使用，路由序列化前必须剔除 */
  csvRows: CsvRow[];
}

export interface OverviewByTemplate {
  templateId: string | null;
  templateName: string;
  icon: string;
  count: number;
  share: number;
}

export interface OverviewNumericField {
  templateId: string;
  templateName: string;
  key: string;
  label: string;
  type: FieldType;
  currency?: string;
  unit?: string;
  scale?: number;
  count: number;
  sum: number;
  mean: number;
  median: number;
  max: number;
}

export interface OverviewSummary {
  memoCount: number;
  templateCount: number;
  byTemplate: OverviewByTemplate[];
  totalChars: number;
  avgChars: number;
  activeDays: number;
  dayCoverage: number;
  longestStreak: number;
  currentStreak: number;
}

/** `GET /api/analytics/overview` 响应体（ANALYTICS §5） */
export interface OverviewInsights {
  range: RangeInfo;
  generatedAt: string;
  tookMs: number;
  summary: OverviewSummary;
  timeline: Timeline;
  heatmap: Heatmap;
  weekday: WeekdayStats;
  hourOfDay: HourOfDayStats;
  tags: TagStat[];
  numericFields: OverviewNumericField[];
}

/** 模板洞察入参 */
export interface InsightQuery {
  userId: string;
  templateId: string;
  from?: string | null;
  to?: string | null;
  granularity?: 'day' | 'week' | 'month' | null;
  /** 参考「现在」（毫秒），仅用于确定性测试 */
  now?: number;
}

/** 全局概览入参 */
export interface OverviewQuery {
  userId: string;
  from?: string | null;
  to?: string | null;
  granularity?: string | null;
  /** 参考「现在」（毫秒），仅用于确定性测试 */
  now?: number;
}

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** ANALYTICS §1：自动粒度阈值 */
const GRANULARITY_DAY_MAX_DAYS = 62;
const GRANULARITY_WEEK_MAX_DAYS = 730;

/** ANALYTICS §3：标签 Top 20；§4.6 域名 Top 15；§4.5 词 Top 15 */
const TOP_TAGS = 20;
const TOP_DOMAINS = 15;
const TOP_WORDS = 15;

/** ANALYTICS §4.5 固定的分词说明文案 */
const TOP_WORDS_NOTE = '中文按 2-gram、英文/数字按词切分；过滤停用词与单字符';

/** ANALYTICS §4.5 停用词表（中文虚词 + 英文虚词） */
const STOP_WORDS = new Set<string>([
  '的', '了', '是', '我', '在', '和', '就', '都', '而', '及', '与', '着', '或', '你', '他', '她', '它',
  '们', '这', '那', '有', '也', '不', '很', '要', '会', '把', '被', '让', '给', '到', '从', '对', '为',
  '以', '于', '之', '其', '上', '下', '中', '个', '一', '二', '三', '我', '你',
  'the', 'a', 'an', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'and', 'or', 'to', 'of', 'in',
  'on', 'at', 'for', 'with', 'by', 'as', 'it', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'my', 'your', 'our', 'their', 'not', 'but', 'so', 'if', 'then', 'than', 'too', 'can', 'will',
  'would', 'should', 'could', 'have', 'has', 'had', 'do', 'does', 'did', 'from', 'into', 'about', 'over',
  'after', 'before', 'up', 'down', 'out', 'off', 'no', 'yes',
]);

const ASCII_ONLY = /^[\x00-\x7F]+$/;

/* -------------------------------------------------------------------------- */
/* 取数（常数次 SQL，禁止 N+1）                                                */
/* -------------------------------------------------------------------------- */

interface MemoRow {
  id: string;
  template_id: string | null;
  content: string;
  values_json: string;
  tags_json: string;
  created_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields_json: string;
}

const MEMO_COLUMNS = 'id, template_id, content, values_json, tags_json, created_at';

/** 一次取出区间内该用户的 memo（模板洞察附加 `template_id` 过滤） */
function fetchMemoRows(
  db: DatabaseSync,
  userId: string,
  fromIso: string,
  toIso: string,
  templateId?: string,
): MemoRow[] {
  if (templateId === undefined) {
    const rows = db
      .prepare(
        `SELECT ${MEMO_COLUMNS} FROM memos
         WHERE user_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?`,
      )
      .all(userId, fromIso, toIso);
    return rows as unknown as MemoRow[];
  }
  const rows = db
    .prepare(
      `SELECT ${MEMO_COLUMNS} FROM memos
       WHERE user_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?
         AND template_id = ?`,
    )
    .all(userId, fromIso, toIso, templateId);
  return rows as unknown as MemoRow[];
}

/** 区间内该用户全部 memo 的数量（用于模板占比分母，单条聚合） */
function countAllMemos(db: DatabaseSync, userId: string, fromIso: string, toIso: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM memos
       WHERE user_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?`,
    )
    .get(userId, fromIso, toIso) as unknown as { c: number | bigint } | undefined;
  return row === undefined ? 0 : Number(row.c);
}

/** 该用户全部模板（含归档：历史 memo 仍可能引用归档模板） */
function fetchTemplateMap(db: DatabaseSync, userId: string): Map<string, TemplateRow> {
  const rows = db
    .prepare('SELECT id, name, description, icon, color, fields_json FROM templates WHERE user_id = ?')
    .all(userId) as unknown as TemplateRow[];
  const map = new Map<string, TemplateRow>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

/** 取单个模板；不存在或不属于该用户 → 404（不泄露存在性） */
function fetchOwnedTemplate(db: DatabaseSync, userId: string, templateId: string): TemplateRow {
  const row = db
    .prepare(
      'SELECT id, name, description, icon, color, fields_json FROM templates WHERE id = ? AND user_id = ? LIMIT 1',
    )
    .get(templateId, userId) as unknown as TemplateRow | undefined;
  if (row === undefined) throw notFound('模板不存在');
  return row;
}

/* -------------------------------------------------------------------------- */
/* JSON 解析（容错：坏数据退化为空，绝不让整条分析失败）                       */
/* -------------------------------------------------------------------------- */

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseFieldDefinitions(raw: unknown): FieldDefinition[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FieldDefinition[]) : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* 内存视图                                                                    */
/* -------------------------------------------------------------------------- */

interface MemoView {
  id: string;
  templateId: string | null;
  content: string;
  values: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  epochMs: number;
  dayKey: string;
}

function toMemoViews(rows: MemoRow[], tz: string): MemoView[] {
  const views: MemoView[] = [];
  for (const row of rows) {
    let epochMs: number;
    try {
      epochMs = parseIsoToEpochMs(row.created_at, tz);
    } catch {
      continue;
    }
    views.push({
      id: row.id,
      templateId: row.template_id,
      content: typeof row.content === 'string' ? row.content : '',
      values: parseJsonObject(row.values_json),
      tags: parseJsonStringArray(row.tags_json),
      createdAt: row.created_at,
      epochMs,
      dayKey: localDayKeyOf(epochMs, tz),
    });
  }
  views.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return views;
}

/* -------------------------------------------------------------------------- */
/* 分桶（ANALYTICS §1）                                                        */
/* -------------------------------------------------------------------------- */

function autoGranularity(days: number): Granularity {
  if (days <= GRANULARITY_DAY_MAX_DAYS) return 'day';
  if (days <= GRANULARITY_WEEK_MAX_DAYS) return 'week';
  return 'month';
}

function parseGranularity(raw: string | null | undefined): Granularity | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  throw validationError(`granularity 只能是 day/week/month，当前值："${raw}"`);
}

/** 某本地日所属桶键 */
function bucketKeyOf(dayKey: string, granularity: Granularity): string {
  if (granularity === 'week') return weekStartDayKey(dayKey);
  if (granularity === 'month') return monthKeyOf(dayKey);
  return dayKey;
}

/** 桶键 → 图表标签（day/week 用 `MM-DD`，month 用 `YYYY-MM`） */
function bucketLabelOf(bucket: string, granularity: Granularity): string {
  return granularity === 'month' ? bucket : bucket.slice(5);
}

function nextMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  if (month >= 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** 补齐 `[from 桶, to 桶]` 的完整桶序列（空桶计数 0） */
function enumerateBuckets(fromDayKey: string, toDayKey: string, granularity: Granularity): string[] {
  const start = bucketKeyOf(fromDayKey, granularity);
  const end = bucketKeyOf(toDayKey, granularity);
  if (granularity === 'day') return enumerateDayKeys(start, end);
  if (granularity === 'week') {
    const buckets: string[] = [];
    let cursor = start;
    while (dayKeyDiff(cursor, end) <= 0) {
      buckets.push(cursor);
      cursor = addDaysToDayKey(cursor, 7);
    }
    return buckets;
  }
  const buckets: string[] = [];
  let cursor = start;
  while (cursor <= end && buckets.length < 4000) {
    buckets.push(cursor);
    cursor = nextMonthKey(cursor);
  }
  return buckets;
}

interface ResolvedRange extends RangeInfo {
  fromIso: string;
  toIso: string;
  fromDayKey: string;
  toDayKey: string;
}

/** 归一化区间 + 决定粒度（ANALYTICS §1） */
function resolveRange(
  tz: string,
  from: string | null | undefined,
  to: string | null | undefined,
  granularityRaw: string | null | undefined,
  now: number | undefined,
): ResolvedRange {
  const normalized = normalizeRange({
    from: from ?? null,
    to: to ?? null,
    tz,
    ...(now === undefined ? {} : { now }),
  });
  const explicit = parseGranularity(granularityRaw);
  const granularity = explicit ?? autoGranularity(normalized.days);
  return {
    from: toZonedIso(Date.parse(normalized.fromIso), tz),
    to: toZonedIso(Date.parse(normalized.toIso), tz),
    timezone: tz,
    days: normalized.days,
    granularity,
    label: normalized.label,
    fromIso: normalized.fromIso,
    toIso: normalized.toIso,
    fromDayKey: normalized.fromDayKey,
    toDayKey: normalized.toDayKey,
  };
}

function outputRange(range: ResolvedRange): RangeInfo {
  return {
    from: range.from,
    to: range.to,
    timezone: range.timezone,
    days: range.days,
    granularity: range.granularity,
    label: range.label,
  };
}

/* -------------------------------------------------------------------------- */
/* 通用聚合（timeline / heatmap / weekday / hourOfDay / tags / streak）        */
/* -------------------------------------------------------------------------- */

function ratioOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return roundTo(part / total);
}

function buildTimeline(memos: MemoView[], buckets: string[], granularity: Granularity): Timeline {
  const counts = new Map<string, { count: number; chars: number }>();
  for (const bucket of buckets) counts.set(bucket, { count: 0, chars: 0 });
  for (const memo of memos) {
    const entry = counts.get(bucketKeyOf(memo.dayKey, granularity));
    if (entry === undefined) continue;
    entry.count += 1;
    entry.chars += charLength(memo.content);
  }
  return {
    granularity,
    points: buckets.map((bucket) => {
      const entry = counts.get(bucket) ?? { count: 0, chars: 0 };
      return { bucket, label: bucketLabelOf(bucket, granularity), count: entry.count, chars: entry.chars };
    }),
  };
}

function buildHeatmap(dayKeys: string[], dayCounts: Map<string, number>): Heatmap {
  let max = 0;
  const days = dayKeys.map((date) => {
    const count = dayCounts.get(date) ?? 0;
    if (count > max) max = count;
    return { date, count };
  });
  return { max, days };
}

function buildWeekday(memos: MemoView[]): WeekdayStats {
  const counts = new Array<number>(7).fill(0);
  for (const memo of memos) {
    const index = weekdayOf(memo.dayKey) - 1;
    if (index >= 0 && index < 7) counts[index] = (counts[index] ?? 0) + 1;
  }
  return {
    buckets: counts.map((count, index) => ({
      weekday: index + 1,
      label: WEEKDAY_LABELS[index] ?? '',
      count,
    })),
  };
}

function buildHourOfDay(memos: MemoView[], tz: string): HourOfDayStats {
  const counts = new Array<number>(24).fill(0);
  for (const memo of memos) {
    const hour = localHourOf(memo.epochMs, tz);
    if (hour >= 0 && hour < 24) counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return { buckets: counts.map((count, hour) => ({ hour, count })) };
}

/** 标签统计：同一条 memo 内重复标签只计一次；share 分母为 memoCount */
function buildTags(memos: MemoView[], memoCount: number): TagStat[] {
  const counts = new Map<string, number>();
  for (const memo of memos) {
    const seen = new Set<string>();
    for (const tag of memo.tags) {
      if (tag === '' || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return topCounts(counts, TOP_TAGS).map(({ key, count }) => ({
    tag: key,
    count,
    share: ratioOf(count, memoCount),
  }));
}

interface CommonStats {
  timeline: Timeline;
  heatmap: Heatmap;
  weekday: WeekdayStats;
  hourOfDay: HourOfDayStats;
  tags: TagStat[];
  dayKeyList: string[];
  dayCounts: Map<string, number>;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  totalChars: number;
  busiestDay: { date: string; count: number } | null;
}

function computeCommon(memos: MemoView[], range: ResolvedRange, tz: string): CommonStats {
  const dayKeyList = enumerateDayKeys(range.fromDayKey, range.toDayKey);
  const dayCounts = countBy(memos, (memo) => memo.dayKey);
  const active = new Set<string>();
  for (const [dayKey, count] of dayCounts) if (count > 0) active.add(dayKey);
  const { longest, current } = streaks(active, dayKeyList, dayKeyDiff);

  let busiestDay: { date: string; count: number } | null = null;
  for (const date of dayKeyList) {
    const count = dayCounts.get(date) ?? 0;
    if (count > 0 && (busiestDay === null || count > busiestDay.count)) busiestDay = { date, count };
  }

  let totalChars = 0;
  for (const memo of memos) totalChars += charLength(memo.content);

  const buckets = enumerateBuckets(range.fromDayKey, range.toDayKey, range.granularity);

  return {
    timeline: buildTimeline(memos, buckets, range.granularity),
    heatmap: buildHeatmap(dayKeyList, dayCounts),
    weekday: buildWeekday(memos),
    hourOfDay: buildHourOfDay(memos, tz),
    tags: buildTags(memos, memos.length),
    dayKeyList,
    dayCounts,
    activeDays: active.size,
    longestStreak: longest,
    currentStreak: current,
    totalChars,
    busiestDay,
  };
}

/* -------------------------------------------------------------------------- */
/* 数值统计（ANALYTICS §4.1）                                                  */
/* -------------------------------------------------------------------------- */

function buildNumericStats(values: number[]): NumericStats | null {
  if (values.length === 0) return null;
  const sorted = sortAscending(values);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const iqrValue = iqr(sorted);
  const lower = p25 - 1.5 * iqrValue;
  const upper = p75 + 1.5 * iqrValue;
  let outlierCount = 0;
  for (const value of values) if (value < lower || value > upper) outlierCount += 1;

  return {
    count: values.length,
    sum: roundTo(sum(values)),
    mean: roundTo(mean(values)),
    median: roundTo(median(values)),
    min: roundTo(minOf(values)),
    max: roundTo(maxOf(values)),
    p25: roundTo(p25),
    p75: roundTo(p75),
    p90: roundTo(percentile(sorted, 0.9)),
    p95: roundTo(percentile(sorted, 0.95)),
    stddev: roundTo(stddevSample(values)),
    range: roundTo(rangeOf(values)),
    histogram: buildHistogram(values),
    outliers: { method: 'iqr', lower: roundTo(lower), upper: roundTo(upper), count: outlierCount },
  };
}

function buildNumericTrend(
  entries: Array<{ bucket: string; value: number }>,
  buckets: string[],
  granularity: Granularity,
): NumericTrend | null {
  if (entries.length === 0) return null;
  const grouped = new Map<string, number[]>();
  for (const bucket of buckets) grouped.set(bucket, []);
  for (const entry of entries) {
    const list = grouped.get(entry.bucket);
    if (list === undefined) continue;
    list.push(entry.value);
  }
  return {
    granularity,
    points: buckets.map((bucket) => {
      const list = grouped.get(bucket) ?? [];
      if (list.length === 0) {
        return { bucket, label: bucketLabelOf(bucket, granularity), count: 0, sum: 0, mean: 0, min: 0, max: 0 };
      }
      return {
        bucket,
        label: bucketLabelOf(bucket, granularity),
        count: list.length,
        sum: roundTo(sum(list)),
        mean: roundTo(mean(list)),
        min: roundTo(minOf(list)),
        max: roundTo(maxOf(list)),
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* 文本分词（ANALYTICS §4.5）                                                  */
/* -------------------------------------------------------------------------- */

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const segment of text.split(/[^\p{L}\p{N}]+/u)) {
    if (segment === '') continue;
    if (ASCII_ONLY.test(segment)) {
      if (segment.length < 2) continue;
      const word = segment.toLowerCase();
      if (!STOP_WORDS.has(word)) tokens.push(word);
      continue;
    }
    // 含 CJK（或其它非 ASCII 字母）：产出所有相邻双字 bigram
    const chars = Array.from(segment);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      const bigram = `${chars[index] ?? ''}${chars[index + 1] ?? ''}`;
      if (bigram.length < 2 || STOP_WORDS.has(bigram)) continue;
      tokens.push(bigram);
    }
  }
  return tokens;
}

function buildTextStats(texts: string[]): TextStats {
  if (texts.length === 0) {
    return {
      totalChars: 0,
      avgChars: 0,
      minChars: 0,
      maxChars: 0,
      medianChars: 0,
      histogram: { binCount: 0, binWidth: 0, bins: [] },
      topWords: [],
      topWordsNote: TOP_WORDS_NOTE,
    };
  }
  const lengths = texts.map((text) => charLength(text));
  const histogram = buildHistogram(lengths);
  const wordCounts = new Map<string, number>();
  for (const text of texts) {
    for (const word of tokenize(text)) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  }
  return {
    totalChars: sum(lengths),
    avgChars: roundTo(mean(lengths)),
    minChars: minOf(lengths),
    maxChars: maxOf(lengths),
    medianChars: roundTo(median(lengths)),
    histogram: {
      binCount: histogram.binCount,
      binWidth: histogram.binWidth,
      bins: histogram.bins.map((bin) => ({ from: bin.from, to: bin.to, count: bin.count })),
    },
    topWords: topCounts(wordCounts, TOP_WORDS).map(({ key, count }) => ({ word: key, count })),
    topWordsNote: TOP_WORDS_NOTE,
  };
}

/* -------------------------------------------------------------------------- */
/* 日期 / 链接统计（ANALYTICS §4.4 / §4.6）                                    */
/* -------------------------------------------------------------------------- */

function zeroWeekdayBuckets(): Array<{ weekday: number; count: number }> {
  return Array.from({ length: 7 }, (_unused, index) => ({ weekday: index + 1, count: 0 }));
}

function zeroHourBuckets(): Array<{ hour: number; count: number }> {
  return Array.from({ length: 24 }, (_unused, index) => ({ hour: index, count: 0 }));
}

function buildDateStats(
  def: FieldDefinition,
  collected: Array<{ value: FieldValue; epochMs: number }>,
  tz: string,
  granularity: Granularity,
): DateStats {
  const isDateTime = def.type === 'datetime';
  const entries: Array<{ value: string; dayKey: string; hour: number }> = [];
  for (const item of collected) {
    if (typeof item.value !== 'string' || item.value === '') continue;
    if (isDateTime) {
      let epochMs: number;
      try {
        epochMs = parseIsoToEpochMs(item.value, tz);
      } catch {
        continue;
      }
      entries.push({ value: item.value, dayKey: localDayKeyOf(epochMs, tz), hour: localHourOf(epochMs, tz) });
    } else {
      entries.push({ value: item.value, dayKey: item.value, hour: 0 });
    }
  }

  if (entries.length === 0) {
    const empty: DateStats = {
      min: null,
      max: null,
      spanDays: 0,
      byMonth: [],
      byWeekday: zeroWeekdayBuckets(),
    };
    if (isDateTime) empty.byHour = zeroHourBuckets();
    return empty;
  }

  entries.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const first = entries[0];
  const last = entries[entries.length - 1];
  const minDayKey = first?.dayKey ?? '';
  const maxDayKey = last?.dayKey ?? '';

  const monthCounts = new Map<string, number>();
  const weekdayCounts = new Array<number>(7).fill(0);
  const hourCounts = new Array<number>(24).fill(0);
  for (const entry of entries) {
    const bucket = bucketKeyOf(entry.dayKey, granularity);
    monthCounts.set(bucket, (monthCounts.get(bucket) ?? 0) + 1);
    const weekdayIndex = weekdayOf(entry.dayKey) - 1;
    if (weekdayIndex >= 0 && weekdayIndex < 7) weekdayCounts[weekdayIndex] = (weekdayCounts[weekdayIndex] ?? 0) + 1;
    if (isDateTime && entry.hour >= 0 && entry.hour < 24) hourCounts[entry.hour] = (hourCounts[entry.hour] ?? 0) + 1;
  }

  const result: DateStats = {
    min: first?.value ?? null,
    max: last?.value ?? null,
    spanDays: dayKeyDiff(maxDayKey, minDayKey),
    byMonth: [...monthCounts.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0)),
    byWeekday: weekdayCounts.map((count, index) => ({ weekday: index + 1, count })),
  };
  if (isDateTime) result.byHour = hourCounts.map((count, hour) => ({ hour, count }));
  return result;
}

function buildUrlStats(urls: string[]): UrlStats {
  const distinct = new Set<string>();
  const domainCounts = new Map<string, number>();
  let httpsCount = 0;
  for (const url of urls) {
    distinct.add(url);
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') httpsCount += 1;
      const hostname = parsed.hostname.toLowerCase();
      if (hostname !== '') domainCounts.set(hostname, (domainCounts.get(hostname) ?? 0) + 1);
    } catch {
      // 非法 URL 不进入域名统计，但仍计入 distinctCount / httpsRatio 分母
    }
  }
  return {
    distinctDomains: topCounts(domainCounts, TOP_DOMAINS).map(({ key, count }) => ({ domain: key, count })),
    distinctCount: distinct.size,
    httpsRatio: ratioOf(httpsCount, urls.length),
  };
}

/* -------------------------------------------------------------------------- */
/* 字段分支（ANALYTICS §4）                                                    */
/* -------------------------------------------------------------------------- */

interface CollectedValue {
  value: FieldValue;
  bucket: string;
  epochMs: number;
}

function collectFieldValues(
  def: FieldDefinition,
  memos: MemoView[],
  granularity: Granularity,
): { filled: number; collected: CollectedValue[] } {
  const collected: CollectedValue[] = [];
  let filled = 0;
  for (const memo of memos) {
    const raw = memo.values[def.key] as FieldValue | undefined;
    if (isFieldValueEmpty(raw)) continue;
    filled += 1;
    collected.push({ value: raw as FieldValue, bucket: bucketKeyOf(memo.dayKey, granularity), epochMs: memo.epochMs });
  }
  return { filled, collected };
}

function numericValuesOf(collected: CollectedValue[]): Array<{ bucket: string; value: number }> {
  const entries: Array<{ bucket: string; value: number }> = [];
  for (const item of collected) {
    if (typeof item.value === 'number' && Number.isFinite(item.value)) {
      entries.push({ bucket: item.bucket, value: item.value });
    }
  }
  return entries;
}

function stringValuesOf(collected: CollectedValue[]): string[] {
  const values: string[] = [];
  for (const item of collected) {
    if (typeof item.value === 'string' && item.value !== '') values.push(item.value);
  }
  return values;
}

/** 选择型 valueUnion：按模板定义顺序列出实际出现的 value，额外值按计数降序追加 */
function buildValueUnion(def: FieldDefinition, counts: Map<string, number>): string[] {
  const union: string[] = [];
  const seen = new Set<string>();
  for (const option of def.options ?? []) {
    if (counts.has(option.value) && !seen.has(option.value)) {
      seen.add(option.value);
      union.push(option.value);
    }
  }
  const extras = [...counts.keys()].filter((value) => !seen.has(value));
  extras.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, 'zh-Hans-CN'));
  for (const value of extras) union.push(value);
  return union;
}

function buildFieldInsight(
  def: FieldDefinition,
  memos: MemoView[],
  buckets: string[],
  range: ResolvedRange,
  tz: string,
): TemplateFieldInsight {
  const { filled, collected } = collectFieldValues(def, memos, range.granularity);
  const base: TemplateFieldInsight = {
    key: def.key,
    label: def.label,
    type: def.type,
    filled,
    missing: memos.length - filled,
    fillRatio: ratioOf(filled, memos.length),
    valueUnion: null,
  };

  switch (def.type) {
    case 'number':
    case 'currency':
    case 'percent': {
      const entries = numericValuesOf(collected);
      const values = entries.map((entry) => entry.value);
      base.numeric = buildNumericStats(values);
      base.trend = buildNumericTrend(entries, buckets, range.granularity);
      if (def.type === 'currency') base.currency = effectiveCurrency(def);
      if (def.type === 'percent') base.unit = '%';
      return base;
    }

    case 'rating': {
      const entries = numericValuesOf(collected);
      const values = entries.map((entry) => entry.value);
      const scale = effectiveScale(def);
      base.numeric = buildNumericStats(values);
      base.trend = buildNumericTrend(entries, buckets, range.granularity);
      base.scale = scale;
      if (values.length === 0) {
        base.distribution = [];
      } else {
        const counts = new Array<number>(scale + 1).fill(0);
        for (const value of values) {
          if (Number.isInteger(value) && value >= 0 && value <= scale) {
            counts[value] = (counts[value] ?? 0) + 1;
          }
        }
        base.distribution = counts.map((count, value) => ({
          value,
          label: String(value),
          count,
          share: ratioOf(count, filled),
        }));
      }
      return base;
    }

    case 'select': {
      const counts = new Map<string, number>();
      for (const value of stringValuesOf(collected)) counts.set(value, (counts.get(value) ?? 0) + 1);
      base.distribution = topCounts(counts).map(({ key, count }) => ({
        value: key,
        label: optionLabelOf(def, key),
        count,
        share: ratioOf(count, filled),
      }));
      base.valueUnion = buildValueUnion(def, counts);
      return base;
    }

    case 'multiselect': {
      const counts = new Map<string, number>();
      let references = 0;
      for (const item of collected) {
        if (!Array.isArray(item.value)) continue;
        for (const value of item.value) {
          if (typeof value !== 'string' || value === '') continue;
          counts.set(value, (counts.get(value) ?? 0) + 1);
          references += 1;
        }
      }
      base.distribution = topCounts(counts).map(({ key, count }) => ({
        value: key,
        label: optionLabelOf(def, key),
        count,
        share: ratioOf(count, references),
      }));
      base.valueUnion = buildValueUnion(def, counts);
      return base;
    }

    case 'boolean': {
      let trueCount = 0;
      let falseCount = 0;
      for (const item of collected) {
        if (item.value === true) trueCount += 1;
        else if (item.value === false) falseCount += 1;
      }
      const total = trueCount + falseCount;
      base.boolean = { trueCount, falseCount, trueRatio: ratioOf(trueCount, total) };
      return base;
    }

    case 'date':
    case 'datetime':
      base.date = buildDateStats(def, collected, tz, range.granularity);
      return base;

    case 'text':
    case 'longtext':
      base.text = buildTextStats(stringValuesOf(collected));
      return base;

    case 'url':
      base.url = buildUrlStats(stringValuesOf(collected));
      return base;

    default:
      return base;
  }
}

/* -------------------------------------------------------------------------- */
/* 序列化收尾（ANALYTICS §7.3 / §7.4）                                         */
/* -------------------------------------------------------------------------- */

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      result[key] = jsonSafe(item);
    }
    return result;
  }
  return null;
}

/** 统一收尾：剔除 `undefined`、`NaN`/`Infinity` → `null`、`BigInt`/`Date` 归一，保证 JSON 可序列化 */
export function toJsonSafe<T>(value: T): T {
  return jsonSafe(value) as T;
}

/* -------------------------------------------------------------------------- */
/* 对外 API                                                                    */
/* -------------------------------------------------------------------------- */

/** 模板洞察（核心端点，ANALYTICS §3） */
export function computeTemplateInsights(db: DatabaseSync, tz: string, query: InsightQuery): TemplateInsights {
  const templateRow = fetchOwnedTemplate(db, query.userId, query.templateId);
  const range = resolveRange(tz, query.from, query.to, query.granularity, query.now);
  const fields = parseFieldDefinitions(templateRow.fields_json);

  const memos = toMemoViews(fetchMemoRows(db, query.userId, range.fromIso, range.toIso, query.templateId), tz);
  const allMemoCount = countAllMemos(db, query.userId, range.fromIso, range.toIso);
  const common = computeCommon(memos, range, tz);
  const buckets = enumerateBuckets(range.fromDayKey, range.toDayKey, range.granularity);

  const memoCount = memos.length;
  const first = memos[0];
  const last = memos[memoCount - 1];

  const fieldInsights = fields.map((def) => buildFieldInsight(def, memos, buckets, range, tz));

  const summary: TemplateSummary = {
    memoCount,
    allMemoCount,
    shareOfAllMemos: ratioOf(memoCount, allMemoCount),
    totalChars: common.totalChars,
    avgChars: memoCount > 0 ? roundTo(common.totalChars / memoCount) : 0,
    memosWithContent: memos.filter((memo) => memo.content.trim() !== '').length,
    activeDays: common.activeDays,
    dayCoverage: ratioOf(common.activeDays, range.days),
    longestStreak: common.longestStreak,
    currentStreak: common.currentStreak,
    busiestDay: common.busiestDay,
    firstMemoAt: first?.createdAt ?? null,
    lastMemoAt: last?.createdAt ?? null,
    fieldFillRate: fieldInsights.map((field) => ({
      key: field.key,
      label: field.label,
      filled: field.filled,
      missing: field.missing,
      ratio: field.fillRatio,
    })),
  };

  const result: TemplateInsights = {
    template: {
      id: templateRow.id,
      name: templateRow.name,
      icon: templateRow.icon,
      color: templateRow.color,
      fields,
    },
    range: outputRange(range),
    generatedAt: new Date().toISOString(),
    tookMs: 0,
    summary,
    timeline: common.timeline,
    heatmap: common.heatmap,
    weekday: common.weekday,
    hourOfDay: common.hourOfDay,
    tags: common.tags,
    fields: fieldInsights,
    csvRows: memos.map((memo) => ({
      createdAt: memo.createdAt,
      content: memo.content,
      tags: memo.tags,
      values: memo.values,
    })),
  };

  return toJsonSafe(result);
}

/** 全局概览（ANALYTICS §5） */
export function computeOverview(db: DatabaseSync, tz: string, query: OverviewQuery): OverviewInsights {
  const range = resolveRange(tz, query.from, query.to, query.granularity, query.now);
  const memos = toMemoViews(fetchMemoRows(db, query.userId, range.fromIso, range.toIso), tz);
  const templateMap = fetchTemplateMap(db, query.userId);
  const common = computeCommon(memos, range, tz);

  const memoCount = memos.length;

  // byTemplate：非空模板按计数降序，无模板项固定追加在末尾
  const grouped = new Map<string, number>();
  for (const memo of memos) {
    const key = memo.templateId ?? '';
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const byTemplate: OverviewByTemplate[] = [];
  for (const [templateId, count] of grouped) {
    if (templateId === '') continue;
    const template = templateMap.get(templateId);
    byTemplate.push({
      templateId,
      templateName: template?.name ?? templateId,
      icon: template?.icon ?? '',
      count,
      share: ratioOf(count, memoCount),
    });
  }
  byTemplate.sort((a, b) => b.count - a.count || a.templateName.localeCompare(b.templateName, 'zh-Hans-CN'));
  const untemplatedCount = grouped.get('') ?? 0;
  if (untemplatedCount > 0) {
    byTemplate.push({
      templateId: null,
      templateName: '无模板',
      icon: '',
      count: untemplatedCount,
      share: ratioOf(untemplatedCount, memoCount),
    });
  }

  // 跨模板汇总数值型字段
  const numericGroups = new Map<string, { templateId: string; key: string; values: number[] }>();
  for (const memo of memos) {
    if (memo.templateId === null) continue;
    const template = templateMap.get(memo.templateId);
    if (template === undefined) continue;
    for (const def of parseFieldDefinitions(template.fields_json)) {
      if (def.type !== 'number' && def.type !== 'currency' && def.type !== 'percent' && def.type !== 'rating') continue;
      const raw = memo.values[def.key] as FieldValue | undefined;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const groupKey = `${memo.templateId}\u0000${def.key}`;
      let group = numericGroups.get(groupKey);
      if (group === undefined) {
        group = { templateId: memo.templateId, key: def.key, values: [] };
        numericGroups.set(groupKey, group);
      }
      group.values.push(raw);
    }
  }

  // key 冲突检测：同一 fieldKey 出现在多个模板时，以 templateName 前缀区分
  const keyFrequency = new Map<string, number>();
  for (const group of numericGroups.values()) {
    keyFrequency.set(group.key, (keyFrequency.get(group.key) ?? 0) + 1);
  }

  const numericFields: OverviewNumericField[] = [];
  const orderedTemplateIds = byTemplate
    .filter((entry): entry is OverviewByTemplate & { templateId: string } => entry.templateId !== null)
    .map((entry) => entry.templateId);
  for (const templateId of orderedTemplateIds) {
    const template = templateMap.get(templateId);
    if (template === undefined) continue;
    for (const def of parseFieldDefinitions(template.fields_json)) {
      if (def.type !== 'number' && def.type !== 'currency' && def.type !== 'percent' && def.type !== 'rating') continue;
      const group = numericGroups.get(`${templateId}\u0000${def.key}`);
      if (group === undefined || group.values.length === 0) continue;
      const conflict = (keyFrequency.get(def.key) ?? 0) > 1;
      const entry: OverviewNumericField = {
        templateId,
        templateName: template.name,
        key: conflict ? `${template.name}.${def.key}` : def.key,
        label: def.label,
        type: def.type,
        count: group.values.length,
        sum: roundTo(sum(group.values)),
        mean: roundTo(mean(group.values)),
        median: roundTo(median(group.values)),
        max: roundTo(maxOf(group.values)),
      };
      if (def.type === 'currency') entry.currency = effectiveCurrency(def);
      if (def.type === 'percent') entry.unit = '%';
      if (def.type === 'rating') entry.scale = effectiveScale(def);
      numericFields.push(entry);
    }
  }

  const summary: OverviewSummary = {
    memoCount,
    templateCount: orderedTemplateIds.length,
    byTemplate,
    totalChars: common.totalChars,
    avgChars: memoCount > 0 ? roundTo(common.totalChars / memoCount) : 0,
    activeDays: common.activeDays,
    dayCoverage: ratioOf(common.activeDays, range.days),
    longestStreak: common.longestStreak,
    currentStreak: common.currentStreak,
  };

  const result: OverviewInsights = {
    range: outputRange(range),
    generatedAt: new Date().toISOString(),
    tookMs: 0,
    summary,
    timeline: common.timeline,
    heatmap: common.heatmap,
    weekday: common.weekday,
    hourOfDay: common.hourOfDay,
    tags: common.tags,
    numericFields,
  };

  return toJsonSafe(result);
}

/* -------------------------------------------------------------------------- */
/* CSV 导出（ANALYTICS §6）                                                    */
/* -------------------------------------------------------------------------- */

/** RFC 4180 单元格转义：含 `"`、`,`、CR、LF 时加引号并把 `"` 翻倍 */
function csvCell(value: string): string {
  if (/["\r\n,]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** CSV 中的字段值：boolean → 是/否；select/multiselect → option label（多值用 `|`）；空值 → 空串 */
function csvFieldValue(def: FieldDefinition, value: FieldValue | undefined): string {
  if (isFieldValueEmpty(value)) return '';
  switch (def.type) {
    case 'boolean':
      return value === true ? '是' : '否';
    case 'select':
      return optionLabelOf(def, typeof value === 'string' ? value : String(value));
    case 'multiselect': {
      const list = Array.isArray(value) ? value : [String(value)];
      return list.map((item) => optionLabelOf(def, item)).join('|');
    }
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** ASCII 安全化文件名（非 ASCII → `_`，并折叠/收边） */
function asciiSafeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\/:*?<>|]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_.]+/, '')
    .replace(/[-_.]+$/, '');
  return cleaned === '' ? 'export.csv' : cleaned;
}

/** RFC 5987 的 `filename*` 编码 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 生成 `Content-Disposition` 头：同时给 ASCII 安全名与 RFC 5987 UTF-8 名。
 */
export function buildContentDisposition(filename: string): string {
  return `attachment; filename="${asciiSafeFilename(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/**
 * 生成 CSV（ANALYTICS §6）：UTF-8 BOM + CRLF + RFC 4180 转义。
 * 文件名日期取区间结束日（本地），保证纯函数可复现。
 */
export function buildInsightsCsv(insights: TemplateInsights, tz: string): { filename: string; body: string } {
  const fields = insights.template.fields;
  const header = ['记录时间(本地)', '记录时间(UTC)', '内容', '标签', ...fields.map((field) => field.label)];
  const lines: string[] = [header.map((cell) => csvCell(cell)).join(',')];

  for (const row of insights.csvRows) {
    const cells: string[] = [
      formatLocalDayTime(row.createdAt, tz),
      row.createdAt,
      row.content,
      row.tags.join('|'),
      ...fields.map((def) => csvFieldValue(def, row.values[def.key] as FieldValue | undefined)),
    ];
    lines.push(cells.map((cell) => csvCell(cell)).join(','));
  }

  const body = `\uFEFF${lines.join('\r\n')}\r\n`;
  const dateKey = insights.range.to.slice(0, 10).replace(/-/g, '');
  const filename = `${insights.template.name}-${dateKey}.csv`;
  return { filename, body };
}
