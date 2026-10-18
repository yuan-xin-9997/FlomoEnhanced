/**
 * 模板领域逻辑（SPEC §5、§7、§8.2）—— 归 A2。
 *
 * 设计要点：
 * - **多用户隔离**：所有查询都带 `user_id = ?`；越权访问与「不存在」返回同样的 `404 NOT_FOUND`，
 *   绝不返回 403（避免泄露资源是否存在）。
 * - **SQL**：全部参数化 + 显式列名（`TEMPLATE_COLUMNS`，禁止 `SELECT *`）；写操作包在事务里。
 * - **字段值/字段定义校验**：一律复用 `@flomo/shared` 的 `validateTemplateFields` / `parseTemplateFile` /
 *   `buildTemplateFile`，本模块不重复实现这些规则。
 * - **memoCount**：用一条 `GROUP BY` 聚合查询一次性取回，杜绝 N+1。
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  buildTemplateFile,
  charLength,
  parseTemplateFile,
  validateTemplateFields,
  type FieldDefinition,
  type Template,
  type TemplateFile,
  type TemplateFileEntry,
  type TemplateImportMode,
  type TemplateImportResult,
} from '@flomo/shared';
import { AppError, conflict, notFound, validationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';

/** 模板名称长度上限（SPEC §8.2 之外的实现约束，用于错误文案） */
export const TEMPLATE_NAME_MAX = 60;
/** 模板描述长度上限 */
export const TEMPLATE_DESCRIPTION_MAX = 500;
/** 模板图标长度上限 */
export const TEMPLATE_ICON_MAX = 8;
/** 模板颜色格式（`#RRGGBB`，空串允许表示「无颜色」） */
export const TEMPLATE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** templates 表显式列（禁止 `SELECT *`） */
const TEMPLATE_COLUMNS =
  'id, user_id, name, description, icon, color, fields_json, version, created_at, updated_at, archived_at';

/** SQL 参数类型 */
type SqlParam = string | number | null;

interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** 创建模板的输入（字段为 `unknown`：来自请求体，需自行校验） */
export interface TemplateCreateInput {
  name: unknown;
  description?: unknown;
  icon?: unknown;
  color?: unknown;
  fields: unknown;
}

/** 局部更新模板的输入 */
export interface TemplateUpdateInput {
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  color?: unknown;
  fields?: unknown;
}

/** 列表查询选项 */
export interface ListTemplatesOptions {
  /** 是否包含已归档模板，默认 false */
  includeArchived?: boolean;
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

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

/** 数据库异常 → 统一错误（保留业务错误原文，避免把 SQLite 细节暴露给客户端） */
function asTemplateError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  if (isUniqueViolation(error)) return conflict('同名的模板已存在');
  return new AppError('INTERNAL', fallback);
}

// ---------------------------------------------------------------------------
// 输入校验（中文文案，失败抛 422 VALIDATION_FAILED）
// ---------------------------------------------------------------------------

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') throw validationError('「name」必须是字符串');
  const name = raw.trim();
  const length = charLength(name);
  if (length < 1 || length > TEMPLATE_NAME_MAX) {
    throw validationError(`模板名称需要 1..${TEMPLATE_NAME_MAX} 个字符`);
  }
  return name;
}

function normalizeDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw validationError('「description」必须是字符串');
  if (charLength(raw) > TEMPLATE_DESCRIPTION_MAX) {
    throw validationError(`模板描述不能超过 ${TEMPLATE_DESCRIPTION_MAX} 个字符`);
  }
  return raw;
}

function normalizeIcon(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw validationError('「icon」必须是字符串');
  if (charLength(raw) > TEMPLATE_ICON_MAX) {
    throw validationError(`模板图标不能超过 ${TEMPLATE_ICON_MAX} 个字符`);
  }
  return raw;
}

function normalizeColor(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw validationError('「color」必须是字符串');
  const color = raw.trim();
  if (color === '') return '';
  if (!TEMPLATE_COLOR_PATTERN.test(color)) throw validationError('「color」必须是 #RRGGBB 格式的颜色值');
  return color;
}

