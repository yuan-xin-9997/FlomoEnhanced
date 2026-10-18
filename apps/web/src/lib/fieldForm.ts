/**
 * 表单 <-> 字段值 的纯逻辑（字段类型 → 控件映射、草稿构造、归一化、必填校验）。
 * 文案与归一化规则全部复用 `@flomo/shared`，此处只做编排，便于纯函数单测。
 */
import {
  FIELD_TYPE_META,
  effectiveCurrency,
  effectivePrecision,
  effectiveScale,
  isFieldValueEmpty,
  normalizeFieldValue,
} from '@flomo/shared';
import type { FieldDefinition, FieldType, FieldValue } from '@flomo/shared';

/** 表单控件种类（12 种字段类型 → 10 种控件） */
export type ControlKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'select'
  | 'multiselect'
  | 'switch'
  | 'rating'
  | 'url';

/** 字段类型 → 表单控件（SPEC §9.6 前端要求） */
export function controlKindOf(type: FieldType): ControlKind {
  switch (type) {
    case 'text':
      return 'text';
    case 'longtext':
      return 'textarea';
    case 'number':
    case 'currency':
    case 'percent':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime-local';
    case 'select':
      return 'select';
    case 'multiselect':
      return 'multiselect';
    case 'boolean':
      return 'switch';
    case 'rating':
      return 'rating';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}

/** 数值型字段是否需要「单位」前缀/后缀 */
export function numericUnitOf(def: FieldDefinition): { prefix: string; suffix: string } {
  if (def.type === 'currency') return { prefix: currencySymbol(effectiveCurrency(def)), suffix: '' };
  if (def.type === 'percent') return { prefix: '', suffix: '%' };
  return { prefix: '', suffix: '' };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  KRW: '₩',
  TWD: 'NT$',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  INR: '₹',
  RUB: '₽',
  CHF: 'CHF',
  THB: '฿',
  MYR: 'RM',
};

/** ISO-4217 → 展示符号（未知币种回退代码本身） */
export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code.toUpperCase();
}

/** 字段的默认草稿值（字段自身 defaultValue 优先，否则用类型元信息默认值） */
export function defaultDraftValue(def: FieldDefinition): FieldValue {
  if (def.defaultValue !== undefined) return cloneValue(def.defaultValue);
  const metaDefault = FIELD_TYPE_META[def.type]?.defaultValue ?? null;
  return cloneValue(metaDefault);
}

function cloneValue(value: FieldValue): FieldValue {
  if (Array.isArray(value)) return [...value];
  return value;
}

/** 为一批字段构造空草稿 */
export function emptyDraft(fields: readonly FieldDefinition[]): Record<string, FieldValue> {
  const draft: Record<string, FieldValue> = {};
  for (const def of fields) draft[def.key] = defaultDraftValue(def);
  return draft;
}

/** 已有 memo 的 values → 编辑草稿（补齐未出现的键，避免控件变非受控） */
export function draftFromValues(
  fields: readonly FieldDefinition[],
  values: Record<string, FieldValue> | null | undefined,
): Record<string, FieldValue> {
  const draft = emptyDraft(fields);
  if (values === null || values === undefined) return draft;
  for (const def of fields) {
    const raw = values[def.key];
    if (raw !== undefined) draft[def.key] = cloneValue(raw);
  }
  return draft;
}

/** 草稿是否「完全为空」（用于「至少填一项」校验） */
export function isDraftEmpty(draft: Record<string, FieldValue>): boolean {
  return Object.values(draft).every((value) => isFieldValueEmpty(value));
}

/** 归一化结果 */
export interface NormalizeDraftResult {
  ok: boolean;
  values: Record<string, FieldValue>;
  errors: Record<string, string>;
}

/**
 * 按字段定义归一化整个草稿：返回规范化后的 `values` 与逐字段中文错误。
 * 未填写的键统一为 `null`（multiselect 为 `[]`），与后端入库口径一致。
 */
export function normalizeDraft(
  fields: readonly FieldDefinition[],
  draft: Record<string, FieldValue>,
): NormalizeDraftResult {
  const values: Record<string, FieldValue> = {};
  const errors: Record<string, string> = {};

  for (const def of fields) {
    const result = normalizeFieldValue(def, draft[def.key]);
    if (!result.ok) {
      errors[def.key] = result.message;
      continue;
    }
    if (def.required === true && isFieldValueEmpty(result.value)) {
      errors[def.key] = `「${def.label || def.key}」为必填项`;
      continue;
    }
    values[def.key] = result.value;
  }

  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** 数值输入框的 step（未定义时按精度推导） */
export function inputStepOf(def: FieldDefinition): number {
  if (typeof def.step === 'number' && def.step > 0) return def.step;
  if (def.type === 'rating') return 1;
  const precision = effectivePrecision(def);
  return precision <= 0 ? 1 : Number((1 / 10 ** precision).toFixed(precision));
}

/** 评分星级的可选值（0..scale，0 表示清空） */
export function ratingValues(def: FieldDefinition): number[] {
  const scale = Math.max(1, Math.min(10, effectiveScale(def)));
  return Array.from({ length: scale + 1 }, (_, index) => index);
}

/** 数值型字段的值展示（复用字段定义的精度/币种/单位） */
export function numericDisplayOf(def: FieldDefinition, value: number): string {
  const precision = effectivePrecision(def);
  if (def.type === 'currency') {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: effectiveCurrency(def),
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value);
  }
  if (def.type === 'percent') return `${value.toFixed(precision)}%`;
  if (def.type === 'rating') return `${value} / ${effectiveScale(def)}`;
  return value.toFixed(precision);
}

/** 供 <input> 使用的字符串形式（保留用户输入中的小数点等中间态） */
export function inputTextOf(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** 把 <input> 的字符串写回草稿（数值型保留原始字符串，交由 normalizeFieldValue 解析） */
export function draftValueFromInput(def: FieldDefinition, text: string): FieldValue {
  switch (controlKindOf(def.type)) {
    case 'number':
    case 'rating':
      return text.trim() === '' ? null : text;
    case 'datetime-local':
      return text.trim() === '' ? null : localInputToIso(text);
    case 'date':
      return text.trim() === '' ? null : text;
    default:
      return text;
  }
}

/** `datetime-local`（YYYY-MM-DDTHH:mm）→ 带时区的 ISO-8601 */
export function localInputToIso(text: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (match === null) return text;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s === undefined ? 0 : Number(s), 0);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString();
}

/** 带时区的 ISO-8601 → `datetime-local` 输入值 */
export function isoToLocalInput(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 输入控件的 value 文本（按控件类型做必要转换） */
export function controlTextOf(def: FieldDefinition, value: FieldValue | undefined): string {
  if (controlKindOf(def.type) === 'datetime-local') {
    return typeof value === 'string' && value !== '' ? isoToLocalInput(value) : '';
  }
  if (controlKindOf(def.type) === 'number' || controlKindOf(def.type) === 'rating') {
    return value === null || value === undefined ? '' : String(value);
  }
  return inputTextOf(value);
}
