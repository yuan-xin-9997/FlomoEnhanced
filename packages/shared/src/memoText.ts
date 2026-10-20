/**
 * 「模板字段」文本模式（SPEC 增强项）：
 * - `formatMemoText`：把模板字段值序列化为「字段名：值」逐行文本；
 * - `parseMemoText`：粘贴/切回模板模式时，按字段名从文本中提取字段值。
 *
 * 文本格式约定：
 * - 每个非空字段一行：`字段名：值`，分隔符支持 `： : ＝ =`；
 * - 字段名也接受字段 key；字段名重复时序列化改用 key，避免歧义；
 * - `longtext` 的后续行（不以任何已知字段名开头）作为该字段的续行；
 * - 未出现的字段使用模板默认值（即「清空」），由调用方再做必填校验；
 * - 解析坚持「尽力填充」：能识别的字段照常写入，非法/未识别项逐条返回错误。
 */
import {
  FIELD_TYPE_META,
  formatFieldValue,
  isFieldValueEmpty,
  normalizeFieldValue,
} from './fieldTypes.js';
import type { FieldDefinition, FieldValue } from './fieldTypes.js';

/** 文本行错误（`line` 从 1 开始，`message` 不含行号前缀） */
export interface MemoTextLineError {
  line: number;
  message: string;
}

/** 文本解析结果 */
export interface MemoTextParseResult {
  /** 表单草稿：包含所有字段；未出现的字段取默认值 */
  draft: Record<string, FieldValue>;
  /** 字段级错误（key → 中文消息） */
  errors: Record<string, string>;
  /** 无法归属到字段的行、重复字段行等 */
  lineErrors: MemoTextLineError[];
  /** 成功识别的字段数量 */
  matchedCount: number;
  /** 没有解析错误（必填等业务校验由调用方继续完成） */
  ok: boolean;
}

const SEPARATORS = new Set(['：', ':', '＝', '=']);
const MULTISELECT_SEPARATORS = /[、,，;；|]/;

/** 常见币种符号（与 Web / iOS 展示层一致，解析时容错剥离） */
const CURRENCY_SYMBOLS = [
  // Intl 在 zh-CN 下会给部分币种加前缀（如 US$、AU$、CA$、JP¥），需先于裸符号剥离
  'US$',
  'AU$',
  'CA$',
  'JP¥',
  'HK$',
  'NT$',
  'S$',
  'A$',
  'C$',
  'CHF',
  '¥',
  '$',
  '€',
  '£',
  '₩',
  '₹',
  '₽',
  '฿',
];

/** 字段显示名（空 label 回退 key） */
function labelOf(def: FieldDefinition): string {
  const label = typeof def.label === 'string' ? def.label.trim() : '';
  return label === '' ? def.key : label;
}

function cloneValue(value: FieldValue): FieldValue {
  return Array.isArray(value) ? [...value] : value;
}

/** 单个字段的默认草稿值（与 Web `emptyDraft` / iOS `MemoFieldDraft.empty` 同口径） */
export function defaultMemoTextDraftValue(def: FieldDefinition): FieldValue {
  const value = def.defaultValue !== undefined ? def.defaultValue : FIELD_TYPE_META[def.type]?.defaultValue;
  return cloneValue(value ?? null);
}

