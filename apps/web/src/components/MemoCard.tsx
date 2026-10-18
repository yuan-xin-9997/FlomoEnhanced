/**
 * 单条想法卡片：时间、模板徽标、内容（#标签高亮）、字段值表格、标签、操作按钮。
 */
import type { Memo, Template } from '@flomo/shared';
import { formatDateTime, formatRelativeTime } from '../lib/format';
import { highlightTagSegments } from '../lib/memoQuery';
import FieldValueTable from './FieldValueTable';

export interface MemoCardProps {
  memo: Memo;
  /** 可能为 undefined（模板已删除或列表未加载完） */
  template?: Template;
  onEdit?: (memo: Memo) => void;
  onDelete?: (memo: Memo) => void;
  onTagClick?: (tag: string) => void;
  onTemplateClick?: (templateId: string) => void;
}

export default function MemoCard({
  memo,
  template,
  onEdit,
  onDelete,
  onTagClick,
  onTemplateClick,
}: MemoCardProps): JSX.Element {
  const segments = highlightTagSegments(memo.content);
  const templateName = template?.name ?? memo.templateName;

  return (
    <article className="memo">
      <header className="memo-head">
        <time dateTime={memo.createdAt} title={formatDateTime(memo.createdAt)}>
          {formatDateTime(memo.createdAt)}
        </time>
        <span aria-hidden="true">·</span>
        <span>{formatRelativeTime(memo.createdAt)}</span>
        {templateName !== null && templateName !== undefined && templateName !== '' && (
          <button
            type="button"
            className="badge badge-accent tag-pill"
            onClick={() => {
              if (memo.templateId !== null && onTemplateClick !== undefined) onTemplateClick(memo.templateId);
            }}
            title={memo.templateId === null ? '模板已删除' : '按该模板筛选'}
          >
            <span aria-hidden="true">{template?.icon ?? '📄'}</span>
            {templateName}
          </button>
        )}
      </header>

      {memo.content !== '' && (
        <p className="memo-content">
          {segments.map((segment, index) =>
            segment.tag ? (
              <span key={index} className="tag-hl">
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      )}

      <FieldValueTable fields={template?.fields ?? []} values={memo.values} />

      {memo.tags.length > 0 && (
        <div className="memo-tags">
          {memo.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-pill"
              onClick={() => {
                if (onTagClick !== undefined) onTagClick(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {(onEdit !== undefined || onDelete !== undefined) && (
        <div className="memo-actions">
          {onEdit !== undefined && (
            <button type="button" className="btn btn-sm" onClick={() => onEdit(memo)}>
              编辑
            </button>
          )}
          {onDelete !== undefined && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(memo)}>
              删除
            </button>
          )}
        </div>
      )}
    </article>
  );
}
