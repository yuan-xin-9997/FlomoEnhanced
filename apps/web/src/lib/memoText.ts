/**
 * 文本模式在 Web 端的编排：解析文本 → 表单草稿 → 归一化值 + 合并错误。
 * 纯函数，便于单测。
 */
import { parseMemoText } from '@flomo/shared';
import type { FieldDefinition, FieldValue, MemoTextLineError } from '@flomo/shared';
import { normalizeDraft } from './fieldForm';

export interface ParsedMemoTextDraft {
  /** 表单草稿（含所有字段，未出现的字段取默认值） */
  draft: Record<string, FieldValue>;
  /** 归一化后的字段值（仅当 `ok` 时用于保存） */
  values: Record<string, FieldValue>;
  /** 解析错误 + 必填/归一化错误；解析错误优先 */
  errors: Record<string, string>;
  /** 未识别行 / 重复字段行 */
  lineErrors: MemoTextLineError[];
  /** 成功识别的字段数量 */
  matchedCount: number;
  /** 是否既无解析错误，也通过必填/归一化校验 */
  ok: boolean;
}

/** 解析文本模式内容；「未出现的字段」按模板默认值处理（即清空） */
export function parseMemoTextDraft(
  fields: readonly FieldDefinition[],
  text: string,
): ParsedMemoTextDraft {
  const parsed = parseMemoText(fields, text);
  const normalized = normalizeDraft(fields, parsed.draft);
  return {
    draft: parsed.draft,
    values: normalized.values,
    errors: { ...normalized.errors, ...parsed.errors },
    lineErrors: parsed.lineErrors,
    matchedCount: parsed.matchedCount,
    ok: parsed.ok && normalized.ok,
  };
}
