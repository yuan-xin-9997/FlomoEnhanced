import { describe, expect, it } from 'vitest';
import { formatFieldValue } from '@flomo/shared';
import type { FieldDefinition, Template } from '@flomo/shared';
import {
  addOption,
  applyTypeDefaults,
  blankField,
  blankTemplateDraft,
  changeFieldType,
  draftFromTemplate,
  draftToBody,
  duplicateFieldAt,
  fieldTypeSummary,
  moveField,
  patchField,
  patchOption,
  previewRows,
  removeFieldAt,
  removeOption,
  shiftField,
  syncFieldKey,
  syncKeyOnLabelChange,
  validateTemplateDraft,
} from './templateDraft';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function text(key: string, label = key): FieldDefinition {
  return { key, label, type: 'text' };
}

describe('blankField（新增字段按类型补默认配置）', () => {
  it('选择型自动带 1 个选项', () => {
    const field = blankField([], 'select');
    expect(field.key).toBe('select');
    expect(field.label).toBe('单选');
    expect(field.options).toHaveLength(1);
    expect(field.options?.[0]?.value).toBe('option_1');
  });

  it('数值型带精度，currency 带币种，rating 带 scale', () => {
    const amount = blankField([], 'currency');
    expect(amount.precision).toBe(2);
    expect(amount.currency).toBe('CNY');
    expect(amount.min).toBeUndefined();
    expect(blankField([], 'rating').scale).toBe(5);
    expect(blankField([], 'text').maxLength).toBe(200);
  });

  it('key 冲突自动加后缀', () => {
    const first = blankField([], 'text');
    const second = blankField([first], 'text');
    expect(second.key).toBe('text_2');
    expect(KEY_PATTERN.test(second.key)).toBe(true);
  });
});

describe('类型切换与配置清理', () => {
  it('number → select 清掉数值配置并补选项', () => {
    const next = changeFieldType({ key: 'a', label: '金额', type: 'number', min: 0, max: 10, precision: 2 }, 'select');
    expect(next.type).toBe('select');
    expect(next.min).toBeUndefined();
    expect(next.max).toBeUndefined();
    expect(next.precision).toBeUndefined();
    expect(next.options).toHaveLength(1);
    expect(next.key).toBe('a');
    expect(next.label).toBe('金额');
  });

  it('select → text 清掉选项与 maxLength 兜底', () => {
    const next = changeFieldType(blankField([], 'select'), 'text');
    expect(next.options).toBeUndefined();
    expect(next.maxLength).toBe(200);
  });

  it('applyTypeDefaults 不会覆盖已填的 min/max', () => {
    const field = applyTypeDefaults({ key: 'a', label: 'A', type: 'number', min: -5, max: 5 });
    expect(field.min).toBe(-5);
    expect(field.max).toBe(5);
  });
});

describe('字段排序 / 复制 / 删除', () => {
  const fields = [text('a'), text('b'), text('c')];

  it('moveField / shiftField', () => {
    expect(moveField(fields, 0, 2).map((field) => field.key)).toEqual(['b', 'c', 'a']);
    expect(moveField(fields, 2, 0).map((field) => field.key)).toEqual(['c', 'a', 'b']);
    expect(shiftField(fields, 0, -1).map((field) => field.key)).toEqual(['a', 'b', 'c']);
    expect(shiftField(fields, 1, -1).map((field) => field.key)).toEqual(['b', 'a', 'c']);
    expect(shiftField(fields, 5, 1).map((field) => field.key)).toEqual(['a', 'b', 'c']);
  });

  it('duplicateFieldAt 生成唯一 key 与副本名', () => {
    const next = duplicateFieldAt(fields, 0);
    expect(next.map((field) => field.key)).toEqual(['a', 'a_2', 'b', 'c']);
    expect(next[1]?.label).toBe('a 副本');
  });

  it('removeFieldAt / patchField', () => {
    expect(removeFieldAt(fields, 1).map((field) => field.key)).toEqual(['a', 'c']);
    expect(patchField(fields, 1, { label: '改名' })[1]?.label).toBe('改名');
    expect(fields[1]?.label).toBe('b'); // 不可变
  });

  it('选项增删改', () => {
    const withOptions = patchField(fields, 0, { type: 'select', options: [{ value: 'a', label: 'A' }] });
    const added = addOption(withOptions, 0);
    expect(added[0]?.options?.map((option) => option.value)).toEqual(['a', 'option_2']);
    const renamed = patchOption(added, 0, 0, { label: '甲' });
    expect(renamed[0]?.options?.[0]?.label).toBe('甲');
    expect(removeOption(renamed, 0, 0)[0]?.options?.map((option) => option.value)).toEqual(['option_2']);
  });
});

describe('syncFieldKey（显示名 → 机器名）', () => {
  it('英文标签直接派生，中文标签用稳定哈希', () => {
    const fields = [text('a', 'Amount Spent')];
    const synced = syncFieldKey(fields, 0);
    expect(synced[0]?.key).toBe('amount_spent');
    expect(KEY_PATTERN.test(synced[0]?.key ?? '')).toBe(true);

    const chinese = syncFieldKey([text('a', '金额')], 0);
    expect(KEY_PATTERN.test(chinese[0]?.key ?? '')).toBe(true);
    // 同样的中文标签应得到同样的 key
    expect(syncFieldKey([text('a', '金额')], 0)[0]?.key).toBe(chinese[0]?.key);
  });

  it('重名自动避让', () => {
    const fields = [text('amount', 'amount'), text('x', 'Amount')];
    expect(syncFieldKey(fields, 1)[1]?.key).toBe('amount_2');
  });
});

