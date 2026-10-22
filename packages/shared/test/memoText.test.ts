import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldDefinition } from '../src/index.ts';
import { defaultMemoTextDraftValue, formatFieldValue, formatMemoText, parseMemoText } from '../src/index.ts';

const FIELDS: FieldDefinition[] = [
  { key: 'title', label: '标题', type: 'text' },
  { key: 'note', label: '备注', type: 'longtext' },
  { key: 'count', label: '数量', type: 'number', precision: 2 },
  { key: 'amount', label: '金额', type: 'currency', currency: 'CNY' },
  { key: 'progress', label: '完成度', type: 'percent' },
  { key: 'score', label: '评分', type: 'rating', scale: 5 },
  { key: 'day', label: '日期', type: 'date' },
  { key: 'at', label: '时间', type: 'datetime' },
  {
    key: 'mood',
    label: '心情',
    type: 'select',
    options: [
      { value: 'happy', label: '开心' },
      { value: 'sad', label: '低落' },
    ],
  },
  {
    key: 'tags',
    label: '标签',
    type: 'multiselect',
    options: [
      { value: 'food', label: '餐饮' },
      { value: 'traffic', label: '交通' },
    ],
  },
  { key: 'done', label: '完成', type: 'boolean' },
  { key: 'link', label: '链接', type: 'url' },
];

const VALUES = {
  title: '今日复盘',
  note: '第一行\n第二行\n第三行',
  count: 12.5,
  amount: 1234.5,
  progress: 66.6,
  score: 4,
  day: '2026-10-19',
  at: '2026-10-19T02:30:00.000Z',
  mood: 'happy',
  tags: ['food', 'traffic'],
  done: false,
  link: 'https://example.com/a?b=1',
};

