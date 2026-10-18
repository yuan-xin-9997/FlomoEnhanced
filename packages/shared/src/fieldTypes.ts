/**
 * 字段类型定义与取值归一化（SPEC §6）。
 * 本文件是前后端共用的唯一实现：前端表单校验、后端入库校验都调用这里。
 */

/** 12 种字段类型（SPEC §6） */
export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'rating'
  | 'url';

/** 字段取值：字符串 / 数字 / 布尔 / 字符串数组 / 空 */
export type FieldValue = string | number | boolean | string[] | null;

/** 选择型字段的候选项 */
export interface FieldOption {
  value: string;
  /** 显示名 */
  label: string;
  /** 前端徽标色（可选，如 #3b82f6） */
  color?: string;
}

/** 字段定义（SPEC §6） */
export interface FieldDefinition {
  /** 机器名：/^[a-z][a-z0-9_]{0,39}$/，模板内唯一、不可变 */
  key: string;
  /** 显示名：1..40 字符 */
  label: string;
  type: FieldType;
  /** 默认 false */
  required?: boolean;
  /** 帮助文字：≤120 */
  help?: string;
  /** 占位文字：≤60 */
  placeholder?: string;
  defaultValue?: FieldValue;

  // number / currency / percent / rating
  min?: number;
  max?: number;
  step?: number;
  /** 小数位 0..6，默认 number/percent 2、currency 2、rating 0 */
  precision?: number;
  /** 仅 currency：ISO-4217 三字母大写，默认 'CNY' */
  currency?: string;
  /** 仅 rating：满分，默认 5 */
  scale?: number;

  // text / longtext / url
  /** text 默认 200，longtext 默认 5000 */
  maxLength?: number;

  // select / multiselect
  options?: FieldOption[];
}

/** 字段类型元信息（前端表单渲染 / 后端推导默认值共用） */
export interface FieldTypeMeta {
  type: FieldType;
  /** 中文名 */
  label: string;
  /** 是否数值型（参与数值统计） */
  numeric: boolean;
  /** 是否选择型（有 options） */
  choice: boolean;
  /** 新建字段时的默认值 */
  defaultValue: FieldValue;
  /** 是否必须提供 options */
  requiresOptions: boolean;
  /** 默认小数位（仅数值型有意义；rating 为 0） */
  precision: number;
  /** 默认最大长度（仅 text / longtext / url 有意义） */
  maxLength?: number;
  /** 表格/表单中的展示排序序号（越小越前） */
  order: number;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|z|[+-]\d{2}:?\d{2})$/;

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  text: {
    type: 'text',
    label: '单行文本',
    numeric: false,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    maxLength: 200,
    order: 1,
  },
  longtext: {
    type: 'longtext',
    label: '多行文本',
    numeric: false,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    maxLength: 5000,
    order: 2,
  },
  number: {
    type: 'number',
    label: '数字',
    numeric: true,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 2,
    order: 3,
  },
  currency: {
    type: 'currency',
    label: '金额',
    numeric: true,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 2,
    order: 4,
  },
  percent: {
    type: 'percent',
    label: '百分比',
    numeric: true,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 2,
    order: 5,
  },
  rating: {
    type: 'rating',
    label: '评分',
    numeric: true,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    order: 6,
  },
  date: {
    type: 'date',
    label: '日期',
    numeric: false,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    order: 7,
  },
  datetime: {
    type: 'datetime',
    label: '日期时间',
    numeric: false,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    order: 8,
  },
  select: {
    type: 'select',
    label: '单选',
    numeric: false,
    choice: true,
    defaultValue: null,
    requiresOptions: true,
    precision: 0,
    order: 9,
  },
  multiselect: {
    type: 'multiselect',
    label: '多选',
    numeric: false,
    choice: true,
    defaultValue: [],
    requiresOptions: true,
    precision: 0,
    order: 10,
  },
  boolean: {
    type: 'boolean',
    label: '是/否',
    numeric: false,
    choice: false,
    defaultValue: false,
    requiresOptions: false,
    precision: 0,
    order: 11,
  },
  url: {
    type: 'url',
    label: '链接',
    numeric: false,
    choice: false,
    defaultValue: null,
    requiresOptions: false,
    precision: 0,
    maxLength: 2048,
    order: 12,
  },
};

/** 全部字段类型，按展示序号排列 */
export const FIELD_TYPES: FieldType[] = (Object.keys(FIELD_TYPE_META) as FieldType[]).sort(
  (a, b) => FIELD_TYPE_META[a].order - FIELD_TYPE_META[b].order,
);

/** 数值型字段类型（参与 numeric/trend 统计） */
export const NUMERIC_FIELD_TYPES: FieldType[] = FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].numeric);