function fallbackText(value: FieldValue): string {
  if (Array.isArray(value)) return value.join('、');
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

/**
 * 字段值 → 文本模式文本。
 * 只输出非空字段；字段名重复时使用 key，保证可以原样解析回来。
 */
export function formatMemoText(
  fields: readonly FieldDefinition[],
  values: Record<string, FieldValue>,
): string {
  const labelCounts = new Map<string, number>();
  for (const def of fields) {
    const label = labelOf(def);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  const lines: string[] = [];
  for (const def of fields) {
    const value = values[def.key];
    if (value === undefined || isFieldValueEmpty(value)) continue;
    let text = formatFieldValue(def, value);
    if (text === '') text = fallbackText(value);
    if (text === '') continue;
    const label = labelOf(def);
    const token = (labelCounts.get(label) ?? 0) > 1 ? def.key : label;
    lines.push(`${token}：${text}`);
  }
  return lines.join('\n');
}

interface LookupEntry {
  token: string;
  def: FieldDefinition;
  kind: 'key' | 'label';
}

/** 构建「字段名 → 字段」匹配表：key 优先；重复 label 不参与匹配，避免歧义 */
function buildLookup(fields: readonly FieldDefinition[]): LookupEntry[] {
  const labelCounts = new Map<string, number>();
  for (const def of fields) {
    const label = labelOf(def);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const keys = new Set(fields.map((def) => def.key));
  const entries: LookupEntry[] = [];
  for (const def of fields) {
    entries.push({ token: def.key, def, kind: 'key' });
    const label = labelOf(def);
    if ((labelCounts.get(label) ?? 0) > 1) continue;
    // label 与其它字段的 key 撞名时也无法稳定匹配，直接交给 key
    if (label !== def.key && keys.has(label)) continue;
    entries.push({ token: label, def, kind: 'label' });
  }
  entries.sort((a, b) => {
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return a.kind === 'key' ? -1 : 1;
  });
  return entries;
}

function preview(line: string): string {
  const text = line.trim();
  return text.length <= 24 ? text : `${text.slice(0, 24)}…`;
}

/** 尝试把一行识别为「字段名：值」；失败返回 null */
function matchFieldLine(
  line: string,
  lookup: readonly LookupEntry[],
): { def: FieldDefinition; value: string } | null {
  const trimmed = line.replace(/^\s+/u, '');
  for (const entry of lookup) {
    if (!trimmed.startsWith(entry.token)) continue;
    let rest = trimmed.slice(entry.token.length);
    rest = rest.replace(/^\s*/u, '');
    if (rest === '') continue;
    const separator = rest[0];
    if (separator === undefined || !SEPARATORS.has(separator)) continue;
    return { def: entry.def, value: rest.slice(1).replace(/^\s*/u, '') };
  }
  return null;
}

type PreparedValue = { ok: true; value: unknown } | { ok: false; message: string };

/** 去掉数值装饰（千分位、币种符号、百分号等），保留可交给 normalizeFieldValue 的文本 */
function cleanNumberText(def: FieldDefinition, raw: string, options: { percent: boolean; currency: boolean }): string {
  let text = raw.trim().replace(/\s+/gu, '');
  text = text.replace(/[,，]/gu, '');

  if (options.currency) {
    const code = (def.currency ?? 'CNY').toUpperCase();
    text = text.replace(new RegExp(code, 'giu'), '');
    for (const symbol of CURRENCY_SYMBOLS) {
      text = text.split(symbol).join('');
    }
    text = text.replace(/人民币|元|RMB/giu, '');
  }
  if (options.percent) {
    text = text.replace(/[%％]/gu, '');
  }
  return text;
}

function prepareNumber(def: FieldDefinition, raw: string): PreparedValue {
  const text = cleanNumberText(def, raw, {
    percent: def.type === 'percent',
    currency: def.type === 'currency',
  });
  if (text === '') return { ok: false, message: `「${labelOf(def)}」必须是数字` };
  return { ok: true, value: text };
}

function prepareRating(def: FieldDefinition, raw: string): PreparedValue {
  let text = raw.trim();
  const slash = text.indexOf('/');
  if (slash >= 0) text = text.slice(0, slash);
  text = text.replace(/\s+/gu, '');
  // 评分常被写成「4 星」「4分」；只取第一个数字，其余文本视为装饰
  const match = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)/u.exec(text);
  if (match === null) return { ok: false, message: `「${labelOf(def)}」必须是数字` };
  return { ok: true, value: match[0] };
}

function prepareSelect(def: FieldDefinition, raw: string): PreparedValue {
  const text = raw.trim();
  const options = def.options ?? [];
  const byValue = options.find((option) => option.value === text);
  if (byValue !== undefined) return { ok: true, value: byValue.value };
  const byLabel = options.find((option) => option.label.trim() === text);
  if (byLabel !== undefined) return { ok: true, value: byLabel.value };
  // 交给 normalizeFieldValue 产生统一的「取值不在候选项中」错误
  return { ok: true, value: text };
}

function prepareMultiselect(def: FieldDefinition, raw: string): PreparedValue {
  const text = raw.trim();
  if (text === '') return { ok: true, value: [] };
  const options = def.options ?? [];
  const picked = text
    .split(MULTISELECT_SEPARATORS)
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const byValue = options.find((option) => option.value === item);
      if (byValue !== undefined) return byValue.value;
      const byLabel = options.find((option) => option.label.trim() === item);
      if (byLabel !== undefined) return byLabel.value;
      return item;
    });
  return { ok: true, value: picked };
}

