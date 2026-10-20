/**
 * 记录页（/）—— 核心页面。
 * 顶部撰写区（模板选择 + 按字段类型渲染的表单）、想法列表（游标分页）、
 * 列头（范围下拉 + 搜索）与可展开筛选（模板/标签/日期/关键字）。
 * 筛选条件与 URL 查询参数双向同步，便于侧栏（标签、热力图）直接跳转。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatMemoText } from '@flomo/shared';
import type { FieldValue, Memo, MemoTextLineError, Template } from '@flomo/shared';
import { memosApi, templatesApi, errorMessage } from '../api/client';
import FieldForm from '../components/FieldForm';
import Icon from '../components/icons';
import MemoCard from '../components/MemoCard';
import MemoEditModal from '../components/MemoEditModal';
import MemoTextEditor from '../components/MemoTextEditor';
import { EmptyState, ErrorBox, Segmented, SkeletonList } from '../components/ui';
import { emptyDraft, isDraftEmpty, normalizeDraft } from '../lib/fieldForm';
import { parseMemoTextDraft } from '../lib/memoText';
import { formatCount } from '../lib/format';
import {
  NO_TEMPLATE_FILTER,
  emptyFilters,
  filtersToQuery,
  hasActiveFilters,
  memoBodyOf,
} from '../lib/memoQuery';
import type { MemoFilters } from '../lib/memoQuery';
import { parseDayKey } from '../lib/dates';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useOverview } from '../state/overview';
import { useToast } from '../state/toast';

const PAGE_SIZE = 20;

/** 模板字段的编辑/展示方式 */
type ComposerMode = 'template' | 'text';

/** URL 查询参数 → 筛选条件（`template=none` 表示无模板） */
function filtersFromSearch(search: URLSearchParams): MemoFilters {
  const template = search.get('template') ?? '';
  const day = (key: string): string => {
    const value = search.get(key) ?? '';
    return parseDayKey(value) === null ? '' : value;
  };
  return {
    templateId: template === 'none' ? NO_TEMPLATE_FILTER : template,
    tag: (search.get('tag') ?? '').replace(/^#/, ''),
    from: day('from'),
    to: day('to'),
    q: search.get('q') ?? '',
  };
}

/** 筛选条件 → URL 查询参数（空值不写入） */
function searchFromFilters(filters: MemoFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.templateId === NO_TEMPLATE_FILTER) search.set('template', 'none');
  else if (filters.templateId !== '') search.set('template', filters.templateId);
  if (filters.tag !== '') search.set('tag', filters.tag);
  if (filters.from !== '') search.set('from', filters.from);
  if (filters.to !== '') search.set('to', filters.to);
  if (filters.q.trim() !== '') search.set('q', filters.q);
  return search;
}