/** 选择型字段类型 */
export const CHOICE_FIELD_TYPES: FieldType[] = FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].choice);

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIELD_TYPE_META, value);
}

/** 按 code point 计算字符数（emoji / 中文安全） */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/** 按 code point 截断 */
export function truncateChars(value: string, maxChars: number): string {
  const chars = Array.from(value);
  return chars.length <= maxChars ? value : chars.slice(0, maxChars).join('');
}

/** 字段定义的有效最大长度 */
export function effectiveMaxLength(def: FieldDefinition): number | undefined {
  if (def.maxLength !== undefined) return def.maxLength;
  return FIELD_TYPE_META[def.type].maxLength;
}

/** 字段定义的有效小数位 */
export function effectivePrecision(def: FieldDefinition): number {
  if (typeof def.precision === 'number') return def.precision;
  return FIELD_TYPE_META[def.type].precision;
}

/** 字段定义的有效币种 */
export function effectiveCurrency(def: FieldDefinition): string {
  return def.currency ?? 'CNY';
}

/** 字段定义的有效评分满分 */
export function effectiveScale(def: FieldDefinition): number {
  return typeof def.scale === 'number' ? def.scale : 5;
}

/** 归一化结果 */
export type NormalizeResult =
  | { ok: true; value: FieldValue }
  | { ok: false; message: string };

function ok(value: FieldValue): NormalizeResult {
  return { ok: true, value };
}

function fail(message: string): NormalizeResult {
  return { ok: false, message };
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 判断是否为空值（null / 空串 / 空数组；`false` 与 `0` 视为有值） */
export function isFieldValueEmpty(value: FieldValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 按字段定义归一化取值（SPEC §6 归一化表）。
 * 空值统一为 `null`（multiselect 为 `[]`）。
 */
export function normalizeFieldValue(def: FieldDefinition, raw: unknown): NormalizeResult {
  const label = def.label || def.key;

  switch (def.type) {
    case 'text':
    case 'longtext': {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`「${label}」必须是文本`);
      const value = raw.trim();
      if (value === '') return ok(null);
      const max = effectiveMaxLength(def);
      if (max !== undefined && charLength(value) > max) {
        return fail(`「${label}」长度不能超过 ${max} 个字符`);
      }
      return ok(value);
    }

    case 'url': {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`「${label}」必须是链接文本`);
      const value = raw.trim();
      const max = effectiveMaxLength(def);
      if (max !== undefined && charLength(value) > max) {
        return fail(`「${label}」长度不能超过 ${max} 个字符`);
      }
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return fail(`「${label}」必须是合法的 http/https 链接`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail(`「${label}」只支持 http/https 链接`);
      }
      return ok(value);
    }

    case 'number':
    case 'currency':
    case 'percent': {
      if (isBlank(raw)) return ok(null);
      const num = toFiniteNumber(raw);
      if (num === null) return fail(`「${label}」必须是数字`);
      if (def.type === 'percent' && (num < 0 || num > 100)) {
        return fail(`「${label}」必须在 0 到 100 之间`);
      }
      if (def.min !== undefined && num < def.min) return fail(`「${label}」不能小于 ${def.min}`);
      if (def.max !== undefined && num > def.max) return fail(`「${label}」不能大于 ${def.max}`);
      return ok(num);
    }

    case 'rating': {
      if (isBlank(raw)) return ok(null);
      const num = toFiniteNumber(raw);
      if (num === null) return fail(`「${label}」必须是数字`);
      if (!Number.isInteger(num)) return fail(`「${label}」必须是整数评分`);
      const scale = effectiveScale(def);
      if (num < 0 || num > scale) return fail(`「${label}」必须在 0 到 ${scale} 之间`);
      return ok(num);
    }

    case 'date': {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`「${label}」必须是 YYYY-MM-DD 格式的日期`);
      const value = raw.trim();
      if (!DATE_PATTERN.test(value)) return fail(`「${label}」必须是 YYYY-MM-DD 格式的日期`);
      const [y, m, d] = value.split('-').map((part) => Number(part));
      if (y === undefined || m === undefined || d === undefined || !isValidCalendarDate(y, m, d)) {
        return fail(`「${label}」不是合法的日期`);
      }
      return ok(value);
    }

    case 'datetime': {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`「${label}」必须是带时区的 ISO-8601 时间`);
      const value = raw.trim();
      if (!DATETIME_PATTERN.test(value)) return fail(`「${label}」必须是带时区的 ISO-8601 时间`);
      if (!Number.isFinite(Date.parse(value))) return fail(`「${label}」不是合法的时间`);
      return ok(value);
    }

    case 'select': {
      if (isBlank(raw)) return ok(null);
      if (typeof raw !== 'string') return fail(`「${label}」必须是选项值`);
      const value = raw.trim();
      const options = def.options ?? [];
      if (!options.some((option) => option.value === value)) {
        return fail(`「${label}」的取值不在候选项中`);
      }
      return ok(value);
    }

    case 'multiselect': {
      const options = def.options ?? [];
      if (raw === undefined || raw === null || raw === '') return ok([]);
      if (typeof raw === 'string') {
        const single = raw.trim();
        if (single === '') return ok([]);
        if (!options.some((option) => option.value === single)) {
          return fail(`「${label}」的取值不在候选项中`);
        }
        return ok([single]);
      }
      if (!Array.isArray(raw)) return fail(`「${label}」必须是选项值数组`);
      const picked = new Set<string>();
      for (const item of raw) {
        if (item === undefined || item === null || item === '') continue;
        if (typeof item !== 'string') return fail(`「${label}」必须是选项值数组`);
        const value = item.trim();
        if (value === '') continue;
        if (!options.some((option) => option.value === value)) {
          return fail(`「${label}」的取值「${value}」不在候选项中`);
        }
        picked.add(value);
      }
      // 排序稳定：按 options 定义的顺序输出
      const ordered = options.filter((option) => picked.has(option.value)).map((option) => option.value);
      return ok(ordered);
    }

    case 'boolean': {
      if (raw === undefined || raw === null || raw === '') return ok(null);
      if (typeof raw === 'boolean') return ok(raw);
      if (typeof raw === 'number') {
        if (raw === 1) return ok(true);
        if (raw === 0) return ok(false);
        return fail(`「${label}」必须是布尔值`);
      }
      if (typeof raw === 'string') {
        const value = raw.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', '是', '真'].includes(value)) return ok(true);
        if (['false', '0', 'no', 'n', '否', '假'].includes(value)) return ok(false);
      }
      return fail(`「${label}」必须是「是」或「否」`);
    }

    default: {
      const exhaustive: never = def.type;
      return fail(`「${label}」的字段类型非法：${String(exhaustive)}`);
    }
  }
}

