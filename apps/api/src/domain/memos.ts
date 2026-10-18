/**
 * 想法（memo）领域逻辑（SPEC §5、§8.3）—— 归 A2。
 *
 * 设计要点：
 * - **多用户隔离**：所有查询都带 `user_id = ?`；跨用户访问返回 404（与「不存在」不可区分）。
 * - **可以不用模板**：`templateId` 为 `null`/省略即无模板记录；此时 `values` 必须为空。
 * - **字段值校验**：交给 `@flomo/shared` 的 `normalizeFieldValue`，`required` 字段缺失 → 422。
 * - **标签**：`extractTags(content, tags)` 统一提取（`#` 不入库、去重、≤50 字符、最多 50 个）。
 * - **分页**：`(created_at, id)` 复合游标（base64url），排序 `created_at DESC, id DESC`；
 *   `total` 用单独的 COUNT 查询（不受分页影响）。
 * - **标签过滤**：`json_each(tags_json)` 精确匹配整个标签（不是 `LIKE '%tag%'`）。
 * - **时区**：分日统计与时间入参解释一律使用 `config.tz`。
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  extractTags,
  isFieldValueEmpty,
  normalizeFieldValue,
  streaks,
  type FieldDefinition,
  type FieldValue,
  type Memo,
  type MemoSummary,
} from '@flomo/shared';
import { AppError, notFound, validationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import {
  dayKeyDiff,
  enumerateDayKeys,
  localDayEndUtcIso,
  localDayKeyOf,
  localDayStartUtcIso,
  normalizeRange,
  nowIso,
  parseIsoToEpochMs,
} from '../lib/time.js';

/** content 字符数上限（SPEC §8.3） */
export const MEMO_CONTENT_MAX = 10000;
/** 列表分页默认条数 */
export const MEMO_PAGE_DEFAULT = 50;
/** 列表分页最大条数 */
export const MEMO_PAGE_MAX = 200;

/** 写操作上下文（时区 + 可选日志钩子） */
export interface MemoWriteContext {
  /** 统计/时间入参解释所用时区（`config.tz`） */
  tz: string;
  /** 可选告警日志（例如「创建时间在未来」） */
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

/** 创建想法的输入（全部为 `unknown`：来自请求体，需自行校验） */
export interface MemoCreateInput {
  content?: unknown;
  templateId?: unknown;
  values?: unknown;
  tags?: unknown;
  createdAt?: unknown;
}

/** 局部更新想法的输入 */
export interface MemoUpdateInput {
  content?: unknown;
  templateId?: unknown;
  values?: unknown;
  tags?: unknown;
}

/** 列表查询参数 */
export interface MemoListQuery {
  templateId?: unknown;
  from?: unknown;
  to?: unknown;
  tag?: unknown;
  q?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/** 列表结果 */
export interface MemoListResult {
  items: Memo[];
  nextCursor: string | null;
  total: number;
}

/** 摘要查询参数 */
export interface MemoSummaryQuery {
  from?: unknown;
  to?: unknown;
}

/** memos 表行的显式列表（含模板名，禁止 `SELECT *`） */
const MEMO_SELECT = `
  SELECT m.id            AS id,
         m.user_id       AS user_id,
         m.template_id   AS template_id,
         m.content       AS content,
         m.values_json   AS values_json,
         m.tags_json     AS tags_json,
         m.created_at    AS created_at,
         m.updated_at    AS updated_at,
         m.deleted_at    AS deleted_at,
         t.name          AS template_name
    FROM memos m
    LEFT JOIN templates t ON t.id = m.template_id
`;

type SqlParam = string | number | null;

interface MemoRow {
  id: string;
  user_id: string;
  template_id: string | null;
  content: string;
  values_json: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  template_name: string | null;
}

interface OwnedTemplateRow {
  id: string;
  fields_json: string;
  archived_at: string | null;
}

/** 游标解码结果 */
interface MemoCursor {
  createdAt: string;
  id: string;
}

/** 在事务中执行（已在事务内则直接执行，避免嵌套 `BEGIN` 报错） */
function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw error;
  }
}

function asInternalError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL', fallback);
}

function toCount(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

// ---------------------------------------------------------------------------
// JSON 解析与 DTO
// ---------------------------------------------------------------------------

function parseValues(json: string): Record<string, FieldValue> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, FieldValue>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
    return [];
  } catch {
    return [];
  }
}