export default function MemoPage(): JSX.Element {
  useDocumentTitle('记录');
  const overview = useOverview();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [templates, setTemplates] = useState<Template[]>([]);

  const [composerTemplateId, setComposerTemplateId] = useState('');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState<Record<string, FieldValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [composerMode, setComposerMode] = useState<ComposerMode>('template');
  const [textDraft, setTextDraft] = useState('');
  const [textLineErrors, setTextLineErrors] = useState<MemoTextLineError[]>([]);
  const [textNotice, setTextNotice] = useState('');
  const [textWarning, setTextWarning] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [items, setItems] = useState<Memo[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [editing, setEditing] = useState<Memo | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams]);
  const filtersKey = searchParams.toString();

  const cursorRef = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const composerTemplate = useMemo(
    () => templates.find((template) => template.id === composerTemplateId),
    [templates, composerTemplateId],
  );
  const composerHasFields = composerTemplate !== undefined && composerTemplate.fields.length > 0;
  const effectiveComposerMode: ComposerMode = composerHasFields ? composerMode : 'template';

  /* ------------------------------ 数据加载 ------------------------------ */

  const loadTemplates = useCallback(async (): Promise<void> => {
    try {
      const response = await templatesApi.list(false);
      setTemplates(response.items);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [toast]);

  const loadMemos = useCallback(
    async (mode: 'reset' | 'more'): Promise<void> => {
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      if (mode === 'reset') setListLoading(true);
      else setLoadingMore(true);
      setListError('');
      try {
        const response = await memosApi.list(
          filtersToQuery(filtersFromSearch(new URLSearchParams(filtersKey)), {
            limit: PAGE_SIZE,
            cursor: mode === 'more' ? cursorRef.current : null,
          }),
        );
        if (seq !== requestSeq.current) return;
        setItems((previous) => (mode === 'more' ? [...previous, ...response.items] : response.items));
        cursorRef.current = response.nextCursor;
        setTotal(response.total);
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setListError(errorMessage(error));
        if (mode === 'reset') setItems([]);
      } finally {
        if (seq === requestSeq.current) {
          setListLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filtersKey],
  );

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    cursorRef.current = null;
    void loadMemos('reset');
  }, [loadMemos]);

  // 切换撰写区模板时重置字段草稿（保留模板选择方便连续记账）
  useEffect(() => {
    // 选择模板后使用模板字段（或文本模式）作为唯一输入区，自由内容框隐藏，故清空内容
    setContent('');
    const nextDraft = composerTemplate === undefined ? {} : emptyDraft(composerTemplate.fields);
    setDraft(nextDraft);
    setFieldErrors({});
    setComposerMode('template');
    setTextLineErrors([]);
    setTextNotice('');
    setTextWarning('');
    setTextDraft(composerTemplate === undefined ? '' : formatMemoText(composerTemplate.fields, nextDraft));
  }, [composerTemplate]);

  // Ctrl / Cmd + K 聚焦搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ------------------------------ 筛选 ------------------------------ */

  const patchFilters = (patch: Partial<MemoFilters>): void => {
    setSearchParams(searchFromFilters({ ...filters, ...patch }), { replace: true });
  };

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const activeBeyondTemplate =
    filters.tag !== '' || filters.from !== '' || filters.to !== '' || filters.q.trim() !== '';
  const templateLabel =
    filters.templateId === ''
      ? '全部笔记'
      : filters.templateId === NO_TEMPLATE_FILTER
        ? '无模板'
        : (templates.find((template) => template.id === filters.templateId)?.name ?? '全部笔记');

  /* ------------------------------ 提交 ------------------------------ */

  const applyComposerText = (text: string): ReturnType<typeof parseMemoTextDraft> | null => {
    if (composerTemplate === undefined) return null;
    const parsed = parseMemoTextDraft(composerTemplate.fields, text);
    setDraft(parsed.draft);
    setFieldErrors(parsed.errors);
    setTextLineErrors(parsed.lineErrors);
    setTextNotice(parsed.ok ? `已识别 ${parsed.matchedCount} 个字段` : '');
    setTextWarning('');
    setFormError('');
    return parsed;
  };

  /** 手工输入不立即解析；清掉旧提示，等切换 / 保存时再处理 */
  const onComposerTextChange = (text: string): void => {
    setTextDraft(text);
    setTextLineErrors([]);
    setTextNotice('');
    setTextWarning('');
    setFieldErrors({});
    setFormError('');
  };

  /** 粘贴后立即按「插入后的完整文本」解析 */
  const onComposerTextPaste = (text: string): void => {
    setTextDraft(text);
    applyComposerText(text);
  };

  const onComposerModeChange = (next: ComposerMode): void => {
    if (next === effectiveComposerMode) return;
    if (next === 'text') {
      if (composerTemplate !== undefined) {
        setTextDraft(formatMemoText(composerTemplate.fields, draft));
      }
      setTextLineErrors([]);
      setTextNotice('');
      setTextWarning('');
      setFieldErrors({});
      setFormError('');
      setComposerMode('text');
      return;
    }

    // 文本 → 模板：重新解析当前文本，让手动修改也生效
    if (composerTemplate !== undefined) {
      const parsed = applyComposerText(textDraft);
      if (parsed !== null && parsed.lineErrors.length > 0) {
        setTextWarning(`文本中有 ${parsed.lineErrors.length} 行无法识别，已忽略；当前以模板字段为准。`);
      }
    }
    setComposerMode('template');
  };

  const canSubmit = useMemo(() => {
    if (content.trim() !== '') return true;
    if (composerTemplate !== undefined && effectiveComposerMode === 'text') {
      return textDraft.trim() !== '';
    }
    return composerTemplate !== undefined && !isDraftEmpty(draft);
  }, [content, composerTemplate, effectiveComposerMode, textDraft, draft]);

  const onSubmit = async (): Promise<void> => {
    const trimmed = content.trim();
    let values: Record<string, FieldValue> = {};

    if (composerTemplate !== undefined) {
      if (effectiveComposerMode === 'text') {
        const parsed = applyComposerText(textDraft);
        if (parsed === null || !parsed.ok) {
          setFormError('文本识别未通过，请根据提示修正后再保存');
          return;
        }
        values = parsed.values;
      } else {
        const normalized = normalizeDraft(composerTemplate.fields, draft);
        if (!normalized.ok) {
          setFieldErrors(normalized.errors);
          setFormError('字段校验未通过，请检查后重试');
          return;
        }
        values = normalized.values;
      }
    }

    if (trimmed === '' && (composerTemplate === undefined || isDraftEmpty(values))) {
      setFormError('内容与模板字段不能同时为空');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await memosApi.create(
        memoBodyOf({
          content: trimmed,
          templateId: composerTemplate === undefined ? null : composerTemplate.id,
          values,
        }),
      );
      const nextDraft = composerTemplate === undefined ? {} : emptyDraft(composerTemplate.fields);
      setContent('');
      setDraft(nextDraft);
      setFieldErrors({});
      setTextLineErrors([]);
      setTextNotice('');
      setTextWarning('');
      setTextDraft(composerTemplate === undefined ? '' : formatMemoText(composerTemplate.fields, nextDraft));
      toast.success('已记录');
      cursorRef.current = null;
      void loadMemos('reset');
      void overview.reload();
      textareaRef.current?.focus();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (memo: Memo): Promise<void> => {
    const preview = memo.content.trim() === '' ? '（无文字内容）' : memo.content.trim().slice(0, 30);
    if (!window.confirm(`确定删除这条记录吗？\n\n${preview}\n\n删除后不可恢复。`)) return;
    try {
      await memosApi.remove(memo.id);
      toast.success('已删除');
      cursorRef.current = null;
      void loadMemos('reset');
      void overview.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!submitting) void onSubmit();
    }
  };

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <div className="page page-memo">
      <header className="col-head">
        <div className="col-title">
          <label className="sr-only" htmlFor="filter-template">
            模板范围
          </label>
          <select
            id="filter-template"
            className="col-title-select"
            value={filters.templateId}
            onChange={(event) => patchFilters({ templateId: event.target.value })}
          >
            <option value="">全部笔记</option>
            <option value={NO_TEMPLATE_FILTER}>无模板</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.icon} {template.name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={15} className="col-title-chevron" />
        </div>

        <div className="col-tools">
          <div className="search-pill">
            <Icon name="search" size={15} />
            <input
              id="filter-q"
              ref={searchRef}
              className="search-input"
              value={filters.q}
              placeholder="搜索笔记"
              aria-label="搜索笔记"
              onChange={(event) => patchFilters({ q: event.target.value })}
            />
            <kbd className="search-kbd">Ctrl+K</kbd>
          </div>
          <button
            type="button"
            className={activeBeyondTemplate ? 'icon-btn active' : 'icon-btn'}
            aria-expanded={filtersOpen}
            aria-label="更多筛选"
            title="更多筛选"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Icon name="filter" size={16} />
          </button>
        </div>
      </header>

      {filtersOpen && (
        <div className="filter-panel">
          <div className="filter-panel-grid">
            <div>
              <label className="label" htmlFor="filter-tag">
                标签
              </label>
              <input
                id="filter-tag"
                className="input"
                value={filters.tag}
                placeholder="如 工作"
                onChange={(event) => patchFilters({ tag: event.target.value.replace(/^#/, '') })}
              />
            </div>
            <div>
              <label className="label" htmlFor="filter-from">
                开始日期
              </label>
              <input
                id="filter-from"
                className="input"
                type="date"
                value={filters.from}
                onChange={(event) => patchFilters({ from: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="filter-to">
                结束日期
              </label>
              <input
                id="filter-to"
                className="input"
                type="date"
                value={filters.to}
                onChange={(event) => patchFilters({ to: event.target.value })}
              />
            </div>
          </div>
          {hasActiveFilters(filters) && (
            <div className="filter-panel-foot">
              <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilters}>
                清除全部筛选
              </button>
            </div>
          )}
        </div>
      )}

      <section className="composer" onKeyDown={onComposerKeyDown}>
        {composerTemplate === undefined ? (
          <>
            <label className="sr-only" htmlFor="composer-content">
              记录内容
            </label>
            <textarea
              id="composer-content"
              ref={textareaRef}
              className="textarea composer-input"
              autoFocus
              placeholder="现在的想法是…"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </>
        ) : (
          // 选择模板后，模板字段（或文本模式）就是唯一的输入区，占据顶部原内容框的位置
          <div className="composer-fields composer-fields-primary">
            {composerHasFields && (
              <div className="fields-mode-head">
                <span className="memo-mode-label">模板字段</span>
                <Segmented
                  items={[
                    { key: 'template', label: '模板模式' },
                    { key: 'text', label: '文本模式' },
                  ]}
                  value={effectiveComposerMode}
                  onChange={(key) => onComposerModeChange(key as ComposerMode)}
                />
              </div>
            )}
            {effectiveComposerMode === 'template' ? (
              <FieldForm
                fields={composerTemplate.fields}
                values={draft}
                errors={fieldErrors}
                idPrefix="composer"
                onChange={(key, value) => {
                  setDraft((previous) => ({ ...previous, [key]: value }));
                  setFieldErrors((previous) => {
                    if (previous[key] === undefined) return previous;
                    const next = { ...previous };
                    delete next[key];
                    return next;
                  });
                }}
              />
            ) : (
              <MemoTextEditor
                id="composer-text-fields"
                value={textDraft}
                onChange={onComposerTextChange}
                onPasteText={onComposerTextPaste}
                lineErrors={textLineErrors}
                fieldErrors={fieldErrors}
                notice={textNotice}
                rows={6}
              />
            )}
          </div>
        )}

        {textWarning !== '' && <div className="notice notice-warn mt-12">{textWarning}</div>}

        {formError !== '' && (
          <div className="error-box mt-12" role="alert">
            <span>{formError}</span>
          </div>
        )}

        <div className="composer-foot">
          <div className="composer-template">
            <Icon name="grid" size={15} />
            <label className="sr-only" htmlFor="composer-template">
              模板
            </label>
            <select
              id="composer-template"
              className="composer-template-select"
              value={composerTemplateId}
              onChange={(event) => setComposerTemplateId(event.target.value)}
            >
              <option value="">不使用模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.icon} {template.name}
                </option>
              ))}
            </select>
          </div>

          {composerTemplate === undefined && (
            <div className="composer-tags">
              <Icon name="hash" size={15} />
              <span className="composer-tag-hint">#标签</span>
            </div>
          )}

          <span className="spacer" />
          {!canSubmit && trimmedHint(content, composerTemplate !== undefined, effectiveComposerMode, textDraft, draft)}
          <button
            type="button"
            className="send-btn"
            disabled={submitting || !canSubmit}
            onClick={() => void onSubmit()}
            aria-label={submitting ? '保存中' : '记录'}
            title="记录（Ctrl / Cmd + Enter）"
          >
            <Icon name="send" size={17} />
          </button>
        </div>
      </section>

      {templates.length === 0 && (
        <p className="memo-hint">
          还没有模板？<Link to="/templates">去创建或导入一个</Link>（不用模板也可以直接记录）
        </p>
      )}

      <div className="list-meta">
        <span className="muted small">
          {templateLabel} · 共 {formatCount(total)} 条
          {hasActiveFilters(filters) ? '（已筛选）' : ''}
        </span>
        {listLoading && <span className="muted small">加载中…</span>}
        {hasActiveFilters(filters) && (
          <button type="button" className="link-btn small" onClick={clearFilters}>
            清除筛选
          </button>
        )}
      </div>

      {listError !== '' && (
        <div className="mt-12">
          <ErrorBox message={listError} onRetry={() => void loadMemos('reset')} />
        </div>
      )}

      {listLoading ? (
        <div className="memo-list">
          <SkeletonList rows={3} />
        </div>
      ) : items.length === 0 && listError === '' ? (
        <div className="card mt-12">
          <EmptyState
            icon="🗒️"
            title={hasActiveFilters(filters) ? '没有符合条件的记录' : '还没有任何记录'}
            hint={hasActiveFilters(filters) ? '试试清除筛选条件' : '在上面写下第一条想法吧'}
          />
        </div>
      ) : (
        <>
          <div className="memo-list">
            {items.map((memo) => (
              <MemoCard
                key={memo.id}
                memo={memo}
                template={templates.find((template) => template.id === memo.templateId)}
                onEdit={setEditing}
                onDelete={(target) => void onDelete(target)}
                onTagClick={(tag) => patchFilters({ tag })}
                onTemplateClick={(templateId) => patchFilters({ templateId })}
              />
            ))}
          </div>
          {cursorRef.current !== null && (
            <div className="center mt-16">
              <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMemos('more')}>
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}

      {editing !== null && (
        <MemoEditModal
          memo={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            cursorRef.current = null;
            void loadMemos('reset');
            void overview.reload();
          }}
        />
      )}
    </div>
  );
}

/** 提交按钮禁用时的中文原因提示 */
function trimmedHint(
  content: string,
  hasTemplate: boolean,
  mode: ComposerMode,
  text: string,
  draft: Record<string, FieldValue>,
): JSX.Element | null {
  if (content.trim() !== '') return null;
  if (hasTemplate && mode === 'text') {
    return <span className="kbd-hint">请输入模板文本</span>;
  }
  if (hasTemplate && isDraftEmpty(draft)) return <span className="kbd-hint">请填写至少一个字段</span>;
  if (!hasTemplate) return <span className="kbd-hint">请输入内容后再记录</span>;
  return null;
}
