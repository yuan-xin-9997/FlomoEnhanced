import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_TAG_LENGTH, extractTags, normalizeTag } from '../src/index.ts';

describe('extractTags', () => {
  it('从正文提取 #标签并去掉 # 前缀', () => {
    assert.deepEqual(extractTags('今天读完了一本书 #读书 #复盘'), ['读书', '复盘']);
  });

  it('相邻标签、中文标点与括号边界正确切分', () => {
    assert.deepEqual(extractTags('#工作#生活，明天再说（#临时）'), ['工作', '生活', '临时']);
  });

  it('合并显式 tags、去重并保持首次出现顺序', () => {
    assert.deepEqual(extractTags('#工作 很累', ['#工作', '生活', '工作']), ['工作', '生活']);
  });

  it('空内容与非法入参返回空数组', () => {
    assert.deepEqual(extractTags(''), []);
    assert.deepEqual(extractTags(null), []);
    assert.deepEqual(extractTags(undefined, []), []);
  });

  it('截断超长标签并限制最多 50 个', () => {
    const long = 'a'.repeat(60);
    assert.equal(extractTags(`#${long}`)[0]?.length, MAX_TAG_LENGTH);
    const many = Array.from({ length: 60 }, (_, index) => `#tag${index}`).join(' ');
    assert.equal(extractTags(many).length, 50);
  });

  it('不把选择类字段 label 当标签（由调用方保证不传入）', () => {
    assert.deepEqual(extractTags('记录一条 #餐饮'), ['餐饮']);
  });
});

describe('normalizeTag', () => {
  it('去前缀、去空白、保留中文', () => {
    assert.equal(normalizeTag('  ##工作 '), '工作');
    assert.equal(normalizeTag(''), '');
  });
});
