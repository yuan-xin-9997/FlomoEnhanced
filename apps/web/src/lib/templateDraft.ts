/**
 * 模板编辑器草稿逻辑（新增/删除/排序/复制字段、类型切换、校验）。
 * 全部为纯函数，方便单测；组件只负责渲染与事件绑定。
 */
import { FIELD_TYPE_META, slugifyKey, validateTemplateFields } from '@flomo/shared';
import type { FieldDefinition, FieldType, FieldValue, Template, TemplateUpsertBody } from '@flomo/shared';

/** 模板编辑草稿 */
export interface TemplateDraft {
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldDefinition[];
}

/** 新建模板的初始草稿（含 1 个文本字段，避免编辑器空荡荡） */
export function blankTemplateDraft(): TemplateDraft {
  return {
    name: '',
    description: '',
    icon: '📝',
    color: '#3b82f6',
    fields: [blankField([], 'text')],
  };
}

/** 生成不冲突的字段 key */
export function uniqueFieldKey(base: string, existingKeys: Iterable<string>): string {
  return slugifyKey(base, existingKeys);
}

/** 新建字段（按类型补全专属配置） */
export function blankField(existing: readonly FieldDefinition[], type: FieldType = 'text'): FieldDefinition {
  const meta = FIELD_TYPE_META[type];
  const key = uniqueFieldKey(type, existing.map((field) => field.key));
  const field: FieldDefinition = {
    key,
    label: meta.label,
    type,
    required: false,
  };
  applyTypeDefaults(field);
  return field;
}

/** 按类型补全/清理专属配置（切换类型时调用） */
export function applyTypeDefaults(field: FieldDefinition): FieldDefinition {
  const meta = FIELD_TYPE_META[field.type];

  if (field.type === 'currency') {
    field.currency = field.currency ?? 'CNY';
    field.precision = field.precision ?? meta.precision;
  } else {
    delete field.currency;
    if (field.type === 'rating') {
      field.scale = field.scale ?? 5;
      delete field.precision;
    } else if (meta.numeric) {
      field.precision = field.precision ?? meta.precision;
      delete field.scale;
    } else {
      delete field.precision;
      delete field.scale;
    }
  }

  if (meta.numeric) {
    field.min = field.min;
  } else {
    delete field.min;
    delete field.max;
    delete field.step;
  }

  if (meta.maxLength !== undefined && field.maxLength === undefined) {
    field.maxLength = meta.maxLength;
  }
  if (meta.maxLength === undefined) {
    delete field.maxLength;
  }

  if (meta.requiresOptions) {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      field.options = [{ value: 'option_1', label: '选项 1' }];
    }
  } else {
    delete field.options;
  }

  return field;
}

export interface ChangeFieldTypeOptions {
  /** 其它字段已占用的 key（用于生成不冲突的新 key） */
  otherKeys?: readonly string[];
  /** 是否允许按类型自动重算 key（编辑既有模板时为 false） */
  allowSync?: boolean;
}

/** key 是否仍是由类型自动生成的（未被显示名同步或手动改过） */
function isTypeDerivedKey(field: FieldDefinition, otherKeys: readonly string[]): boolean {
  return field.key === uniqueFieldKey(field.type, otherKeys);
}

/**
 * 切换字段类型（保留 key/label/required/help/placeholder，其余按新类型重置）。
 * 新增字段的 key 若仍由类型自动生成，会随新类型重算，例如 text → number 得到 `number`；
 * 已按显示名同步过或手动改过的 key 保持不变。
 */
export function changeFieldType(
  field: FieldDefinition,
  type: FieldType,
  options: ChangeFieldTypeOptions = {},
): FieldDefinition {
  const otherKeys = options.otherKeys ?? [];
  const allowSync = options.allowSync ?? true;
  const key = allowSync && isTypeDerivedKey(field, otherKeys) ? uniqueFieldKey(type, otherKeys) : field.key;
  const next: FieldDefinition = {
    key,
    label: field.label,
    type,
    required: field.required,
  };
  if (field.help !== undefined) next.help = field.help;
  if (field.placeholder !== undefined) next.placeholder = field.placeholder;
  applyTypeDefaults(next);
  return next;
}

/** 由显示名重算字段 key（排除自身占用） */
export function syncFieldKey(
  fields: readonly FieldDefinition[],
  index: number,
): FieldDefinition[] {
  const field = fields[index];
  if (field === undefined) return [...fields];
  const others = fields.filter((_, position) => position !== index).map((item) => item.key);
  const key = uniqueFieldKey(field.label === '' ? field.type : field.label, others);
  return fields.map((item, position) => (position === index ? { ...item, key } : item));
}

/**
 * 修改显示名时同步机器名。
 * ⚠️ 契约规定 key「模板内唯一、不可变」：仅当该字段是本次编辑会话新增的
 * （`allowSync === true`）且 key 仍是按旧显示名自动生成的值时才重算，
 * 否则只改 label，避免历史 memo 的 values_json 键被孤立。
 */
export function syncKeyOnLabelChange(
  fields: readonly FieldDefinition[],
  index: number,
  nextLabel: string,
  options: { allowSync: boolean },
): FieldDefinition[] {
  const field = fields[index];
  if (field === undefined) return [...fields];
  if (!options.allowSync) return patchField(fields, index, { label: nextLabel });

  const others = fields.filter((_, position) => position !== index).map((item) => item.key);
  const labelBase = field.label.trim() === '' ? field.type : field.label;
  const isAutoKey =
    field.key === uniqueFieldKey(labelBase, others) || isTypeDerivedKey(field, others);
  if (!isAutoKey) return patchField(fields, index, { label: nextLabel });

  const nextBase = nextLabel.trim() === '' ? field.type : nextLabel;
  return patchField(fields, index, {
    label: nextLabel,
    key: uniqueFieldKey(nextBase, others),
  });
}

