/**
 * 单条想法卡片：时间、模板徽标、内容（#标签高亮）、字段值表格、标签、操作按钮。
 * 每个有模板字段的卡片可独立切换「模板模式 / 文本模式」。
 */
import { useState } from 'react';
import { formatMemoText } from '@flomo/shared';
import type { Memo, Template } from '@flomo/shared';
import { formatDateTime, formatRelativeTime } from '../lib/format';
import { highlightTagSegments } from '../lib/memoQuery';
import FieldValueTable from './FieldValueTable';
import { Segmented } from './ui';

type CardMode = 'template' | 'text';

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
  const fields = template?.fields ?? [];
  const hasFields = fields.length > 0;
  const [mode, setMode] = useState<CardMode>('template');
  const text = hasFields ? formatMemoText(fields, memo.values) : '';

  return (
    <article className="memo">
      <header className="memo-head">
        <time dateTime={memo.createdAt} title={formatDateTime(memo.createdAt)}>
          {formatDateTime(memo.createdAt)}
        </time>
        <span className="memo-sep" aria-hidden="true">
          ·
        </span>
        <span className="memo-rel">{formatRelativeTime(memo.createdAt)}</span>
        {templateName !== null && templateName !== undefined && templateName !== '' && (
          <button
            type="button"
            className="memo-template"
            onClick={() => {
              if (memo.templateId !== null && onTemplateClick !== undefined) onTemplateClick(memo.templateId);
            }}
            title={memo.templateId === null ? '模板已删除' : '按该模板筛选'}
          >
            <span aria-hidden="true">{template?.icon ?? '📄'}</span>
            {templateName}
          </button>
        )}
        <span className="spacer" />
        {(onEdit !== undefined || onDelete !== undefined) && (
          <div className="memo-actions">
            {onEdit !== undefined && (
              <button type="button" className="memo-action" onClick={() => onEdit(memo)}>
                编辑
              </button>
            )}
            {onDelete !== undefined && (
              <button type="button" className="memo-action danger" onClick={() => onDelete(memo)}>
                删除
              </button>
            )}
          </div>
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

      {hasFields ? (
        <div className="memo-fields">
          <div className="fields-mode-head">
            <span className="memo-mode-label">模板字段</span>
            <Segmented
              items={[
                { key: 'template', label: '模板模式' },
                { key: 'text', label: '文本模式' },
              ]}
              value={mode}
              onChange={(key) => setMode(key as CardMode)}
            />
          </div>
          {mode === 'template' ? (
            <FieldValueTable fields={fields} values={memo.values} />
          ) : (
            <pre className={text === '' ? 'memo-text memo-text-empty' : 'memo-text'}>
              {text === '' ? '（无字段值）' : text}
            </pre>
          )}
        </div>
      ) : (
        <FieldValueTable fields={[]} values={memo.values} />
      )}

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
    </article>
  );
}