/** 校验单个字段定义，返回中文错误信息数组（空数组表示通过） */
export function validateFieldDefinition(def: FieldDefinition): string[] {
  const errors: string[] = [];
  const name = typeof def.label === 'string' && def.label.trim() !== '' ? `「${def.label}」` : `字段「${def.key}」`;

  if (typeof def.key !== 'string' || !KEY_PATTERN.test(def.key)) {
    errors.push(`${name}的 key 必须匹配 /^[a-z][a-z0-9_]{0,39}$/`);
  }
  if (typeof def.label !== 'string' || def.label.trim() === '') {
    errors.push(`字段「${def.key}」的显示名不能为空`);
  } else if (charLength(def.label) > 40) {
    errors.push(`${name}的显示名不能超过 40 个字符`);
  }
  if (!isFieldType(def.type)) {
    errors.push(`${name}的字段类型非法`);
    return errors;
  }
  const meta = FIELD_TYPE_META[def.type];

  if (def.required !== undefined && typeof def.required !== 'boolean') {
    errors.push(`${name}的 required 必须是布尔值`);
  }
  if (def.help !== undefined && (typeof def.help !== 'string' || charLength(def.help) > 120)) {
    errors.push(`${name}的帮助文字不能超过 120 个字符`);
  }
  if (def.placeholder !== undefined && (typeof def.placeholder !== 'string' || charLength(def.placeholder) > 60)) {
    errors.push(`${name}的占位文字不能超过 60 个字符`);
  }

  if (meta.numeric) {
    if (def.min !== undefined && !Number.isFinite(def.min)) errors.push(`${name}的 min 必须是有限数字`);
    if (def.max !== undefined && !Number.isFinite(def.max)) errors.push(`${name}的 max 必须是有限数字`);
    if (def.min !== undefined && def.max !== undefined && Number.isFinite(def.min) && Number.isFinite(def.max) && def.min > def.max) {
      errors.push(`${name}的 min 不能大于 max`);
    }
    if (def.step !== undefined && (!Number.isFinite(def.step) || def.step <= 0)) {
      errors.push(`${name}的 step 必须是正数`);
    }
  }
  if (def.precision !== undefined) {
    if (!Number.isInteger(def.precision) || def.precision < 0 || def.precision > 6) {
      errors.push(`${name}的 precision 必须是 0..6 的整数`);
    }
  }
  if (def.type === 'currency') {
    if (def.currency !== undefined && !CURRENCY_PATTERN.test(def.currency)) {
      errors.push(`${name}的 currency 必须是 3 位大写字母的 ISO-4217 代码`);
    }
  }
  if (def.type === 'rating') {
    if (def.scale !== undefined && (!Number.isInteger(def.scale) || def.scale < 1 || def.scale > 10)) {
      errors.push(`${name}的 scale 必须是 1..10 的整数`);
    }
  }
  if (def.maxLength !== undefined && (!Number.isInteger(def.maxLength) || def.maxLength < 1)) {
    errors.push(`${name}的 maxLength 必须是正整数`);
  }

  if (meta.requiresOptions) {
    const options = def.options;
    if (!Array.isArray(options) || options.length === 0) {
      errors.push(`${name}是${meta.label}字段，必须提供至少 1 个选项`);
    } else {
      if (def.type === 'select' && options.length > 50) {
        errors.push(`${name}的选项不能超过 50 个`);
      }
      if (def.type === 'multiselect' && options.length > 100) {
        errors.push(`${name}的选项不能超过 100 个`);
      }
      const seen = new Set<string>();
      options.forEach((option, index) => {
        const position = `${name}的第 ${index + 1} 个选项`;
        if (!option || typeof option !== 'object') {
          errors.push(`${position}非法`);
          return;
        }
        if (typeof option.value !== 'string' || option.value.trim() === '' || charLength(option.value) > 40) {
          errors.push(`${position}的 value 必须是 1..40 字符的非空字符串`);
          return;
        }
        if (typeof option.label !== 'string' || option.label.trim() === '') {
          errors.push(`${position}的 label 不能为空`);
        }
        if (seen.has(option.value)) {
          errors.push(`${name}的选项 value「${option.value}」重复`);
        }
        seen.add(option.value);
      });
    }
  }

  if (def.defaultValue !== undefined && def.defaultValue !== null) {
    const normalized = normalizeFieldValue(def, def.defaultValue);
    if (!normalized.ok) errors.push(`${name}的默认值非法：${normalized.message}`);
  }

  return errors;
}