describe('formatMemoText', () => {
  it('按字段顺序序列化全部 12 种类型，空值不输出', () => {
    const text = formatMemoText(FIELDS, VALUES);
    const lines = text.split('\n');
    assert.equal(lines[0], '标题：今日复盘');
    assert.equal(lines[1], '备注：第一行');
    assert.equal(lines[2], '第二行');
    assert.equal(lines[3], '第三行');
    assert.ok(text.includes('数量：12.5'));
    assert.ok(text.includes('金额：1234.5'));
    assert.ok(text.includes('完成度：66.6'));
    assert.ok(text.includes('评分：4 / 5'));
    assert.ok(text.includes('日期：2026-10-19'));
    assert.ok(text.includes('时间：2026-10-19T02:30:00.000Z'));
    assert.ok(text.includes('心情：开心'));
    assert.ok(text.includes('标签：餐饮、交通'));
    assert.ok(text.includes('完成：否'));
    assert.ok(text.includes('链接：https://example.com/a?b=1'));
  });

  it('0 与 false 视为有值；null / 空串 / 空数组不输出', () => {
    const fields: FieldDefinition[] = [
      { key: 'n', label: '数字', type: 'number' },
      { key: 'b', label: '开关', type: 'boolean' },
      { key: 't', label: '文本', type: 'text' },
      { key: 'm', label: '多选', type: 'multiselect', options: [{ value: 'a', label: 'A' }] },
    ];
    const text = formatMemoText(fields, { n: 0, b: false, t: '', m: [] });
    assert.equal(text, '数字：0\n开关：否');
  });

  it('字段名重复时改用 key，保证可解析', () => {
    const fields: FieldDefinition[] = [
      { key: 'a', label: '备注', type: 'text' },
      { key: 'b', label: '备注', type: 'text' },
    ];
    const text = formatMemoText(fields, { a: '甲', b: '乙' });
    assert.equal(text, 'a：甲\nb：乙');
  });

  it('数值精度只影响展示，文本模式往返保留原始数值和输入中的小数', () => {
    for (const type of ['number', 'currency', 'percent'] as const) {
      const fields: FieldDefinition[] = [{ key: 'n', label: '数值', type, precision: 0 }];
      for (const value of [1.23456789, 0.000000001, 0, 99.99999999]) {
        const text = formatMemoText(fields, { n: value });
        const parsed = parseMemoText(fields, text);
        assert.equal(parsed.ok, true, JSON.stringify(parsed));
        assert.equal(Number(parsed.draft.n), value, `${type}: ${text}`);
      }
      const draftText = formatMemoText(fields, { n: '1.23456789' });
      assert.equal(parseMemoText(fields, draftText).draft.n, '1.23456789');
    }
  });

  it('字段显示名与其它字段的 key 冲突时使用自身 key', () => {
    const fields: FieldDefinition[] = [
      { key: 'first', label: 'second', type: 'text' },
      { key: 'second', label: '第二项', type: 'text' },
      { key: 'third', label: '第三\n项', type: 'text' },
    ];
    const values = { first: '甲', second: '乙', third: '丙' };
    const text = formatMemoText(fields, values);
    assert.equal(text, 'first：甲\n第二项：乙\nthird：丙');
    assert.deepEqual(parseMemoText(fields, text).draft, values);
  });

  it('长文本中的字段名/字段 key 不会变成其它字段或重复字段行', () => {
    const fields: FieldDefinition[] = [
      { key: 'note', label: '备注', type: 'longtext' },
      { key: 'title', label: '标题', type: 'text' },
    ];
    for (const note of ['第一行\n标题：这是备注', '第一行\n title=这是备注', '第一行\n备注：这是续行']) {
      const values = { note, title: '真实标题' };
      const text = formatMemoText(fields, values);
      assert.equal(text.split('\n').length, 2, text);
      const parsed = parseMemoText(fields, text);
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.deepEqual(parsed.draft, values);
    }
  });

  it('单行文本中的换行，以及带双引号或 CRLF 的文本用 JSON 保留', () => {
    for (const type of ['text', 'longtext'] as const) {
      const fields: FieldDefinition[] = [{ key: 't', label: '文本', type }];
      for (const value of ['"不是 JSON', '"原文引号"', '第一行\r\n第二行', '第一行\n第二行']) {
        const parsed = parseMemoText(fields, formatMemoText(fields, { t: value }));
        assert.equal(parsed.ok, true, JSON.stringify(parsed));
        assert.equal(parsed.draft.t, value);
      }
    }
  });

  it('单选/多选遇到重复显示名或显示名与其它 value 冲突时保留选项值', () => {
    const options = [
      { value: 'a', label: '重复' },
      { value: 'b', label: '重复' },
      { value: 'c', label: 'd' },
      { value: 'd', label: '另一个选项' },
    ];
    const fields: FieldDefinition[] = [
      { key: 'single', label: '单选', type: 'select', options },
      { key: 'multi', label: '多选', type: 'multiselect', options },
    ];
    for (const single of ['a', 'b', 'c', 'd']) {
      const values = { single, multi: ['b', 'c', 'd'] };
      const parsed = parseMemoText(fields, formatMemoText(fields, values));
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.deepEqual(parsed.draft, values);
    }
    const ambiguous = parseMemoText(fields, '单选：重复\n多选：重复');
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.errors.single ?? '', /歧义/);
    assert.match(ambiguous.errors.multi ?? '', /歧义/);
  });

  it('选项 value 含分隔符、换行或 JSON 标记时用 JSON 无损往返', () => {
    for (const value of ['a,b', 'a、b', 'a|b', 'a\nb', '["a"]', '"a"']) {
      const options = [
        { value, label: '重复' },
        { value: 'other', label: '重复' },
      ];
      const fields: FieldDefinition[] = [
        { key: 'single', label: '单选', type: 'select', options },
        { key: 'multi', label: '多选', type: 'multiselect', options },
      ];
      const values = { single: value, multi: [value, 'other'] };
      const text = formatMemoText(fields, values);
      assert.equal(text.split('\n').length, 2, text);
      const parsed = parseMemoText(fields, text);
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.deepEqual(parsed.draft, values);
    }
  });

  it('显示名含分隔符、换行或 JSON 标记时回退安全的原始值', () => {
    for (const label of ['甲,乙', '甲\n乙', '"甲"', '["甲"]']) {
      const fields: FieldDefinition[] = [
        { key: 'multi', label: '多选', type: 'multiselect', options: [{ value: 'a', label }] },
      ];
      const parsed = parseMemoText(fields, formatMemoText(fields, { multi: ['a'] }));
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.deepEqual(parsed.draft.multi, ['a']);
    }
  });

  it('带币种前缀的展示格式也能解析（US$ / AU$ / CA$ / JP¥）', () => {
    for (const [currency, value] of [
      ['USD', 35.5],
      ['AUD', 35.5],
      ['CAD', 35.5],
      ['JPY', 36],
    ] as const) {
      const fields: FieldDefinition[] = [
        { key: 'amount', label: '金额', type: 'currency', currency },
      ];
      const text = `金额：${formatFieldValue(fields[0]!, value)}`;
      const parsed = parseMemoText(fields, text);
      assert.equal(parsed.ok, true, `${currency}: ${text} → ${JSON.stringify(parsed)}`);
      assert.equal(parsed.draft.amount, String(value));
    }
  });
});