/** 替换某个字段的配置 */
export function patchField(
  fields: readonly FieldDefinition[],
  index: number,
  patch: Partial<FieldDefinition>,
): FieldDefinition[] {
  return fields.map((item, position) => (position === index ? { ...item, ...patch } : item));
}

/** 删除字段 */
export function removeFieldAt(fields: readonly FieldDefinition[], index: number): FieldDefinition[] {
  return fields.filter((_, position) => position !== index);
}

/** 复制字段（key 自动加后缀，label 加「副本」） */
export function duplicateFieldAt(fields: readonly FieldDefinition[], index: number): FieldDefinition[] {
  const source = fields[index];
  if (source === undefined) return [...fields];
  const key = uniqueFieldKey(source.key, fields.map((item) => item.key));
  const copy: FieldDefinition = {
    ...source,
    key,
    label: `${source.label} 副本`.slice(0, 40),
  };
  if (source.options !== undefined) {
    copy.options = source.options.map((option) => ({ ...option }));
  }
  const next = [...fields];
  next.splice(index + 1, 0, copy);
  return next;
}

/** 移动到目标位置（用于上移/下移与拖拽排序） */
export function moveField(fields: readonly FieldDefinition[], from: number, to: number): FieldDefinition[] {
  if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return [...fields];
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...fields];
  next.splice(to, 0, moved);
  return next;
}

/** 上移/下移一步（delta = -1 / +1），越界时原样返回 */
export function shiftField(fields: readonly FieldDefinition[], index: number, delta: number): FieldDefinition[] {
  return moveField(fields, index, index + delta);
}

/** 新增/编辑选项 */
export function addOption(fields: readonly FieldDefinition[], index: number): FieldDefinition[] {
  const field = fields[index];
  if (field === undefined) return [...fields];
  const options = field.options ?? [];
  const values = new Set(options.map((option) => option.value));
  let serial = options.length + 1;
  let value = `option_${serial}`;
  while (values.has(value)) {
    serial += 1;
    value = `option_${serial}`;
  }
  return patchField(fields, index, { options: [...options, { value, label: `选项 ${serial}` }] });
}

/** 删除选项 */
export function removeOption(fields: readonly FieldDefinition[], index: number, optionIndex: number): FieldDefinition[] {
  const field = fields[index];
  if (field === undefined) return [...fields];
  const options = (field.options ?? []).filter((_, position) => position !== optionIndex);
  return patchField(fields, index, { options });
}

/** 修改选项 */
export function patchOption(
  fields: readonly FieldDefinition[],
  index: number,
  optionIndex: number,
  patch: Partial<{ value: string; label: string; color: string }>,
): FieldDefinition[] {
  const field = fields[index];
  if (field === undefined) return [...fields];
  const options = (field.options ?? []).map((option, position) =>
    position === optionIndex ? { ...option, ...patch } : option,
  );
  return patchField(fields, index, { options });
}

/** 校验草稿：名称 + 字段定义（复用 shared 的 validateTemplateFields） */
export function validateTemplateDraft(draft: TemplateDraft): string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name === '') errors.push('模板名称不能为空');
  else if (Array.from(name).length > 40) errors.push('模板名称不能超过 40 个字符');
  if (Array.from(draft.description).length > 200) errors.push('模板描述不能超过 200 个字符');
  if (draft.icon.trim() === '') errors.push('请为模板选择一个图标（可用 emoji）');
  if (draft.fields.length === 0) errors.push('模板至少需要 1 个字段');
  if (draft.fields.length > 50) errors.push('模板字段不能超过 50 个');
  errors.push(...validateTemplateFields(draft.fields));
  return errors;
}

/** 模板 DTO → 草稿 */
export function draftFromTemplate(template: Template): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    icon: template.icon,
    color: template.color,
    fields: template.fields.map((field) => ({
      ...field,
      options: field.options?.map((option) => ({ ...option })),
    })),
  };
}

/** 草稿 → 提交体 */
export function draftToBody(draft: TemplateDraft): TemplateUpsertBody {
  return {
    name: draft.name.trim(),
    description: draft.description,
    icon: draft.icon,
    color: draft.color,
    fields: draft.fields.map((field) => ({ ...field })),
  };
}

/** 字段类型统计（卡片/预览页用） */
export function fieldTypeSummary(fields: readonly FieldDefinition[]): Array<{ type: FieldType; label: string; count: number }> {
  const counts = new Map<FieldType, number>();
  for (const field of fields) counts.set(field.type, (counts.get(field.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, label: FIELD_TYPE_META[type].label, count }));
}

/** 模板预览用：把草稿字段值转成展示文本列表（空值不展示） */
export function previewRows(
  fields: readonly FieldDefinition[],
  values: Record<string, FieldValue>,
  formatValue: (def: FieldDefinition, value: FieldValue | undefined) => string,
): Array<{ key: string; label: string; text: string }> {
  return fields
    .map((def) => ({ key: def.key, label: def.label, text: formatValue(def, values[def.key]) }))
    .filter((row) => row.text !== '');
}
