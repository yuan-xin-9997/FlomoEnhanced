import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TemplateExportSource } from '../src/index.ts';
import {
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  buildTemplateFile,
  parseTemplateFile,
  slugifyKey,
} from '../src/index.ts';

const source: TemplateExportSource = {
  id: 'tpl-1',
  name: '每日开销',
  description: '记录每天的花费',
  icon: '💰',
  color: '#3b82f6',
  version: 3,
  fields: [
    { key: 'amount', label: '金额', type: 'currency', currency: 'CNY' },
    { key: 'category', label: '分类', type: 'select', options: [{ value: 'food', label: '餐饮' }] },
  ],
};

describe('buildTemplateFile', () => {
  it('生成符合 SPEC §7 的文件结构', () => {
    const file = buildTemplateFile([source], '1.0.0');
    assert.equal(file.format, TEMPLATE_FILE_FORMAT);
    assert.equal(file.formatVersion, TEMPLATE_FILE_VERSION);
    assert.equal(file.app.name, 'FlomoEnhanced');
    assert.equal(file.app.version, '1.0.0');
    assert.ok(Number.isFinite(Date.parse(file.exportedAt)));
    assert.equal(file.templates.length, 1);
    assert.equal(file.templates[0]?.name, '每日开销');
    assert.equal(file.templates[0]?.templateVersion, 3);
    assert.equal(file.templates[0]?.exportedId, 'tpl-1');
    assert.equal(file.templates[0]?.fields.length, 2);
  });
});

describe('parseTemplateFile', () => {
  it('可以往返解析自己导出的文件', () => {
    const file = buildTemplateFile([source], '1.0.0');
    const result = parseTemplateFile(JSON.parse(JSON.stringify(file)));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.file.templates[0]?.fields.length, 2);
      assert.equal(result.file.templates[0]?.fields[0]?.key, 'amount');
    }
  });

  it('接受 JSON 字符串输入', () => {
    const result = parseTemplateFile(JSON.stringify(buildTemplateFile([source], '1.0.0')));
    assert.equal(result.ok, true);
  });

  it('拒绝格式不匹配 / 版本不匹配 / 非数组模板', () => {
    const bad1 = parseTemplateFile({ format: 'other', formatVersion: 1, templates: [] });
    assert.equal(bad1.ok, false);
    if (!bad1.ok) assert.match(bad1.message, /format/);

    const bad2 = parseTemplateFile({ format: TEMPLATE_FILE_FORMAT, formatVersion: 2, templates: [] });
    assert.equal(bad2.ok, false);
    if (!bad2.ok) assert.match(bad2.message, /formatVersion/);

    const bad3 = parseTemplateFile({ format: TEMPLATE_FILE_FORMAT, formatVersion: 1, templates: {} });
    assert.equal(bad3.ok, false);
  });

  it('拒绝字段定义非法的模板', () => {
    const bad = parseTemplateFile({
      format: TEMPLATE_FILE_FORMAT,
      formatVersion: 1,
      templates: [{ name: '坏模板', fields: [{ key: 's', label: '单选', type: 'select' }] }],
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.message, /坏模板/);
  });

  it('拒绝非法 JSON 字符串', () => {
    const result = parseTemplateFile('{ not json');
    assert.equal(result.ok, false);
  });
});

describe('slugifyKey', () => {
  it('英文标签转小写下划线', () => {
    assert.equal(slugifyKey('Total Amount'), 'total_amount');
    assert.equal(slugifyKey('field-1'), 'field_1');
    assert.match(slugifyKey('金额 (CNY)'), /^[a-z][a-z0-9_]{0,39}$/);
  });

  it('中文标签生成合法且稳定的 key', () => {
    const key = slugifyKey('金额');
    assert.match(key, /^[a-z][a-z0-9_]{0,39}$/);
    assert.equal(key, slugifyKey('金额'));
    assert.notEqual(key, slugifyKey('心情'));
  });

  it('冲突时自动加数字后缀', () => {
    assert.equal(slugifyKey('name', ['name']), 'name_2');
    assert.equal(slugifyKey('name', ['name', 'name_2']), 'name_3');
    const long = slugifyKey('a'.repeat(40), ['a'.repeat(40)]);
    assert.ok(long.length <= 40);
    assert.notEqual(long, 'a'.repeat(40));
  });
});