describe('parseMemoText', () => {
  it('format → parse 完整往返', () => {
    const text = formatMemoText(FIELDS, VALUES);
    const result = parseMemoText(FIELDS, text);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.lineErrors, []);
    assert.deepEqual(result.errors, {});
    assert.equal(result.matchedCount, FIELDS.length);
    // 数值草稿是字符串，供表单输入框使用
    assert.equal(result.draft.count, '12.5');
    assert.equal(result.draft.amount, '1234.5');
    assert.equal(result.draft.progress, '66.6');
    assert.equal(result.draft.score, '4');
    assert.equal(result.draft.mood, 'happy');
    assert.deepEqual(result.draft.tags, ['food', 'traffic']);
    assert.equal(result.draft.done, false);
    assert.equal(result.draft.note, '第一行\n第二行\n第三行');
  });

  it('支持中英文冒号 / 等号、字段 key、选项 label 与 value', () => {
    const fields = FIELDS;
    const result = parseMemoText(
      fields,
      [
        'title: 用 key 也行',
        '数量＝3',
        '心情: 开心',
        '莫名字段: x',
        '标签: 餐饮,交通',
        '评分: 4 星',
        '金额: ¥1,234.50 元',
        '完成度: 12.34%',
      ].join('\n'),
    );
    assert.equal(result.draft.title, '用 key 也行');
    assert.equal(result.draft.count, '3');
    assert.equal(result.draft.mood, 'happy');
    assert.ok(Array.isArray(result.draft.tags));
    assert.deepEqual(result.draft.tags, ['food', 'traffic']);
    assert.equal(result.draft.score, '4');
    assert.equal(result.draft.amount, '1234.5');
    assert.equal(result.draft.progress, '12.34');
    assert.equal(result.lineErrors.length, 1);
    assert.match(result.lineErrors[0]?.message ?? '', /无法识别/);
    assert.equal(result.ok, false, '未识别行不能让 ok 为 true');
  });

  it('未出现的字段取默认值（清空）', () => {
    const result = parseMemoText(FIELDS, '标题：只写标题');
    assert.equal(result.draft.title, '只写标题');
    assert.equal(result.draft.note, null);
    assert.equal(result.draft.count, null);
    assert.equal(result.draft.done, false);
    assert.deepEqual(result.draft.tags, []);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.ok, true);
  });

  it('longtext 的未知续行归入当前字段，空行保留', () => {
    const result = parseMemoText(FIELDS, '备注：第一行\n\n第三行\n标题：标题\n后续');
    assert.equal(result.draft.note, '第一行\n\n第三行');
    assert.equal(result.draft.title, '标题');
    assert.equal(result.lineErrors.length, 1, '标题后面的未知行不属于 longtext');
    assert.match(result.lineErrors[0]?.message ?? '', /无法识别/);
    assert.equal(result.ok, false);
  });

  it('非法值逐项报错，但其它字段照常填充', () => {
    const result = parseMemoText(FIELDS, '数量：abc\n金额：12\n心情：未知\n标题：仍然识别');
    assert.equal(result.draft.title, '仍然识别');
    assert.equal(result.draft.amount, '12');
    assert.match(result.errors.count ?? '', /必须是数字/);
    assert.match(result.errors.mood ?? '', /不在候选项中/);
    assert.equal(result.draft.count, null);
    assert.equal(result.ok, false);
  });

  it('重复字段行报错并以最后一次为准', () => {
    const result = parseMemoText(FIELDS, '标题：第一次\n标题：第二次');
    assert.equal(result.draft.title, '第二次');
    assert.equal(result.lineErrors.length, 1);
    assert.match(result.lineErrors[0]?.message ?? '', /重复出现/);
    assert.equal(result.ok, false);
  });

  it('字段名重复时 label 行不再猜测，key 行可正常解析', () => {
    const fields: FieldDefinition[] = [
      { key: 'a', label: '备注', type: 'text' },
      { key: 'b', label: '备注', type: 'text' },
    ];
    const ambiguous = parseMemoText(fields, '备注：甲');
    assert.equal(ambiguous.lineErrors.length, 1);
    assert.equal(ambiguous.ok, false);
    const byKey = parseMemoText(fields, 'a：甲\nb：乙');
    assert.equal(byKey.draft.a, '甲');
    assert.equal(byKey.draft.b, '乙');
    assert.equal(byKey.ok, true);
  });

  it('空文本返回全部默认值，不报错', () => {
    const result = parseMemoText(FIELDS, '');
    assert.equal(result.ok, true);
    assert.equal(result.matchedCount, 0);
    assert.deepEqual(result.lineErrors, []);
    assert.deepEqual(result.errors, {});
    for (const def of FIELDS) {
      assert.deepEqual(result.draft[def.key], defaultMemoTextDraftValue(def));
    }
  });

  it('长字段名优先匹配，避免「金额」误吞「金额备注」', () => {
    const fields: FieldDefinition[] = [
      { key: 'amount', label: '金额', type: 'number' },
      { key: 'amount_note', label: '金额备注', type: 'text' },
    ];
    const result = parseMemoText(fields, '金额备注：说明\n金额：12');
    assert.equal(result.draft.amount_note, '说明');
    assert.equal(result.draft.amount, '12');
    assert.equal(result.ok, true);
  });

  it('空白填充值视为合法空值', () => {
    const result = parseMemoText(FIELDS, '标题：   \n数量：  ');
    assert.equal(result.draft.title, null);
    assert.equal(result.draft.count, null);
    assert.equal(result.matchedCount, 2);
    assert.equal(result.ok, true);
  });
});
