import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldDefinition } from '../src/index.ts';
import {
  FIELD_TYPES,
  FIELD_TYPE_META,
  formatFieldValue,
  isFieldValueEmpty,
  normalizeFieldValue,
  validateFieldDefinition,
  validateTemplateFields,
} from '../src/index.ts';

const amount: FieldDefinition = { key: 'amount', label: '金额', type: 'currency', currency: 'CNY' };
const score: FieldDefinition = { key: 'score', label: '评分', type: 'rating', scale: 5 };
const mood: FieldDefinition = {
  key: 'mood',
  label: '心情',
  type: 'select',
  options: [
    { value: 'happy', label: '开心' },
    { value: 'sad', label: '低落' },
  ],
};
const tags: FieldDefinition = {
  key: 'tags',
  label: '标签',
  type: 'multiselect',
  options: [
    { value: 'food', label: '餐饮' },
    { value: 'traffic', label: '交通' },
    { value: 'rent', label: '房租' },
  ],
};

describe('字段类型元信息', () => {
  it('包含 12 种类型且顺序稳定', () => {
    assert.equal(FIELD_TYPES.length, 12);
    assert.deepEqual(FIELD_TYPES, [
      'text',
      'longtext',
      'number',
      'currency',
      'percent',
      'rating',
      'date',
      'datetime',
      'select',
      'multiselect',
      'boolean',
      'url',
    ]);
    assert.equal(FIELD_TYPE_META.currency.numeric, true);
    assert.equal(FIELD_TYPE_META.select.choice, true);
    assert.equal(FIELD_TYPE_META.text.requiresOptions, false);
    assert.equal(FIELD_TYPE_META.multiselect.requiresOptions, true);
  });
});

describe('normalizeFieldValue', () => {
  it('text 去空白、空串归一为 null、超长报错', () => {
    const def: FieldDefinition = { key: 'title', label: '标题', type: 'text' };
    assert.deepEqual(normalizeFieldValue(def, '  你好  '), { ok: true, value: '你好' });
    assert.deepEqual(normalizeFieldValue(def, '   '), { ok: true, value: null });
    const long = 'a'.repeat(201);
    const result = normalizeFieldValue(def, long);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /长度不能超过 200/);
  });

  it('url 只接受 http/https 绝对地址', () => {
    const def: FieldDefinition = { key: 'link', label: '链接', type: 'url' };
    assert.deepEqual(normalizeFieldValue(def, 'https://example.com/a'), { ok: true, value: 'https://example.com/a' });
    assert.equal(normalizeFieldValue(def, 'ftp://example.com').ok, false);
    assert.equal(normalizeFieldValue(def, 'example.com').ok, false);
  });

  it('number 接受数字字符串、拒绝非有限数并检查边界', () => {
    const def: FieldDefinition = { key: 'n', label: '数量', type: 'number', min: 0, max: 10 };
    assert.deepEqual(normalizeFieldValue(def, '3.5'), { ok: true, value: 3.5 });
    assert.deepEqual(normalizeFieldValue(def, ''), { ok: true, value: null });
    assert.equal(normalizeFieldValue(def, 'abc').ok, false);
    assert.equal(normalizeFieldValue(def, 11).ok, false);
    assert.equal(normalizeFieldValue(def, -1).ok, false);
  });

  it('percent 限制 0..100', () => {
    const def: FieldDefinition = { key: 'p', label: '完成度', type: 'percent' };
    assert.deepEqual(normalizeFieldValue(def, 30), { ok: true, value: 30 });
    assert.equal(normalizeFieldValue(def, 101).ok, false);
    assert.equal(normalizeFieldValue(def, -0.1).ok, false);
  });

  it('rating 必须是 0..scale 的整数', () => {
    assert.deepEqual(normalizeFieldValue(score, 4), { ok: true, value: 4 });
    assert.equal(normalizeFieldValue(score, 4.5).ok, false);
    assert.equal(normalizeFieldValue(score, 6).ok, false);
  });

  it('date 校验真实日历日期', () => {
    const def: FieldDefinition = { key: 'd', label: '日期', type: 'date' };
    assert.deepEqual(normalizeFieldValue(def, '2026-10-18'), { ok: true, value: '2026-10-18' });
    assert.equal(normalizeFieldValue(def, '2026-02-30').ok, false);
    assert.equal(normalizeFieldValue(def, '2026/10/18').ok, false);
  });

  it('datetime 要求带时区', () => {
    const def: FieldDefinition = { key: 'dt', label: '时间', type: 'datetime' };
    assert.equal(normalizeFieldValue(def, '2026-10-18T08:00:00+08:00').ok, true);
    assert.equal(normalizeFieldValue(def, '2026-10-18T00:00:00.000Z').ok, true);
    assert.equal(normalizeFieldValue(def, '2026-10-18T08:00:00').ok, false);
  });

  it('select 必须命中 options', () => {
    assert.deepEqual(normalizeFieldValue(mood, 'happy'), { ok: true, value: 'happy' });
    assert.equal(normalizeFieldValue(mood, 'angry').ok, false);
    assert.deepEqual(normalizeFieldValue(mood, ''), { ok: true, value: null });
  });

  it('multiselect 去重且按 options 顺序稳定排序', () => {
    assert.deepEqual(normalizeFieldValue(tags, ['rent', 'food', 'rent']), { ok: true, value: ['food', 'rent'] });
    assert.deepEqual(normalizeFieldValue(tags, []), { ok: true, value: [] });
    assert.deepEqual(normalizeFieldValue(tags, null), { ok: true, value: [] });
    assert.equal(normalizeFieldValue(tags, ['nope']).ok, false);
  });

  it('boolean 兼容是/否与 1/0', () => {
    const def: FieldDefinition = { key: 'b', label: '是否完成', type: 'boolean' };
    assert.deepEqual(normalizeFieldValue(def, true), { ok: true, value: true });
    assert.deepEqual(normalizeFieldValue(def, '否'), { ok: true, value: false });
    assert.deepEqual(normalizeFieldValue(def, 1), { ok: true, value: true });
    assert.deepEqual(normalizeFieldValue(def, null), { ok: true, value: null });
    assert.equal(normalizeFieldValue(def, '也许').ok, false);
  });
});