describe('syncKeyOnLabelChange（改显示名时是否重算 key）', () => {
  it('新增字段（allowSync=true）且 key 仍是自动值时，随显示名重算', () => {
    const fields = [text('amount', 'Amount')];
    const next = syncKeyOnLabelChange(fields, 0, 'Amount Spent', { allowSync: true });
    expect(next[0]?.key).toBe('amount_spent');
    expect(next[0]?.label).toBe('Amount Spent');
  });

  it('既有字段（allowSync=false）只改 label，key 保持不变', () => {
    const fields = [text('amount', 'Amount')];
    const next = syncKeyOnLabelChange(fields, 0, 'Amount Spent', { allowSync: false });
    expect(next[0]?.key).toBe('amount');
    expect(next[0]?.label).toBe('Amount Spent');
  });

  it('key 被手动改过时不重算（即使是新增字段）', () => {
    const fields = [text('my_custom_key', 'Amount')];
    const next = syncKeyOnLabelChange(fields, 0, 'Amount Spent', { allowSync: true });
    expect(next[0]?.key).toBe('my_custom_key');
    expect(next[0]?.label).toBe('Amount Spent');
  });

  it('新 key 与其它字段重名时自动避让', () => {
    const fields = [text('amount', 'Amount'), text('amount_spent', '其他')];
    const next = syncKeyOnLabelChange(fields, 0, 'Amount Spent', { allowSync: true });
    expect(next[0]?.key).toBe('amount_spent_2');
  });

  it('不改动原数组（不可变）', () => {
    const fields = [text('amount', 'Amount')];
    syncKeyOnLabelChange(fields, 0, 'Amount Spent', { allowSync: true });
    expect(fields[0]?.key).toBe('amount');
    expect(fields[0]?.label).toBe('Amount');
  });
});

describe('validateTemplateDraft', () => {
  it('合格草稿通过校验', () => {
    const draft = blankTemplateDraft();
    draft.name = '每日开销';
    expect(validateTemplateDraft(draft)).toEqual([]);
  });

  it('缺少名称 / 图标 / 字段时报中文错误', () => {
    const draft = blankTemplateDraft();
    draft.icon = '';
    draft.fields = [];
    const errors = validateTemplateDraft(draft);
    expect(errors).toContain('模板名称不能为空');
    expect(errors).toContain('请为模板选择一个图标（可用 emoji）');
    expect(errors).toContain('模板至少需要 1 个字段');
  });

  it('复用 shared 的字段定义校验（select 无选项）', () => {
    const draft = blankTemplateDraft();
    draft.name = 'T';
    draft.fields = [{ key: 'food', label: '餐次', type: 'select' }];
    const errors = validateTemplateDraft(draft);
    expect(errors.some((message) => message.includes('必须提供至少 1 个选项'))).toBe(true);
  });

  it('重复 key 被拦截', () => {
    const draft = blankTemplateDraft();
    draft.name = 'T';
    draft.fields = [text('dup', 'A'), text('dup', 'B')];
    expect(validateTemplateDraft(draft).some((message) => message.includes('重复'))).toBe(true);
  });
});

describe('模板 DTO ↔ 草稿', () => {
  const template = {
    id: 't1',
    name: '每日开销',
    description: '记录每天的花费',
    icon: '💰',
    color: '#3b82f6',
    fields: [{ key: 'amount', label: '金额', type: 'currency', currency: 'CNY', options: undefined }],
    version: 3,
    memoCount: 12,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    archivedAt: null,
  } as Template;

  it('draftFromTemplate / draftToBody 往返一致', () => {
    const draft = draftFromTemplate(template);
    expect(draft.name).toBe('每日开销');
    expect(draft.fields).toHaveLength(1);
    const body = draftToBody(draft);
    expect(body.fields[0]).toEqual(template.fields[0]);
    expect(body.name).toBe('每日开销');
  });

  it('draftFromTemplate 深拷贝字段对象', () => {
    const draft = draftFromTemplate(template);
    expect(draft.fields[0]).not.toBe(template.fields[0]);
  });

  it('fieldTypeSummary 统计类型分布', () => {
    expect(fieldTypeSummary([text('a'), text('b'), blankField([], 'number')])).toEqual([
      { type: 'text', label: '单行文本', count: 2 },
      { type: 'number', label: '数字', count: 1 },
    ]);
  });

  it('previewRows 过滤空值并复用 formatFieldValue', () => {
    const fields = [
      { key: 'amount', label: '金额', type: 'currency', currency: 'CNY', precision: 2 } as FieldDefinition,
      text('note', '备注'),
    ];
    const rows = previewRows(fields, { amount: 12.5, note: '' }, formatFieldValue);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ key: 'amount', label: '金额', text: '¥12.50' });
  });
});