/** 按字段类型预处理文本值（选择类字段把 label 映射为 value） */
function prepareValue(def: FieldDefinition, raw: string): PreparedValue {
  if (raw.trim() === '') return { ok: true, value: '' };
  switch (def.type) {
    case 'number':
    case 'currency':
    case 'percent':
      return prepareNumber(def, raw);
    case 'rating':
      return prepareRating(def, raw);
    case 'select':
      return prepareSelect(def, raw);
    case 'multiselect':
      return prepareMultiselect(def, raw);
    default:
      return { ok: true, value: raw };
  }
}

/** 归一化后的值 → 表单草稿形态（数值保留字符串，便于输入框编辑） */
function draftValueOf(def: FieldDefinition, value: FieldValue): FieldValue {
  switch (def.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
      return typeof value === 'number' ? String(value) : value;
    case 'multiselect':
      return Array.isArray(value) ? [...value] : [];
    default:
      return value;
  }
}

/**
 * 文本 → 字段草稿。
 * - 能识别的字段写入 `draft`，非法值/未知行进入 `errors` / `lineErrors`；
 * - 未出现的字段取默认值（即清空）；
 * - 不在这里做必填校验，调用方应继续执行 `normalizeDraft`。
 */
export function parseMemoText(
  fields: readonly FieldDefinition[],
  text: string,
): MemoTextParseResult {
  const draft: Record<string, FieldValue> = {};
  for (const def of fields) draft[def.key] = defaultMemoTextDraftValue(def);

  const errors: Record<string, string> = {};
  const lineErrors: MemoTextLineError[] = [];
  const lookup = buildLookup(fields);
  const rawValues = new Map<string, string>();
  const seen = new Set<string>();
  let current: FieldDefinition | null = null;
  let matchedCount = 0;

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = matchFieldLine(line, lookup);

    if (match !== null) {
      const key = match.def.key;
      if (seen.has(key)) {
        lineErrors.push({
          line: index + 1,
          message: `字段「${labelOf(match.def)}」重复出现（以最后一次为准）`,
        });
      }
      seen.add(key);
      rawValues.set(key, match.value);
      current = match.def;
      continue;
    }

    // 多行文本的续行：只要当前字段是 longtext，未匹配字段名的行都归入该字段
    if (current !== null && current.type === 'longtext') {
      const previous = rawValues.get(current.key) ?? '';
      rawValues.set(current.key, `${previous}\n${line}`);
      continue;
    }

    if (line.trim() === '') continue;
    lineErrors.push({ line: index + 1, message: `无法识别「${preview(line)}」` });
  }

  for (const def of fields) {
    if (!seen.has(def.key)) continue;
    const raw = rawValues.get(def.key) ?? '';
    const prepared = prepareValue(def, raw);
    if (!prepared.ok) {
      errors[def.key] = prepared.message;
      continue;
    }
    const normalized = normalizeFieldValue(def, prepared.value);
    if (!normalized.ok) {
      errors[def.key] = normalized.message;
      continue;
    }
    draft[def.key] = draftValueOf(def, normalized.value);
    matchedCount += 1;
  }

  return {
    draft,
    errors,
    lineErrors,
    matchedCount,
    ok: lineErrors.length === 0 && Object.keys(errors).length === 0,
  };
}
