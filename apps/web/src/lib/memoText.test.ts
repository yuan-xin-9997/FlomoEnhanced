import { describe, expect, it } from 'vitest';
import { formatMemoText } from '@flomo/shared';
import type { FieldDefinition } from '@flomo/shared';
import { parseMemoTextDraft } from './memoText';

const FIELDS: FieldDefinition[] = [
  { key: 'title', label: '标题', type: 'text', required: true },
  { key: 'amount', label: '金额', type: 'currency', currency: 'CNY' },
  {
    key: 'mood',
    label: '心情',
    type: 'select',
    options: [
      { value: 'happy', label: '开心' },
      { value: 'sad', label: '低落' },
    ],
  },
];

describe('parseMemoTextDraft', () => {
  it('识别成功时同时给出草稿、归一化值与识别数量', () => {
    const result = parseMemoTextDraft(FIELDS, '标题：午饭\n金额：¥35.50\n心情：开心');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.lineErrors).toEqual([]);
    expect(result.matchedCount).toBe(3);
    expect(result.draft.amount).toBe('35.5');
    expect(result.draft.mood).toBe('happy');
    expect(result.values).toEqual({ title: '午饭', amount: 35.5, mood: 'happy' });
  });

  it('必填字段缺失时 ok=false，但已识别字段仍保留', () => {
    const result = parseMemoTextDraft(FIELDS, '金额：12');
    expect(result.ok).toBe(false);
    expect(result.errors.title).toBe('「标题」为必填项');
    expect(result.draft.amount).toBe('12');
    expect(result.values.amount).toBe(12);
  });

  it('未识别行与非法值合并报告，可识别字段照常填充', () => {
    const result = parseMemoTextDraft(FIELDS, '标题：保留\n未知：x\n金额：abc');
    expect(result.ok).toBe(false);
    expect(result.draft.title).toBe('保留');
    expect(result.lineErrors).toHaveLength(1);
    expect(result.errors.amount).toContain('必须是数字');
  });

  it('format → parse 往返保持选择类字段的 value', () => {
    const text = formatMemoText(FIELDS, { title: '往返', amount: 12.5, mood: 'sad' });
    const result = parseMemoTextDraft(FIELDS, text);
    expect(result.ok).toBe(true);
    expect(result.draft.mood).toBe('sad');
    expect(result.values).toEqual({ title: '往返', amount: 12.5, mood: 'sad' });
  });

  it('空文本：未出现的字段按默认值清空，必填字段报错', () => {
    const result = parseMemoTextDraft(FIELDS, '');
    expect(result.draft.amount).toBeNull();
    expect(result.draft.mood).toBeNull();
    expect(result.errors.title).toBe('「标题」为必填项');
    expect(result.ok).toBe(false);
  });
});