function toMemoDto(row: MemoRow): Memo {
  return {
    id: row.id,
    templateId: row.template_id,
    templateName: row.template_id === null ? null : (row.template_name ?? null),
    content: row.content,
    values: parseValues(row.values_json),
    tags: parseTags(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 按 id + user_id 读取未删除的想法（跨用户 → null，由调用方转 404） */
function readMemoRow(db: DatabaseSync, userId: string, id: string): MemoRow | null {
  if (typeof id !== 'string' || id === '') return null;
  const row = db
    .prepare(`${MEMO_SELECT} WHERE m.user_id = ? AND m.id = ? AND m.deleted_at IS NULL LIMIT 1`)
    .get(userId, id) as unknown as MemoRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// 模板解析与字段值归一化
// ---------------------------------------------------------------------------

function parseFields(json: string): FieldDefinition[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as FieldDefinition[]) : [];
  } catch {
    return [];
  }
}

/** 读取属于当前用户的模板行（跨用户返回 null） */
function loadOwnedTemplate(db: DatabaseSync, userId: string, templateId: string): OwnedTemplateRow | null {
  const row = db
    .prepare('SELECT id, fields_json, archived_at FROM templates WHERE id = ? AND user_id = ? LIMIT 1')
    .get(templateId, userId) as unknown as OwnedTemplateRow | undefined;
  return row ?? null;
}

/**
 * 取出当前用户的**未归档**模板字段定义。
 * 不存在、不属于当前用户、已归档 —— 一律 404（不泄露资源是否存在）。
 */
function requireActiveOwnedTemplate(db: DatabaseSync, userId: string, templateId: string): FieldDefinition[] {
  const row = loadOwnedTemplate(db, userId, templateId);
  if (row === null || row.archived_at !== null) throw notFound('模板不存在或已归档');
  return parseFields(row.fields_json);
}

/** 请求体中的 `values` 必须是普通对象（缺省视为 `{}`） */
function asValuesObject(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw validationError('「values」必须是对象');
  return raw as Record<string, unknown>;
}

/**
 * 按模板字段定义归一化取值。
 * - 未知 key 忽略（不报错、不写入）；
 * - `required` 字段为空 → 422；
 * - 空值不写入 `values_json`，但 `multiselect` 空值写 `[]`（口径固定）。
 */
function normalizeMemoValues(
  fields: readonly FieldDefinition[],
  values: Record<string, unknown>,
): Record<string, FieldValue> {
  const result: Record<string, FieldValue> = {};
  const errors: string[] = [];

  for (const def of fields) {
    const normalized = normalizeFieldValue(def, values[def.key]);
    if (!normalized.ok) {
      errors.push(normalized.message);
      continue;
    }
    const value = normalized.value;
    if (isFieldValueEmpty(value)) {
      if (def.required === true) errors.push(`「${def.label || def.key}」为必填字段`);
      else if (def.type === 'multiselect') result[def.key] = [];
      continue;
    }
    result[def.key] = value;
  }

  if (errors.length > 0) throw validationError('字段取值校验失败', errors);
  return result;
}

/** 归一化后的字段值里是否至少有一个「有值」的项 */
function hasNonEmptyValue(values: Record<string, FieldValue>): boolean {
  return Object.values(values).some((value) => !isFieldValueEmpty(value));
}

// ---------------------------------------------------------------------------
// 入参读取
// ---------------------------------------------------------------------------

function readContent(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw validationError('「content」必须是字符串');
  if (Array.from(raw).length > MEMO_CONTENT_MAX) {
    throw validationError(`「content」不能超过 ${MEMO_CONTENT_MAX} 个字符`);
  }
  return raw;
}

/** 显式传入的标签（字符串或字符串数组） */
function readExtraTags(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return [raw];
  if (!Array.isArray(raw)) throw validationError('「tags」必须是字符串数组');
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') throw validationError('「tags」的每一项都必须是字符串');
    result.push(item);
  }
  return result;
}

/** `createdAt`：合法 ISO → UTC ISO；非法 → 422；未来时间允许但记录日志 */
function readCreatedAt(raw: unknown, ctx: MemoWriteContext): string {
  if (raw === undefined || raw === null || raw === '') return nowIso();
  if (typeof raw !== 'string') throw validationError('「createdAt」必须是 ISO-8601 时间字符串');
  const epochMs = parseIsoToEpochMs(raw, ctx.tz);
  const iso = new Date(epochMs).toISOString();
  if (epochMs > Date.now() + 1000) {
    ctx.warn?.('想法的创建时间在未来', { createdAt: iso });
  }
  return iso;
}

const DAY_KEY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 区间边界：日期（`YYYY-MM-DD`）按本地日展开 —— `from` 取当日 00:00:00.000、
 * `to` 取当日 23:59:59.999；带时间的输入按 `tz` 解释为精确时刻，统一转 UTC ISO。
 */
function readRangeBound(raw: unknown, tz: string, field: 'from' | 'to'): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw validationError(`「${field}」必须是时间字符串`);
  const value = raw.trim();
  const epochMs = parseIsoToEpochMs(value, tz);
  if (DAY_KEY_ONLY.test(value)) {
    const dayKey = localDayKeyOf(epochMs, tz);
    return field === 'to' ? localDayEndUtcIso(dayKey, tz) : localDayStartUtcIso(dayKey, tz);
  }
  return new Date(epochMs).toISOString();
}

