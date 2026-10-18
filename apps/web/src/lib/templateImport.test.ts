import { describe, expect, it } from 'vitest';
import { TEMPLATE_FILE_FORMAT, TEMPLATE_FILE_VERSION, buildTemplateFile } from '@flomo/shared';
import type { TemplateFile, TemplateImportResult } from '@flomo/shared';
import { IMPORT_MODE_LABELS, previewTemplateFile, summarizeImportResult, typeSummaryOf } from './templateImport';

const validTemplate = {
  id: 't1',
  name: '每日开销',
  description: '记录每天的花费',
  icon: '💰',
  color: '#3b82f6',
  version: 2,
  fields: [
    { key: 'amount', label: '金额', type: 'currency' as const, currency: 'CNY', precision: 2 },
    { key: 'meal', label: '餐次', type: 'select' as const, options: [{ value: 'lunch', label: '午餐' }] },
  ],
};

function validFileText(): string {
  return JSON.stringify(buildTemplateFile([validTemplate], '1.0.0'));
}

describe('previewTemplateFile（浏览器端预校验）', () => {
  it('合法文件返回模板概要', () => {
    const result = previewTemplateFile(validFileText(), 'my.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.fileName).toBe('my.json');
    expect(result.preview.templates).toHaveLength(1);
    expect(result.preview.templates[0]?.name).toBe('每日开销');
    expect(result.preview.templates[0]?.fieldCount).toBe(2);
    expect(result.preview.templates[0]?.typeSummary).toBe('金额 ×1、单选 ×1');
    expect(result.preview.file.format).toBe(TEMPLATE_FILE_FORMAT);
    expect(result.preview.file.formatVersion).toBe(TEMPLATE_FILE_VERSION);
  });

  it('非 JSON 文本返回中文原因', () => {
    const result = previewTemplateFile('{ 不是 json', 'bad.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('文件不是合法的 JSON');
  });

  it('format 不匹配被拦截', () => {
    const file = JSON.parse(validFileText()) as Record<string, unknown>;
    file.format = 'something-else';
    const result = previewTemplateFile(JSON.stringify(file), 'x.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('文件格式不匹配');
  });

  it('formatVersion 不支持被拦截', () => {
    const file = JSON.parse(validFileText()) as Record<string, unknown>;
    file.formatVersion = 99;
    const result = previewTemplateFile(JSON.stringify(file), 'x.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('文件版本不受支持');
  });

  it('字段定义非法（select 无选项）被拦截', () => {
    const file = JSON.parse(validFileText()) as { templates: Array<Record<string, unknown>> };
    const first = file.templates[0];
    if (first !== undefined) first.fields = [{ key: 'meal', label: '餐次', type: 'select' }];
    const result = previewTemplateFile(JSON.stringify(file), 'x.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('字段定义非法');
  });

  it('缺少模板名称被拦截', () => {
    const file = JSON.parse(validFileText()) as { templates: Array<Record<string, unknown>> };
    const first = file.templates[0];
    if (first !== undefined) first.name = '   ';
    const result = previewTemplateFile(JSON.stringify(file), 'x.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('缺少名称');
  });
});

describe('typeSummaryOf', () => {
  it('按类型聚合计数并保持 fieldTypes 顺序', () => {
    expect(typeSummaryOf([])).toBe('');
    expect(
      typeSummaryOf([
        { key: 'a', label: 'A', type: 'number' },
        { key: 'b', label: 'B', type: 'number' },
        { key: 'c', label: 'C', type: 'longtext' },
      ]),
    ).toBe('数字 ×2、多行文本 ×1');
  });
});

describe('summarizeImportResult', () => {
  it('汇总 imported/skipped/overwritten/errors 明细', () => {
    const result = {
      imported: [{ name: 'A' }, { name: 'B' }],
      skipped: [{ name: 'C', reason: '同名模板已存在' }],
      overwritten: [{ name: 'D' }],
      errors: [{ index: 3, name: 'E', message: '字段定义非法' }],
    } as unknown as TemplateImportResult;

    const summary = summarizeImportResult(result);
    expect(summary).toMatchObject({ imported: 2, skipped: 1, overwritten: 1, failed: 1 });
    expect(summary.importedNames).toEqual(['A', 'B']);
    expect(summary.overwrittenNames).toEqual(['D']);
    expect(summary.skippedDetail[0]?.reason).toBe('同名模板已存在');
    expect(summary.errors[0]?.message).toBe('字段定义非法');
  });
});

describe('导入模式文案', () => {
  it('三种模式都有中文说明', () => {
    expect(Object.keys(IMPORT_MODE_LABELS)).toEqual(['rename', 'skip', 'overwrite']);
    expect(IMPORT_MODE_LABELS.rename).toContain('重命名');
    expect(IMPORT_MODE_LABELS.skip).toContain('跳过');
    expect(IMPORT_MODE_LABELS.overwrite).toContain('覆盖');
  });
});

/** 类型层面确认 TemplateFile 结构可用 */
const _typecheck: (file: TemplateFile) => number = (file) => file.templates.length;
void _typecheck;
