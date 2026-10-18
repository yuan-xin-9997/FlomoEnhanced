/**
 * 模板导入的浏览器端预校验与结果摘要（纯函数，SPEC §7）。
 * 复用 `@flomo/shared` 的 `parseTemplateFile`，不重复实现校验逻辑。
 */
import { FIELD_TYPE_META, parseTemplateFile } from '@flomo/shared';
import type { FieldDefinition, TemplateFile, TemplateImportMode, TemplateImportResult } from '@flomo/shared';

/** 单个待导入模板的概要（供预览表展示） */
export interface ImportPreviewEntry {
  name: string;
  icon: string;
  description: string;
  fieldCount: number;
  /** 如「单行文本 ×1、金额 ×2」 */
  typeSummary: string;
  templateVersion: number;
}

/** 导入预览 */
export interface ImportPreview {
  fileName: string;
  exportedAt: string;
  appName: string;
  appVersion: string;
  templates: ImportPreviewEntry[];
  /** 已解析并校验通过的文件对象，可直接提交 */
  file: TemplateFile;
}

export type ImportPreviewResult = { ok: true; preview: ImportPreview } | { ok: false; message: string };

/** 字段类型统计文案 */
export function typeSummaryOf(fields: readonly FieldDefinition[]): string {
  const counts = new Map<string, number>();
  for (const field of fields) {
    const label = FIELD_TYPE_META[field.type]?.label ?? field.type;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${label} ×${count}`).join('、');
}

/** 浏览器端预校验模板文件；失败返回中文原因 */
export function previewTemplateFile(text: string, fileName = '未命名文件'): ImportPreviewResult {
  const parsed = parseTemplateFile(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const file = parsed.file;
  return {
    ok: true,
    preview: {
      fileName,
      exportedAt: file.exportedAt,
      appName: file.app.name,
      appVersion: file.app.version,
      templates: file.templates.map((entry) => ({
        name: entry.name,
        icon: entry.icon,
        description: entry.description,
        fieldCount: entry.fields.length,
        typeSummary: typeSummaryOf(entry.fields),
        templateVersion: entry.templateVersion,
      })),
      file,
    },
  };
}

/** 导入模式中文名 */
export const IMPORT_MODE_LABELS: Record<TemplateImportMode, string> = {
  rename: '重命名（同名自动加「 2」后缀，默认）',
  skip: '跳过同名模板',
  overwrite: '覆盖同名模板（保留原 id 与已有记录关联）',
};

/** 导入结果摘要（含逐条错误明细） */
export interface ImportSummary {
  imported: number;
  skipped: number;
  overwritten: number;
  failed: number;
  errors: Array<{ index: number; name: string; message: string }>;
  skippedDetail: Array<{ name: string; reason: string }>;
  importedNames: string[];
  overwrittenNames: string[];
}

export function summarizeImportResult(result: TemplateImportResult): ImportSummary {
  return {
    imported: result.imported.length,
    skipped: result.skipped.length,
    overwritten: result.overwritten.length,
    failed: result.errors.length,
    errors: result.errors,
    skippedDetail: result.skipped,
    importedNames: result.imported.map((item) => item.name),
    overwrittenNames: result.overwritten.map((item) => item.name),
  };
}