/** 可选的查询字符串（空串视为缺省） */
function readOptionalQueryString(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw validationError(`「${field}」必须是字符串`);
  return raw;
}

/** `limit`：默认 50，非法 → 422，越界**夹取**到 1..200 */
function readLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return MEMO_PAGE_DEFAULT;
  const value = typeof raw === 'number' ? String(raw) : raw;
  if (typeof value !== 'string') throw validationError('「limit」必须是整数');
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw validationError('「limit」必须是整数');
  return Math.min(Math.max(parsed, 1), MEMO_PAGE_MAX);
}

/** 游标编码：`<created_at>|<id>` 的 base64url */
export function encodeMemoCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function readCursor(raw: unknown): MemoCursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw validationError('「cursor」必须是字符串');
  let decoded = '';
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw validationError('「cursor」无效');
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0 || separator === decoded.length - 1) throw validationError('「cursor」无效');
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(Date.parse(createdAt)) || id === '') throw validationError('「cursor」无效');
  return { createdAt, id };
}

/** `LIKE` 通配符转义（配合 `ESCAPE '\\'`） */
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 创建想法（可不用模板；`content` 与 `values` 至少要有一个有内容） */
export function createMemo(
  db: DatabaseSync,
  userId: string,
  input: MemoCreateInput,
  ctx: MemoWriteContext,
): Memo {
  const content = readContent(input.content);
  const valuesObject = asValuesObject(input.values);
  const hasRawValues = Object.keys(valuesObject).length > 0;

  let templateId: string | null = null;
  let fields: FieldDefinition[] = [];
  if (input.templateId !== undefined && input.templateId !== null) {
    if (typeof input.templateId !== 'string' || input.templateId === '') {
      throw validationError('「templateId」必须是字符串或 null');
    }
    templateId = input.templateId;
    fields = requireActiveOwnedTemplate(db, userId, templateId);
  } else if (hasRawValues) {
    throw validationError('未选择模板时不能填写字段值');
  }

  const values = templateId === null ? {} : normalizeMemoValues(fields, valuesObject);
  const contentIsEmpty = content.trim() === '';
  if (contentIsEmpty && !hasNonEmptyValue(values)) {
    throw validationError('请填写内容或至少一个字段');
  }

  const tags = extractTags(content, readExtraTags(input.tags));
  const createdAt = readCreatedAt(input.createdAt, ctx);
  const id = newId();

  try {
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO memos (id, user_id, template_id, content, values_json, tags_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        userId,
        templateId,
        content,
        JSON.stringify(values),
        JSON.stringify(tags),
        createdAt,
        createdAt,
      );
    });
  } catch (error) {
    throw asInternalError(error, '创建想法失败，请稍后重试');
  }

  return getMemo(db, userId, id);
}

/** 读取想法详情（跨用户 / 已删除 → 404） */
export function getMemo(db: DatabaseSync, userId: string, id: string): Memo {
  const row = readMemoRow(db, userId, id);
  if (row === null) throw notFound('想法不存在');
  return toMemoDto(row);
}