/** 校验字段定义（复用 shared），失败时 422 + `details` 为错误数组 */
function normalizeFields(raw: unknown): FieldDefinition[] {
  const errors = validateTemplateFields(raw);
  if (errors.length > 0) throw validationError('模板字段定义不合法', errors);
  return raw as FieldDefinition[];
}

function parseFields(json: string): FieldDefinition[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as FieldDefinition[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 读取 / DTO 映射
// ---------------------------------------------------------------------------

function toTemplateDto(row: TemplateRow, memoCount: number): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    fields: parseFields(row.fields_json),
    version: row.version,
    memoCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

/** 按 id + user_id 读取模板行（跨用户返回 null，由调用方转 404） */
function readTemplateRow(db: DatabaseSync, userId: string, id: string): TemplateRow | null {
  if (typeof id !== 'string' || id === '') return null;
  const row = db
    .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE id = ? AND user_id = ? LIMIT 1`)
    .get(id, userId) as unknown as TemplateRow | undefined;
  return row ?? null;
}

/** 读取模板行，不存在或不属于当前用户 → 404 NOT_FOUND（不泄露存在性） */
function readTemplateRowOrThrow(db: DatabaseSync, userId: string, id: string): TemplateRow {
  const row = readTemplateRow(db, userId, id);
  if (row === null) throw notFound('模板不存在');
  return row;
}

/** 同名的模板行（任意归档状态；`UNIQUE(user_id, name)` 与归档无关） */
function findRowByName(db: DatabaseSync, userId: string, name: string): TemplateRow | null {
  const row = db
    .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE user_id = ? AND name = ? LIMIT 1`)
    .get(userId, name) as unknown as TemplateRow | undefined;
  return row ?? null;
}

function nameExists(db: DatabaseSync, userId: string, name: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM templates WHERE user_id = ? AND name = ? LIMIT 1').get(userId, name) as
    | { ok?: number }
    | undefined;
  return row !== undefined;
}

/** 该用户全部模板的未删除想法数（一条 GROUP BY 聚合，禁止 N+1） */
function memoCountsByTemplate(db: DatabaseSync, userId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT template_id AS template_id, COUNT(*) AS c
         FROM memos
        WHERE user_id = ? AND deleted_at IS NULL AND template_id IS NOT NULL
        GROUP BY template_id`,
    )
    .all(userId) as unknown as Array<{ template_id: string; c: number | bigint }>;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.template_id, toCount(row.c));
  return counts;
}

function memoCountOf(db: DatabaseSync, userId: string, templateId: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS c FROM memos WHERE user_id = ? AND template_id = ? AND deleted_at IS NULL',
    )
    .get(userId, templateId) as unknown as { c?: number | bigint } | undefined;
  return toCount(row?.c ?? 0);
}

function toCount(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

/** 读取单个模板 DTO（404 语义） */
export function getTemplate(db: DatabaseSync, userId: string, id: string): Template {
  const row = readTemplateRowOrThrow(db, userId, id);
  return toTemplateDto(row, memoCountOf(db, userId, row.id));
}

// ---------------------------------------------------------------------------
// 唯一名称（副本 / 导入 rename 共用）
// ---------------------------------------------------------------------------

/** 生成不冲突的名称：`base`、`base 2`、`base 3`…（总长不超过 60 字符） */
function uniqueName(db: DatabaseSync, userId: string, base: string): string {
  const trimmed = base.trim() === '' ? '模板' : base.trim();
  const first = charLength(trimmed) > TEMPLATE_NAME_MAX ? Array.from(trimmed).slice(0, TEMPLATE_NAME_MAX).join('') : trimmed;
  if (!nameExists(db, userId, first)) return first;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = ` ${suffix}`;
    const head = Array.from(trimmed).slice(0, Math.max(1, TEMPLATE_NAME_MAX - tail.length)).join('');
    const candidate = `${head}${tail}`;
    if (!nameExists(db, userId, candidate)) return candidate;
  }
  return `${Array.from(trimmed).slice(0, 40).join('')} ${newId().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 写入一条模板行并返回 DTO */
function insertTemplate(
  db: DatabaseSync,
  userId: string,
  name: string,
  data: { description: string; icon: string; color: string; fields: FieldDefinition[] },
  version: number,
): Template {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO templates (${TEMPLATE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    name,
    data.description,
    data.icon,
    data.color,
    JSON.stringify(data.fields),
    version,
    now,
    now,
    null,
  );
  return getTemplate(db, userId, id);
}

/** 创建模板：校验名称/描述/图标/颜色/字段定义，同名 → 409 */
export function createTemplate(db: DatabaseSync, userId: string, input: TemplateCreateInput): Template {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const icon = normalizeIcon(input.icon);
  const color = normalizeColor(input.color);
  const fields = normalizeFields(input.fields);

  try {
    return inTransaction(db, () => {
      if (nameExists(db, userId, name)) throw conflict('同名的模板已存在');
      return insertTemplate(db, userId, name, { description, icon, color, fields }, 1);
    });
  } catch (error) {
    throw asTemplateError(error, '创建模板失败，请稍后重试');
  }
}

/** 模板列表：默认按 `updated_at DESC`，各条带 `memoCount` */
export function listTemplates(db: DatabaseSync, userId: string, options: ListTemplatesOptions = {}): Template[] {
  const sql = options.includeArchived
    ? `SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE user_id = ? ORDER BY updated_at DESC, id DESC`
    : `SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id DESC`;
  const rows = db.prepare(sql).all(userId) as unknown as TemplateRow[];
  const counts = memoCountsByTemplate(db, userId);
  return rows.map((row) => toTemplateDto(row, counts.get(row.id) ?? 0));
}

/** 局部更新：`fields` 整体替换并 `version + 1`；改名同样检查唯一冲突 */
export function updateTemplate(
  db: DatabaseSync,
  userId: string,
  id: string,
  patch: TemplateUpdateInput,
): Template {
  try {
    return inTransaction(db, () => {
      const row = readTemplateRowOrThrow(db, userId, id);

      const sets: string[] = [];
      const params: SqlParam[] = [];

      if (patch.name !== undefined) {
        const name = normalizeName(patch.name);
        if (name !== row.name && nameExists(db, userId, name)) throw conflict('同名的模板已存在');
        sets.push('name = ?');
        params.push(name);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(normalizeDescription(patch.description));
      }
      if (patch.icon !== undefined) {
        sets.push('icon = ?');
        params.push(normalizeIcon(patch.icon));
      }
      if (patch.color !== undefined) {
        sets.push('color = ?');
        params.push(normalizeColor(patch.color));
      }
      if (patch.fields !== undefined) {
        const fields = normalizeFields(patch.fields);
        sets.push('fields_json = ?');
        params.push(JSON.stringify(fields));
        sets.push('version = ?');
        params.push(row.version + 1);
      }

      if (sets.length === 0) return getTemplate(db, userId, id);

      sets.push('updated_at = ?');
      params.push(nowIso());
      params.push(id, userId);
      db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

      return getTemplate(db, userId, id);
    });
  } catch (error) {
    throw asTemplateError(error, '更新模板失败，请稍后重试');
  }
}

/** 软删除（归档）：写 `archived_at`；已归档再归档是幂等的 */
export function archiveTemplate(db: DatabaseSync, userId: string, id: string): Template {
  return inTransaction(db, () => {
    readTemplateRowOrThrow(db, userId, id);
    const now = nowIso();
    db.prepare('UPDATE templates SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      now,
      now,
      id,
      userId,
    );
    return getTemplate(db, userId, id);
  });
}

/** 取消归档（恢复） */
export function restoreTemplate(db: DatabaseSync, userId: string, id: string): Template {
  return inTransaction(db, () => {
    readTemplateRowOrThrow(db, userId, id);
    db.prepare('UPDATE templates SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(
      nowIso(),
      id,
      userId,
    );
    return getTemplate(db, userId, id);
  });
}

/**
 * 硬删除：删除模板行，并把关联 memo 的 `template_id` 置 NULL。
 * **不删除想法**，`values_json` 原样保留（历史值仍可查看）。
 */
export function hardDeleteTemplate(db: DatabaseSync, userId: string, id: string): void {
  inTransaction(db, () => {
    readTemplateRowOrThrow(db, userId, id);
    db.prepare('UPDATE memos SET template_id = NULL WHERE user_id = ? AND template_id = ?').run(userId, id);
    db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId);
  });
}

/** 复制为「<原名> 副本」（冲突时追加 ` 2`、` 3`…）；字段定义深拷贝、key 保持不变 */
export function duplicateTemplate(db: DatabaseSync, userId: string, id: string): Template {
  return inTransaction(db, () => {
    const source = readTemplateRowOrThrow(db, userId, id);
    const name = uniqueName(db, userId, `${source.name} 副本`);
    return insertTemplate(
      db,
      userId,
      name,
      {
        description: source.description,
        icon: source.icon,
        color: source.color,
        // `parseFields` 从 JSON 字符串重建对象，天然是深拷贝（key 原样保留）
        fields: parseFields(source.fields_json),
      },
      1,
    );
  });
}

// ---------------------------------------------------------------------------
// 导入 / 导出（SPEC §7）
// ---------------------------------------------------------------------------

/**
 * 导出为 `.flomo-template.json` 结构。
 * - `ids` 为空 → 导出全部**未归档**模板；
 * - 指定 `ids` → 只导出这些模板；其中任何一个不存在或不属于当前用户 → 404。
 */
export function exportTemplates(
  db: DatabaseSync,
  userId: string,
  ids?: readonly string[] | null,
  appVersion = '1.0.0',
): TemplateFile {
  const rows: TemplateRow[] = [];
  const wanted = (ids ?? []).map((value) => (typeof value === 'string' ? value.trim() : '')).filter((v) => v !== '');

  if (wanted.length > 0) {
    const seen = new Set<string>();
    for (const templateId of wanted) {
      if (seen.has(templateId)) continue;
      seen.add(templateId);
      rows.push(readTemplateRowOrThrow(db, userId, templateId));
    }
  } else {
    const all = db
      .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM templates WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC`)
      .all(userId) as unknown as TemplateRow[];
    rows.push(...all);
  }

  return buildTemplateFile(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      fields: parseFields(row.fields_json),
      version: row.version,
    })),
    appVersion,
  );
}

function normalizeRawFile(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw validationError('导入文件不是合法的 JSON');
  }
}

/** 校验导入文件的**整体**头部（format / formatVersion / templates 数组） */
export function inspectTemplateFileHeader(raw: unknown): { ok: true } | { ok: false; message: string } {
  const value = normalizeRawFile(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: '导入文件顶层必须是对象' };
  }
  const record = value as Record<string, unknown>;
  if (record.format !== TEMPLATE_FILE_FORMAT) {
    return { ok: false, message: `文件格式不匹配：需要 format = "${TEMPLATE_FILE_FORMAT}"` };
  }
  if (record.formatVersion !== TEMPLATE_FILE_VERSION) {
    return {
      ok: false,
      message: `文件版本不受支持：需要 formatVersion = ${TEMPLATE_FILE_VERSION}，实际为 ${String(record.formatVersion)}`,
    };
  }
  if (!Array.isArray(record.templates)) return { ok: false, message: 'templates 必须是数组' };
  return { ok: true };
}

function isImportMode(value: unknown): value is TemplateImportMode {
  return value === 'skip' || value === 'rename' || value === 'overwrite';
}

/** 单条导入项的额外约束（`parseTemplateFile` 已校验字段定义） */
function validateImportEntry(entry: TemplateFileEntry): string | null {
  const nameLength = charLength(entry.name);
  if (nameLength < 1 || nameLength > TEMPLATE_NAME_MAX) {
    return `模板名称需要 1..${TEMPLATE_NAME_MAX} 个字符`;
  }
  if (charLength(entry.description) > TEMPLATE_DESCRIPTION_MAX) {
    return `模板描述不能超过 ${TEMPLATE_DESCRIPTION_MAX} 个字符`;
  }
  if (charLength(entry.icon) > TEMPLATE_ICON_MAX) {
    return `模板图标不能超过 ${TEMPLATE_ICON_MAX} 个字符`;
  }
  if (entry.color !== '' && !TEMPLATE_COLOR_PATTERN.test(entry.color)) {
    return '模板颜色必须是 #RRGGBB 格式';
  }
  return null;
}

function entryNameOf(entry: unknown, index: number): string {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const name = (entry as Record<string, unknown>).name;
    if (typeof name === 'string') return name;
  }
  return `第 ${index + 1} 个模板`;
}

/**
 * 导入模板（SPEC §7）。
 *
 * - 头部（format / formatVersion / templates）不合法由调用方先转 400（见 `inspectTemplateFileHeader`），
 *   这里再校验一次并抛 422 作为兜底；
 * - 逐条用 `parseTemplateFile`（配合单条文件）校验，**单条非法只记录到 `errors`**（含 `index`/`name`/中文 `message`），
 *   其余条目照常导入；
 * - 三种冲突模式：`rename`（默认，同名自动加 ` 2`/` 3`…）、`skip`（同名进 `skipped`）、
 *   `overwrite`（覆盖字段与描述、`version + 1`，**保留 id 与已有关联的想法**）；
 * - 整个导入过程在**一个事务**里；返回的 `imported`/`overwritten` 都是从库里读回的真实记录（含 `memoCount`）。
 */
export function importTemplates(
  db: DatabaseSync,
  userId: string,
  raw: unknown,
  mode: TemplateImportMode = 'rename',
  appVersion = '1.0.0',
): TemplateImportResult {
  void appVersion;
  if (!isImportMode(mode)) throw validationError('导入模式非法，只能是 rename / skip / overwrite');

  const value = normalizeRawFile(raw);
  const header = inspectTemplateFileHeader(value);
  if (!header.ok) throw validationError(header.message);

  const record = value as Record<string, unknown>;
  const entries = record.templates as unknown[];

  const imported: Template[] = [];
  const overwritten: Template[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const errors: Array<{ index: number; name: string; message: string }> = [];

  try {
    inTransaction(db, () => {
      entries.forEach((entry, index) => {
        const fallbackName = entryNameOf(entry, index);

        // 逐条校验：把该条当作「只含一个模板」的文件交给 parseTemplateFile（复用 shared 的全部规则）
        const single = parseTemplateFile({
          format: TEMPLATE_FILE_FORMAT,
          formatVersion: TEMPLATE_FILE_VERSION,
          exportedAt: record.exportedAt,
          app: record.app,
          templates: [entry],
        });
        if (!single.ok) {
          errors.push({ index, name: fallbackName, message: single.message });
          return;
        }
        const parsed = single.file.templates[0];
        if (parsed === undefined) {
          errors.push({ index, name: fallbackName, message: '模板数据缺失' });
          return;
        }
        const extraError = validateImportEntry(parsed);
        if (extraError !== null) {
          errors.push({ index, name: parsed.name, message: extraError });
          return;
        }

        const existing = findRowByName(db, userId, parsed.name);
        if (existing !== null) {
          if (mode === 'skip') {
            skipped.push({ name: parsed.name, reason: '同名模板已存在，已跳过' });
            return;
          }
          if (mode === 'overwrite') {
            db.prepare(
              'UPDATE templates SET description = ?, icon = ?, color = ?, fields_json = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            ).run(
              parsed.description,
              parsed.icon,
              parsed.color,
              JSON.stringify(parsed.fields),
              existing.version + 1,
              nowIso(),
              existing.id,
              userId,
            );
            overwritten.push(getTemplate(db, userId, existing.id));
            return;
          }
          // rename：与库里（含本批次此前插入的）不重名
          const renamed = uniqueName(db, userId, parsed.name);
          imported.push(
            insertTemplate(
              db,
              userId,
              renamed,
              {
                description: parsed.description,
                icon: parsed.icon,
                color: parsed.color,
                fields: parsed.fields,
              },
              1,
            ),
          );
          return;
        }

        imported.push(
          insertTemplate(
            db,
            userId,
            parsed.name,
            {
              description: parsed.description,
              icon: parsed.icon,
              color: parsed.color,
              fields: parsed.fields,
            },
            1,
          ),
        );
      });
    });
  } catch (error) {
    throw asTemplateError(error, '导入模板失败，请稍后重试');
  }

  return { imported, skipped, overwritten, errors };
}
