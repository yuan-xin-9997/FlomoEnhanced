/**
 * 模板导入/导出文件格式（SPEC §7）。
 */
import type { FieldDefinition } from './fieldTypes.js';
import { validateTemplateFields } from './fieldTypes.js';

/** 文件格式标识 */
export const TEMPLATE_FILE_FORMAT = 'flomo-enhanced-template';

/** 当前文件格式版本 */
export const TEMPLATE_FILE_VERSION = 1;

/** 模板文件中的应用信息 */
export interface TemplateFileApp {
  name: string;
  version: string;
}

/** 模板文件中的单个模板 */
export interface TemplateFileEntry {
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldDefinition[];
  templateVersion: number;
  /** 原模板 id（导入时忽略，仅作追溯） */
  exportedId: string;
}

/** `.flomo-template.json` 文件结构 */
export interface TemplateFile {
  format: typeof TEMPLATE_FILE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  app: TemplateFileApp;
  templates: TemplateFileEntry[];
}

/** 导出时需要的模板信息（Template DTO 的子集） */
export interface TemplateExportSource {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldDefinition[];
  version: number;
}

/** 解析结果 */
export type ParseTemplateFileResult =
  | { ok: true; file: TemplateFile }
  | { ok: false; message: string };

/** 构建可下载的模板文件对象 */
export function buildTemplateFile(templates: readonly TemplateExportSource[], appVersion: string): TemplateFile {
  return {
    format: TEMPLATE_FILE_FORMAT,
    formatVersion: TEMPLATE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: 'FlomoEnhanced', version: appVersion },
    templates: templates.map((template) => ({
      name: template.name,
      description: template.description ?? '',
      icon: template.icon ?? '',
      color: template.color ?? '',
      fields: template.fields,
      templateVersion: template.version ?? 1,
      exportedId: template.id,
    })),
  };
}

/** 解析并校验模板文件；失败返回中文原因 */
export function parseTemplateFile(raw: unknown): ParseTemplateFileResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, message: '文件不是合法的 JSON' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: '文件顶层必须是对象' };
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
  if (!Array.isArray(record.templates)) {
    return { ok: false, message: 'templates 必须是数组' };
  }

  const entries: TemplateFileEntry[] = [];
  for (let index = 0; index < record.templates.length; index += 1) {
    const item = record.templates[index];
    if (!item || typeof item !== 'object') {
      return { ok: false, message: `第 ${index + 1} 个模板不是对象` };
    }
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      return { ok: false, message: `第 ${index + 1} 个模板缺少名称` };
    }
    if (!Array.isArray(entry.fields)) {
      return { ok: false, message: `模板「${name}」缺少 fields 数组` };
    }
    const fieldErrors = validateTemplateFields(entry.fields);
    if (fieldErrors.length > 0) {
      return { ok: false, message: `模板「${name}」字段定义非法：${fieldErrors.join('；')}` };
    }
    const templateVersion = typeof entry.templateVersion === 'number' && Number.isInteger(entry.templateVersion) && entry.templateVersion > 0
      ? entry.templateVersion
      : 1;
    entries.push({
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      icon: typeof entry.icon === 'string' ? entry.icon : '',
      color: typeof entry.color === 'string' ? entry.color : '',
      fields: entry.fields as FieldDefinition[],
      templateVersion,
      exportedId: typeof entry.exportedId === 'string' ? entry.exportedId : '',
    });
  }

  const appRaw = record.app && typeof record.app === 'object' ? (record.app as Record<string, unknown>) : {};
  const exportedAt = typeof record.exportedAt === 'string' && Number.isFinite(Date.parse(record.exportedAt))
    ? record.exportedAt
    : new Date().toISOString();

  return {
    ok: true,
    file: {
      format: TEMPLATE_FILE_FORMAT,
      formatVersion: TEMPLATE_FILE_VERSION,
      exportedAt,
      app: {
        name: typeof appRaw.name === 'string' ? appRaw.name : 'FlomoEnhanced',
        version: typeof appRaw.version === 'string' ? appRaw.version : '0.0.0',
      },
      templates: entries,
    },
  };
}

/** FNV-1a 32 位哈希（用于中文标签生成稳定的 key 片段） */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 由标签生成合法的字段 key（`/^[a-z][a-z0-9_]{0,39}$/`）。
 * - 英文/数字标签：转小写、非字母数字转 `_`
 * - 纯中文（无可用 ASCII）标签：用 FNV-1a 哈希片段（`f` + base36），保证稳定
 * - 传入 `existingKeys` 时冲突自动加 `_2`、`_3`… 后缀
 */
export function slugifyKey(label: string, existingKeys: Iterable<string> = []): string {
  const raw = typeof label === 'string' ? label : '';
  let ascii = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (ascii === '' || !/^[a-z]/.test(ascii)) {
    const hash = fnv1a(raw.trim() === '' ? 'field' : raw.trim());
    ascii = /^[a-z]/.test(ascii) ? `${ascii}_f${hash}` : `f${hash}`;
  }
  let base = ascii.slice(0, 40);
  if (base === '') base = 'field';

  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `_${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 40 - tail.length))}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
  const fallback = `f${fnv1a(`${raw}-${taken.size}`)}`.slice(0, 40);
  return fallback;
}

/** 为一批字段补全 key（在模板导入时使用） */
export function assignMissingKeys(fields: readonly Partial<FieldDefinition>[], existingKeys: Iterable<string> = []): string[] {
  const taken = [...existingKeys];
  return fields.map((field) => {
    const key = typeof field.key === 'string' && field.key !== '' ? field.key : slugifyKey(field.label ?? '', taken);
    taken.push(key);
    return key;
  });
}
