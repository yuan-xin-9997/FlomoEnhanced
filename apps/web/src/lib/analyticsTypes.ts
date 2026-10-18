/**
 * 洞察分析响应结构（严格对齐 docs/ANALYTICS.md）—— 纯类型文件，无运行时代码。
 * `@flomo/shared` 未导出这些类型，故在前端本地声明。
 */
import type { FieldDefinition, FieldType } from '@flomo/shared';

/** 分桶粒度 */
export type Granularity = 'day' | 'week' | 'month';

/** §2 通用区间结构 */
export interface AnalyticsRange {
  /** 归一化后的实际区间起点（ISO） */
  from: string;
  /** 归一化后的实际区间终点（ISO） */
  to: string;
  timezone: string;
  /** 闭区间天数 */
  days: number;
  granularity: Granularity;
  /** 中文可读标签，如「最近 30 天」 */
  label: string;
}

/** 主趋势点 */
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
  /** 1=周一 … 7=周日 */
  weekday: number;
  label: string;
  count: number;
}

export interface Weekday {
  buckets: WeekdayBucket[];
}

export interface HourBucket {
  hour: number;
  count: number;
}

export interface HourOfDay {
  buckets: HourBucket[];
}

export interface TagStat {
  tag: string;
  count: number;
  share: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  ratio: number;
  cumulativeRatio: number;
}

export interface Histogram {
  binCount: number;
  binWidth: number;
  bins: HistogramBin[];
}

export interface Outliers {
  method: string;
  lower: number;
  upper: number;
  count: number;
}

/** §4.1 数值型统计 */
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
  outliers: Outliers;
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

/** 选择型分布的单项（rating 的 value 为数字且无 label） */
export interface DistributionEntry {
  value: string | number;
  label?: string;
  count: number;
  share: number;
}

/** §4.3 布尔统计 */
export interface BooleanStats {
  trueCount: number;
  falseCount: number;
  trueRatio: number;
}

/** §4.4 日期统计 */
export interface DateStats {
  min: string;
  max: string;
  spanDays: number;
  byMonth: Array<{ bucket: string; count: number }>;
  byWeekday: Array<{ weekday: number; count: number }>;
  /** 仅 datetime */
  byHour?: Array<{ hour: number; count: number }>;
}

/** §4.5 文本统计 */
export interface TextStats {
  totalChars: number;
  avgChars: number;
  minChars: number;
  maxChars: number;
  medianChars: number;
  histogram: Histogram;
  topWords: Array<{ word: string; count: number }>;
  topWordsNote?: string;
}

/** §4.6 链接统计 */
export interface UrlStats {
  distinctDomains: Array<{ domain: string; count: number }>;
  distinctCount: number;
  httpsRatio: number;
}

/** 字段填写率 */
export interface FieldFillRate {
  key: string;
  label: string;
  filled: number;
  missing: number;
  ratio: number;
}

/** §4 fields[] 单项（按类型附带的统计块均为可选） */
export interface FieldInsight {
  key: string;
  label: string;
  type: FieldType;
  filled: number;
  missing: number;
  fillRatio: number;
  /** 仅 select / multiselect */
  valueUnion?: string[] | null;

  numeric?: NumericStats | null;
  trend?: NumericTrend | null;
  /** currency 字段的 ISO-4217 币种 */
  currency?: string;
  /** percent 字段的单位 */
  unit?: string;
  /** rating 字段满分 */
  scale?: number;
  distribution?: DistributionEntry[];
  boolean?: BooleanStats | null;
  date?: DateStats | null;
  text?: TextStats | null;
  url?: UrlStats | null;
}

/** 模板洞察 summary */
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

/** §3 GET /api/analytics/templates/:id/insights */
export interface TemplateInsights {
  template: {
    id: string;
    name: string;
    icon: string;
    color: string;
    fields: FieldDefinition[];
  };
  range: AnalyticsRange;
  generatedAt: string;
  tookMs: number;
  summary: TemplateSummary;
  timeline: Timeline;
  heatmap: Heatmap;
  weekday: Weekday;
  hourOfDay: HourOfDay;
  tags: TagStat[];
  fields: FieldInsight[];
}

/** §5 全局概览的被模板分布项 */
export interface OverviewTemplateShare {
  templateId: string | null;
  templateName: string;
  icon: string;
  count: number;
  share: number;
}

/** §5 跨模板数值字段汇总项 */
export interface OverviewNumericField {
  templateId: string;
  templateName: string;
  key: string;
  label: string;
  type: FieldType;
  currency?: string;
  count: number;
  sum: number;
  mean: number;
  median: number;
  max: number;
}

export interface OverviewSummary {
  memoCount: number;
  templateCount: number;
  byTemplate: OverviewTemplateShare[];
  totalChars: number;
  avgChars: number;
  activeDays: number;
  dayCoverage: number;
  longestStreak: number;
  currentStreak: number;
}

/** §5 GET /api/analytics/overview */
export interface AnalyticsOverview {
  range: AnalyticsRange;
  generatedAt: string;
  tookMs: number;
  summary: OverviewSummary;
  timeline: Timeline;
  heatmap: Heatmap;
  weekday: Weekday;
  hourOfDay: HourOfDay;
  tags: TagStat[];
  numericFields: OverviewNumericField[];
}