/** 列表查询（游标分页 + 过滤） */
export function listMemos(
  db: DatabaseSync,
  userId: string,
  query: MemoListQuery,
  ctx: MemoWriteContext,
): MemoListResult {
  const conditions: string[] = ['m.user_id = ?', 'm.deleted_at IS NULL'];
  const params: SqlParam[] = [userId];

  // templateId（`null` 关键字 → 无模板）
  if (query.templateId !== undefined && query.templateId !== null && query.templateId !== '') {
    if (typeof query.templateId !== 'string') throw validationError('「templateId」必须是字符串');
    if (query.templateId === 'null') {
      conditions.push('m.template_id IS NULL');
    } else {
      conditions.push('m.template_id = ?');
      params.push(query.templateId);
    }
  }

  // from / to（按 created_at）
  const fromIso = readRangeBound(query.from, ctx.tz, 'from');
  const toIso = readRangeBound(query.to, ctx.tz, 'to');
  if (fromIso !== null && toIso !== null && fromIso > toIso) {
    throw validationError('开始时间不能晚于结束时间');
  }
  if (fromIso !== null) {
    conditions.push('m.created_at >= ?');
    params.push(fromIso);
  }
  if (toIso !== null) {
    conditions.push('m.created_at <= ?');
    params.push(toIso);
  }

  // tag：`json_each` 精确匹配整个标签
  const tag = readOptionalQueryString(query.tag, 'tag');
  if (tag !== null) {
    const trimmed = tag.trim();
    if (trimmed !== '') {
      conditions.push('EXISTS (SELECT 1 FROM json_each(m.tags_json) WHERE json_each.value = ?)');
      params.push(trimmed);
    }
  }

  // q：content 模糊（转义 % 与 _）
  const q = readOptionalQueryString(query.q, 'q');
  if (q !== null && q !== '') {
    conditions.push("m.content LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(q)}%`);
  }

  const limit = readLimit(query.limit);
  const cursor = readCursor(query.cursor);
  const where = conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM memos m WHERE ${where}`).get(...params) as unknown as
    | { c?: number | bigint }
    | undefined;
  const total = toCount(countRow?.c ?? 0);

  const pageConditions = [...conditions];
  const pageParams = [...params];
  if (cursor !== null) {
    pageConditions.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))');
    pageParams.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const rows = db
    .prepare(`${MEMO_SELECT} WHERE ${pageConditions.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .all(...pageParams, limit + 1) as unknown as MemoRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last !== undefined ? encodeMemoCursor(last.created_at, last.id) : null;

  return { items: pageRows.map(toMemoDto), nextCursor, total };
}

/** 局部更新想法（字段值整体替换并重新校验） */
export function updateMemo(
  db: DatabaseSync,
  userId: string,
  id: string,
  patch: MemoUpdateInput,
  ctx: MemoWriteContext,
): Memo {
  try {
    return inTransaction(db, () => {
      const row = readMemoRow(db, userId, id);
      if (row === null) throw notFound('想法不存在');

      const sets: string[] = [];
      const params: SqlParam[] = [];

      let nextContent = row.content;
      let contentChanged = false;
      if (patch.content !== undefined) {
        const content = readContent(patch.content);
        contentChanged = content !== row.content;
        nextContent = content;
        sets.push('content = ?');
        params.push(content);
      }

      if (patch.templateId !== undefined) {
        let nextTemplateId: string | null;
        if (patch.templateId === null || patch.templateId === '') {
          nextTemplateId = null;
        } else if (typeof patch.templateId === 'string') {
          nextTemplateId = patch.templateId;
        } else {
          throw validationError('「templateId」必须是字符串或 null');
        }

        const changed = nextTemplateId !== row.template_id;
        if (changed && patch.values === undefined) {
          throw validationError('切换模板时必须同时提交字段值（values），以便按新模板校验');
        }

        let nextValuesJson: string;
        if (nextTemplateId === null) {
          // 取消模板 → 清空字段值
          nextValuesJson = '{}';
        } else if (patch.values !== undefined) {
          const fields = requireActiveOwnedTemplate(db, userId, nextTemplateId);
          nextValuesJson = JSON.stringify(normalizeMemoValues(fields, asValuesObject(patch.values)));
        } else {
          nextValuesJson = row.values_json;
        }

        sets.push('template_id = ?');
        params.push(nextTemplateId);
        sets.push('values_json = ?');
        params.push(nextValuesJson);
      } else if (patch.values !== undefined) {
        if (row.template_id === null) throw validationError('未使用模板的想法不能填写字段值');
        const fields = requireActiveOwnedTemplate(db, userId, row.template_id);
        sets.push('values_json = ?');
        params.push(JSON.stringify(normalizeMemoValues(fields, asValuesObject(patch.values))));
      }

      // 标签：显式传入的 tags 参与合并；仅改内容时按新内容重算
      if (patch.tags !== undefined) {
        const tags = extractTags(nextContent, readExtraTags(patch.tags));
        sets.push('tags_json = ?');
        params.push(JSON.stringify(tags));
      } else if (contentChanged) {
        sets.push('tags_json = ?');
        params.push(JSON.stringify(extractTags(nextContent)));
      }

      if (sets.length === 0) return getMemo(db, userId, id);

      sets.push('updated_at = ?');
      params.push(nowIso());
      params.push(id, userId);
      db.prepare(`UPDATE memos SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

      return getMemo(db, userId, id);
    });
  } catch (error) {
    throw asInternalError(error, '更新想法失败，请稍后重试');
  }
}

/** 软删除（写 `deleted_at`）；重复删除 → 404 */
export function deleteMemo(db: DatabaseSync, userId: string, id: string): void {
  inTransaction(db, () => {
    const row = readMemoRow(db, userId, id);
    if (row === null) throw notFound('想法不存在');
    const now = nowIso();
    db.prepare('UPDATE memos SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      now,
      now,
      id,
      userId,
    );
  });
}

// ---------------------------------------------------------------------------
// 摘要（SPEC §8.3）
// ---------------------------------------------------------------------------

/**
 * 首页侧栏摘要：
 * `total`、`byTemplate`（**必定**含 `templateId: null` 的「无模板」项）、
 * `heatmap`（补齐区间内每一天，`count` 可为 0）、`activeDays`、
 * `longestStreak` / `currentStreak`（以 `to` 所在日为终点）、`firstMemoAt` / `lastMemoAt`。
 */
export function memoSummary(
  db: DatabaseSync,
  userId: string,
  query: MemoSummaryQuery,
  tz: string,
): MemoSummary {
  const from = readOptionalQueryString(query.from, 'from');
  const to = readOptionalQueryString(query.to, 'to');
  const range = normalizeRange({ from, to, tz });

  const rows = db
    .prepare(
      `SELECT m.created_at AS created_at, m.template_id AS template_id, t.name AS template_name
         FROM memos m
         LEFT JOIN templates t ON t.id = m.template_id
        WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.created_at >= ? AND m.created_at <= ?
        ORDER BY m.created_at ASC`,
    )
    .all(userId, range.fromIso, range.toIso) as unknown as Array<{
    created_at: string;
    template_id: string | null;
    template_name: string | null;
  }>;

  const dayCounts = new Map<string, number>();
  const templateCounts = new Map<string, number>();
  const templateNames = new Map<string, string>();
  let firstMemoAt: string | null = null;
  let lastMemoAt: string | null = null;

  for (const row of rows) {
    const dayKey = localDayKeyOf(parseIsoToEpochMs(row.created_at, 'UTC'), tz);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);

    const key = row.template_id ?? '__none__';
    templateCounts.set(key, (templateCounts.get(key) ?? 0) + 1);
    if (row.template_id !== null && !templateNames.has(row.template_id)) {
      templateNames.set(row.template_id, row.template_name ?? '（已删除模板）');
    }

    if (firstMemoAt === null || row.created_at < firstMemoAt) firstMemoAt = row.created_at;
    if (lastMemoAt === null || row.created_at > lastMemoAt) lastMemoAt = row.created_at;
  }

  const dayKeys = enumerateDayKeys(range.fromDayKey, range.toDayKey);
  const heatmap = dayKeys.map((date) => ({ date, count: dayCounts.get(date) ?? 0 }));
  const activeDays = new Set(dayCounts.keys());
  const { longest, current } = streaks(activeDays, dayKeys, dayKeyDiff);

  const byTemplate: MemoSummary['byTemplate'] = [
    { templateId: null, templateName: '无模板', count: templateCounts.get('__none__') ?? 0 },
  ];
  for (const [key, count] of templateCounts) {
    if (key === '__none__') continue;
    byTemplate.push({ templateId: key, templateName: templateNames.get(key) ?? '（已删除模板）', count });
  }
  byTemplate.sort(
    (a, b) => b.count - a.count || a.templateName.localeCompare(b.templateName, 'zh-Hans-CN'),
  );

  return {
    total: rows.length,
    byTemplate,
    heatmap,
    activeDays: activeDays.size,
    longestStreak: longest,
    currentStreak: current,
    firstMemoAt,
    lastMemoAt,
  };
}
