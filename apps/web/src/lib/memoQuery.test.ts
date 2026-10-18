import { describe, expect, it } from 'vitest';
import {
  NO_TEMPLATE_FILTER,
  compactDate,
  csvFallbackName,
  emptyFilters,
  filtersToQuery,
  hasActiveFilters,
  highlightTagSegments,
  memoBodyOf,
  templateExportFallbackName,
} from './memoQuery';

describe('筛选条件 → 查询参数', () => {
  it('空筛选不产生任何参数', () => {
    expect(filtersToQuery(emptyFilters())).toEqual({});
    expect(hasActiveFilters(emptyFilters())).toBe(false);
  });

  it('模板 / 标签 / 关键字 / 日期区间', () => {
    const query = filtersToQuery(
      { templateId: 't1', tag: '工作', from: '2026-10-01', to: '2026-10-18', q: '  复盘  ' },
      { limit: 20 },
    );
    expect(query.templateId).toBe('t1');
    expect(query.tag).toBe('工作');
    expect(query.q).toBe('复盘');
    expect(query.limit).toBe(20);
    expect(query.from).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).toISOString());
    expect(query.to).toBe(new Date(2026, 9, 18, 23, 59, 59, 999).toISOString());
    expect('cursor' in query).toBe(false);
  });

  it('「无模板」哨兵下发 templateId=null（由服务端筛选，避免分页漏数据）', () => {
    const query = filtersToQuery({ ...emptyFilters(), templateId: NO_TEMPLATE_FILTER }, { cursor: 'abc' });
    expect(query.templateId).toBe('null');
    expect(query.cursor).toBe('abc');
  });

  it('hasActiveFilters 识别任一条件', () => {
    expect(hasActiveFilters({ ...emptyFilters(), q: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...emptyFilters(), tag: 'x' })).toBe(true);
  });
});

describe('「无模板」筛选走服务端', () => {
  it('只下发 templateId=null，不再做前端补筛', () => {
    const query = filtersToQuery(
      { ...emptyFilters(), templateId: NO_TEMPLATE_FILTER },
      { limit: 20 },
    );
    expect(query.templateId).toBe('null');
    expect(query.limit).toBe(20);
  });
});

describe('highlightTagSegments（#标签高亮）', () => {
  it('切分普通文本与标签片段', () => {
    expect(highlightTagSegments('今天学习 #编程 很爽')).toEqual([
      { text: '今天学习 ', tag: false },
      { text: '#编程', tag: true },
      { text: ' 很爽', tag: false },
    ]);
  });

  it('标签位于开头 / 结尾 / 连续出现', () => {
    expect(highlightTagSegments('#a#b 结束')).toEqual([
      { text: '#a', tag: true },
      { text: '#b', tag: true },
      { text: ' 结束', tag: false },
    ]);
    expect(highlightTagSegments('开始 #a')).toEqual([
      { text: '开始 ', tag: false },
      { text: '#a', tag: true },
    ]);
  });

  it('标点与空内容不产生空片段', () => {
    expect(highlightTagSegments('')).toEqual([]);
    expect(highlightTagSegments('没有标签的普通内容')).toEqual([{ text: '没有标签的普通内容', tag: false }]);
    expect(highlightTagSegments('#工作, #生活。')).toEqual([
      { text: '#工作', tag: true },
      { text: ', ', tag: false },
      { text: '#生活', tag: true },
      { text: '。', tag: false },
    ]);
  });
});

describe('memo 写入体', () => {
  it('无模板时提交 templateId = null 且 values 为空对象', () => {
    expect(memoBodyOf({ content: 'hi', templateId: null })).toEqual({ content: 'hi', templateId: null, values: {} });
  });

  it('有模板时携带 values，空标签不提交', () => {
    expect(memoBodyOf({ content: 'hi', templateId: 't1', values: { a: 1 }, tags: [] })).toEqual({
      content: 'hi',
      templateId: 't1',
      values: { a: 1 },
    });
  });
});

describe('导出文件名', () => {
  it('CSV / 模板文件兜底名', () => {
    expect(csvFallbackName('每日开销', '2026-10-18')).toBe('每日开销-20261018.csv');
    expect(csvFallbackName('a/b c', '2026-01-02')).toBe('a_b_c-20260102.csv');
    expect(templateExportFallbackName('2026-10-18')).toBe('flomo-templates-20261018.json');
    expect(compactDate('2026-10-18')).toBe('20261018');
    expect(compactDate('bad')).toBe('');
  });
});