describe('isFieldValueEmpty', () => {
  it('null / 空串 / 空数组为空，false 与 0 有值', () => {
    assert.equal(isFieldValueEmpty(null), true);
    assert.equal(isFieldValueEmpty(undefined), true);
    assert.equal(isFieldValueEmpty(''), true);
    assert.equal(isFieldValueEmpty('  '), true);
    assert.equal(isFieldValueEmpty([]), true);
    assert.equal(isFieldValueEmpty(false), false);
    assert.equal(isFieldValueEmpty(0), false);
  });
});

describe('validateFieldDefinition / validateTemplateFields', () => {
  it('合法定义无错误', () => {
    assert.deepEqual(validateFieldDefinition(amount), []);
    assert.deepEqual(validateFieldDefinition(mood), []);
  });

  it('key 非法、label 空、currency 小写、rating scale 越界都报错', () => {
    assert.ok(validateFieldDefinition({ key: 'Bad-Key', label: '金额', type: 'currency' }).length > 0);
    assert.ok(validateFieldDefinition({ key: 'ok', label: '  ', type: 'text' }).length > 0);
    assert.ok(validateFieldDefinition({ key: 'c', label: '金额', type: 'currency', currency: 'cny' }).length > 0);
    assert.ok(validateFieldDefinition({ key: 'r', label: '评分', type: 'rating', scale: 11 }).length > 0);
  });

  it('select 必须有非空 options 且 value 唯一', () => {
    assert.ok(validateFieldDefinition({ key: 's', label: '单选', type: 'select' }).some((e) => e.includes('必须提供')) as boolean);
    const dup = validateFieldDefinition({
      key: 's',
      label: '单选',
      type: 'select',
      options: [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'B' },
      ],
    });
    assert.ok(dup.some((e) => e.includes('重复')) as boolean);
  });

  it('模板字段 key 重复被捕获', () => {
    const errors = validateTemplateFields([
      { key: 'a', label: '甲', type: 'text' },
      { key: 'a', label: '乙', type: 'text' },
    ]);
    assert.ok(errors.some((e) => e.includes('重复')) as boolean);
    assert.deepEqual(validateTemplateFields([{ key: 'a', label: '甲', type: 'text' }]), []);
    assert.ok(validateTemplateFields('not-array').length > 0);
  });
});

describe('formatFieldValue', () => {
  it('currency 使用 zh-CN 货币格式', () => {
    const text = formatFieldValue(amount, 1234.5);
    assert.ok(text.includes('1,234.50'), text);
    assert.ok(text.includes('¥') || text.includes('CN¥'), text);
  });

  it('percent 追加百分号、number 保留小数位', () => {
    assert.equal(formatFieldValue({ key: 'p', label: 'P', type: 'percent' }, 12.5), '12.50%');
    assert.equal(formatFieldValue({ key: 'n', label: 'N', type: 'number' }, 3.14159), '3.14');
  });

  it('boolean 输出是/否，date 原样输出，multiselect 用顿号连接 label', () => {
    assert.equal(formatFieldValue({ key: 'b', label: 'B', type: 'boolean' }, true), '是');
    assert.equal(formatFieldValue({ key: 'b', label: 'B', type: 'boolean' }, false), '否');
    assert.equal(formatFieldValue({ key: 'd', label: 'D', type: 'date' }, '2026-10-18'), '2026-10-18');
    assert.equal(formatFieldValue(tags, ['food', 'rent']), '餐饮、房租');
    assert.equal(formatFieldValue(mood, 'happy'), '开心');
  });

  it('空值输出空字符串', () => {
    assert.equal(formatFieldValue(amount, null), '');
    assert.equal(formatFieldValue(tags, []), '');
  });
});