/** 校验整个模板的字段定义（key 唯一等），返回中文错误信息数组 */
export function validateTemplateFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return ['fields 必须是字段定义数组'];
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  fields.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`第 ${index + 1} 个字段不是对象`);
      return;
    }
    const def = item as FieldDefinition;
    const itemErrors = validateFieldDefinition(def);
    for (const message of itemErrors) errors.push(`字段 #${index + 1}：${message}`);
    if (typeof def.key === 'string') {
      if (seenKeys.has(def.key)) errors.push(`字段 #${index + 1}：key「${def.key}」重复`);
      seenKeys.add(def.key);
    }
  });
  return errors;
}

/** 校验模板字段并对失败抛出统一文案（供 API 层直接使用） */
export function assertValidTemplateFields(fields: unknown): void {
  const errors = validateTemplateFields(fields);
  if (errors.length > 0) {
    throw new Error(errors.join('；'));
  }
}

function formatNumber(value: number, precision: number): string {
  const digits = Math.min(Math.max(precision, 0), 6);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * 字段取值的中文展示（用于列表、CSV、图表 tooltip）。
 * - currency：`Intl.NumberFormat('zh-CN', {style:'currency', currency})`
 * - percent：加 `%`
 * - boolean：「是 / 否」
 * - date：`YYYY-MM-DD`
 * - multiselect：「、」连接 option label
 */
export function formatFieldValue(def: FieldDefinition, value: FieldValue | undefined): string {
  if (isFieldValueEmpty(value)) return '';

  switch (def.type) {
    case 'currency': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return '';
      const digits = effectivePrecision(def);
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: effectiveCurrency(def),
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(num);
    }

    case 'percent': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return '';
      return `${formatNumber(num, effectivePrecision(def))}%`;
    }

    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return '';
      return formatNumber(num, effectivePrecision(def));
    }

    case 'rating': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return '';
      return `${num} / ${effectiveScale(def)}`;
    }

    case 'boolean':
      return value === true ? '是' : '否';

    case 'date':
      return typeof value === 'string' ? value : '';

    case 'datetime':
      return typeof value === 'string' ? value : '';

    case 'select': {
      const option = (def.options ?? []).find((item) => item.value === value);
      return option ? option.label : String(value);
    }

    case 'multiselect': {
      const list = Array.isArray(value) ? value : [String(value)];
      const options = def.options ?? [];
      return list
        .map((item) => options.find((option) => option.value === item)?.label ?? item)
        .join('、');
    }

    case 'text':
    case 'longtext':
    case 'url':
      return typeof value === 'string' ? value : String(value);

    default:
      return String(value);
  }
}

/** 选择型字段的 option display 名（找不到时回退原始 value） */
export function optionLabelOf(def: FieldDefinition, value: string): string {
  return (def.options ?? []).find((option) => option.value === value)?.label ?? value;
}
