import { describe, expect, it } from 'vitest';
import type { FieldDefinition, FieldType } from '@flomo/shared';
import {
  controlKindOf,
  controlTextOf,
  currencySymbol,
  defaultDraftValue,
  draftFromValues,
  draftValueFromInput,
  emptyDraft,
  inputStepOf,
  isDraftEmpty,
  isoToLocalInput,
  localInputToIso,
  normalizeDraft,
  numericUnitOf,
  ratingValues,
} from './fieldForm';

function def(partial: Partial<FieldDefinition> & { type: FieldType }): FieldDefinition {
  return { key: 'f', label: '字段', ...partial } as FieldDefinition;
}

describe('字段类型 → 表单控件映射', () => {
  it('12 种类型各自的控件', () => {
    expect(controlKindOf('text')).toBe('text');
    expect(controlKindOf('longtext')).toBe('textarea');
    expect(controlKindOf('number')).toBe('number');
    expect(controlKindOf('currency')).toBe('number');
    expect(controlKindOf('percent')).toBe('number');
    expect(controlKindOf('date')).toBe('date');
    expect(controlKindOf('datetime')).toBe('datetime-local');
    expect(controlKindOf('select')).toBe('select');
    expect(controlKindOf('multiselect')).toBe('multiselect');
    expect(controlKindOf('boolean')).toBe('switch');
    expect(controlKindOf('rating')).toBe('rating');
    expect(controlKindOf('url')).toBe('url');
  });

  it('金额 / 百分比的单位', () => {
    expect(numericUnitOf(def({ type: 'currency', currency: 'CNY' }))).toEqual({ prefix: '¥', suffix: '' });
    expect(numericUnitOf(def({ type: 'percent' }))).toEqual({ prefix: '', suffix: '%' });
    expect(numericUnitOf(def({ type: 'number' }))).toEqual({ prefix: '', suffix: '' });
  });

  it('币种符号与兜底', () => {
    expect(currencySymbol('CNY')).toBe('¥');
    expect(currencySymbol('usd')).toBe('$');
    expect(currencySymbol('XYZ')).toBe('XYZ');
  });
});

describe('草稿构造', () => {
  it('按类型元信息给出默认值', () => {
    expect(defaultDraftValue(def({ type: 'multiselect', options: [] }))).toEqual([]);
    expect(defaultDraftValue(def({ type: 'boolean' }))).toBe(false);
    expect(defaultDraftValue(def({ type: 'text' }))).toBeNull();
    expect(defaultDraftValue(def({ type: 'number', defaultValue: 5 }))).toBe(5);
  });

  it('emptyDraft / draftFromValues 保持所有键存在', () => {
    const fields = [def({ type: 'text', key: 'a' }), def({ type: 'number', key: 'b' })];
    expect(emptyDraft(fields)).toEqual({ a: null, b: null });
    expect(draftFromValues(fields, { b: 3 })).toEqual({ a: null, b: 3 });
    // 多选数组必须是新对象，避免共享引用
    const multi = emptyDraft([def({ type: 'multiselect', key: 'm', options: [] })]);
    expect(Array.isArray(multi.m)).toBe(true);
  });

  it('isDraftEmpty 忽略 null/空串/空数组，0 与 false 视为有值', () => {
    expect(isDraftEmpty({ a: null, b: '', c: [] })).toBe(true);
    expect(isDraftEmpty({ a: 0 })).toBe(false);
    expect(isDraftEmpty({ a: false })).toBe(false);
  });
});

describe('normalizeDraft（复用 shared 的 normalizeFieldValue）', () => {
  it('数值字符串被解析为数字', () => {
    const result = normalizeDraft([def({ type: 'number', key: 'n' })], { n: '12.5' });
    expect(result.ok).toBe(true);
    expect(result.values.n).toBe(12.5);
  });

  it('百分比起界与评分非整数报中文错误', () => {
    const percent = normalizeDraft([def({ type: 'percent', key: 'p', label: '完成度' })], { p: '120' });
    expect(percent.ok).toBe(false);
    expect(percent.errors.p).toContain('0 到 100');

    const rating = normalizeDraft([def({ type: 'rating', key: 'r', label: '评分' })], { r: '3.5' });
    expect(rating.ok).toBe(false);
    expect(rating.errors.r).toContain('整数');
  });

  it('必填校验与空值归一化', () => {
    const result = normalizeDraft(
      [def({ type: 'text', key: 'a', label: '标题', required: true }), def({ type: 'multiselect', key: 'b', options: [] })],
      { a: '   ', b: null },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.a).toBe('「标题」为必填项');
    expect(result.values.b).toEqual([]);
  });

  it('select / multiselect 命中选项且去重排序', () => {
    const field = def({
      type: 'multiselect',
      key: 'm',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
    const ok = normalizeDraft([field], { m: ['b', 'a', 'b'] });
    expect(ok.ok).toBe(true);
    expect(ok.values.m).toEqual(['a', 'b']);

    const bad = normalizeDraft([field], { m: ['c'] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.m).toContain('候选项');
  });
});

describe('时间控件转换', () => {
  it('datetime-local 与带时区 ISO 互转', () => {
    const iso = new Date(2026, 9, 18, 8, 5, 0, 0).toISOString();
    expect(isoToLocalInput(iso)).toBe('2026-10-18T08:05');
    expect(localInputToIso('2026-10-18T08:05')).toBe(iso);
    expect(isoToLocalInput('不是时间')).toBe('');
    expect(localInputToIso('2026-10-18')).toBe('2026-10-18');
  });

  it('controlTextOf 按控件类型输出', () => {
    expect(controlTextOf(def({ type: 'datetime', key: 'd' }), new Date(2026, 9, 18, 8, 5).toISOString())).toBe(
      '2026-10-18T08:05',
    );
    expect(controlTextOf(def({ type: 'number', key: 'n' }), 12)).toBe('12');
    expect(controlTextOf(def({ type: 'number', key: 'n' }), null)).toBe('');
  });

  it('draftValueFromInput 保留数值中间态', () => {
    expect(draftValueFromInput(def({ type: 'number', key: 'n' }), '12.')).toBe('12.');
    expect(draftValueFromInput(def({ type: 'number', key: 'n' }), '')).toBeNull();
    expect(draftValueFromInput(def({ type: 'text', key: 't' }), 'abc')).toBe('abc');
  });
});

describe('数值控件属性', () => {
  it('step 由精度推导', () => {
    expect(inputStepOf(def({ type: 'number', precision: 2 }))).toBe(0.01);
    expect(inputStepOf(def({ type: 'rating' }))).toBe(1);
    expect(inputStepOf(def({ type: 'number', step: 5 }))).toBe(5);
  });

  it('评分星级集合', () => {
    expect(ratingValues(def({ type: 'rating', scale: 3 }))).toEqual([0, 1, 2, 3]);
    expect(ratingValues(def({ type: 'rating' }))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
