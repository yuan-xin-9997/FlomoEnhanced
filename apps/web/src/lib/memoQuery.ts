/**
 * 记录页的筛选条件、标签高亮与导出文件名（纯函数）。
 */
import { TAG_PATTERN } from '@flomo/shared';
import type { FieldValue, MemoUpsertBody } from '@flomo/shared';
import { dayEndIso, dayStartIso } from './dates';
import { safeFileName } from './format';

/** 列表筛选条件 */
export interface MemoFilters {
  /** '' 表示全部；'__none__' 表示无模板 */
  templateId: string;
  tag: string;
  /** `YYYY-MM-DD`，空串表示不限 */
  from: string;
  to: string;
  q: string;
}

/** 无模板的哨兵值（用于筛选下拉） */
export const NO_TEMPLATE_FILTER = '__none__';

/** 空筛选条件 */
export function emptyFilters(): MemoFilters {
  return { templateId: '', tag: '', from: '', to: '', q: '' };
}

/** 是否存在生效的筛选 */
export function hasActiveFilters(filters: MemoFilters): boolean {
  return (
    filters.templateId !== '' || filters.tag !== '' || filters.from !== '' || filters.to !== '' || filters.q.trim() !== ''
  );
}

/** 筛选条件 → `GET /api/memos` 查询参数 */
export function filtersToQuery(
  filters: MemoFilters,
  options: { limit?: number; cursor?: string | null } = {},
): {
  templateId?: string | null;
  from?: string;
  to?: string;
  tag?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
} {
  const params: {
    templateId?: string | null;
    from?: string;
    to?: string;
    tag?: string;
    q?: string;
    limit?: number;
    cursor?: string | null;
  } = {};
  if (filters.templateId === NO_TEMPLATE_FILTER) params.templateId = 'null';
  else if (filters.templateId !== '') params.templateId = filters.templateId;
  if (filters.tag !== '') params.tag = filters.tag;
  if (filters.q.trim() !== '') params.q = filters.q.trim();
  if (filters.from !== '') params.from = dayStartIso(filters.from);
  if (filters.to !== '') params.to = dayEndIso(filters.to);
  if (options.limit !== undefined) params.limit = options.limit;
  if (options.cursor !== undefined && options.cursor !== null && options.cursor !== '') params.cursor = options.cursor;
  return params;
}

/** 构造 memo 写入体（空字段值统一提交，交由后端校验） */
export function memoBodyOf(input: {
  content: string;
  templateId: string | null;
  values?: Record<string, FieldValue>;
  tags?: string[];
  createdAt?: string;
}): MemoUpsertBody {
  const body: MemoUpsertBody = { content: input.content };
  if (input.templateId === null) {
    body.templateId = null;
    body.values = {};
  } else {
    body.templateId = input.templateId;
    body.values = input.values ?? {};
  }
  if (input.tags !== undefined && input.tags.length > 0) body.tags = input.tags;
  if (input.createdAt !== undefined && input.createdAt !== '') body.createdAt = input.createdAt;
  return body;
}

/** 内容分段（用于 `#标签` 高亮渲染） */
export interface ContentSegment {
  text: string;
  /** 是否为 `#标签` 片段 */
  tag: boolean;
}

/** 把 memo 内容切成普通片段与 `#标签` 片段（正则与后端一致） */
export function highlightTagSegments(content: string): ContentSegment[] {
  if (content === '') return [];
  const pattern = new RegExp(TAG_PATTERN.source, 'g');
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    const raw = match[0];
    const start = match.index;
    if (start > lastIndex) segments.push({ text: content.slice(lastIndex, start), tag: false });
    if (raw !== '') segments.push({ text: raw, tag: true });
    lastIndex = start + raw.length;
    if (raw === '') pattern.lastIndex += 1;
    match = pattern.exec(content);
  }
  if (lastIndex < content.length) segments.push({ text: content.slice(lastIndex), tag: false });
  return segments;
}

/** 日期 `YYYYMMDD` 片段（导出文件名用） */
export function compactDate(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match === null) return dayKey.replace(/[^\d]/g, '');
  return `${match[1]}${match[2]}${match[3]}`;
}

/** CSV 下载的兜底文件名：`<模板名>-YYYYMMDD.csv` */
export function csvFallbackName(templateName: string, today: string): string {
  return `${safeFileName(templateName, 'memos')}-${compactDate(today)}.csv`;
}

/** 模板导出兜底文件名：`flomo-templates-YYYYMMDD.json` */
export function templateExportFallbackName(today: string): string {
  return `flomo-templates-${compactDate(today)}.json`;
}
