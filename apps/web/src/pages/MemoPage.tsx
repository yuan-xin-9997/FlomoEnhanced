/**
 * 记录页（/）—— 核心页面。
 * 顶部撰写区（模板选择 + 按字段类型渲染的表单）、想法列表（游标分页）、
 * 筛选（模板/标签/日期/关键字）、侧栏概览（热力图 + 连续记录）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldValue, Memo, MemoSummary, Template } from '@flomo/shared';
import { memosApi, templatesApi, errorMessage } from '../api/client';
import Heatmap from '../components/Heatmap';
import MemoCard from '../components/MemoCard';
import MemoEditModal from '../components/MemoEditModal';
import FieldForm from '../components/FieldForm';
import { EmptyState, ErrorBox, Kpi, Loading, SkeletonList } from '../components/ui';
import { emptyDraft, isDraftEmpty, normalizeDraft } from '../lib/fieldForm';
import { formatCount, formatRatio } from '../lib/format';
import {
  NO_TEMPLATE_FILTER,
  emptyFilters,
  filtersToQuery,
  hasActiveFilters,
  memoBodyOf,
} from '../lib/memoQuery';
import type { MemoFilters } from '../lib/memoQuery';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';

const PAGE_SIZE = 20;

export default function MemoPage(): JSX.Element {
  useDocumentTitle('记录');
  const session = useSession();
  const toast = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [summary, setSummary] = useState<MemoSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');

  const [composerTemplateId, setComposerTemplateId] = useState('');
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState<Record<string, FieldValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [filters, setFilters] = useState<MemoFilters>(emptyFilters);
  const [items, setItems] = useState<Memo[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [editing, setEditing] = useState<Memo | null>(null);

  const cursorRef = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const composerTemplate = useMemo(
    () => templates.find((template) => template.id === composerTemplateId),
    [templates, composerTemplateId],
  );

  /* ------------------------------ 数据加载 ------------------------------ */

  const loadTemplates = useCallback(async (): Promise<void> => {
    try {
      const response = await templatesApi.list(false);
      setTemplates(response.items);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [toast]);

  const loadSummary = useCallback(async (): Promise<void> => {
    setSummaryError('');
    try {
      setSummary(await memosApi.summary());
    } catch (error) {
      setSummaryError(errorMessage(error));
    }
  }, []);

  const loadMemos = useCallback(
    async (mode: 'reset' | 'more'): Promise<void> => {
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      if (mode === 'reset') setListLoading(true);
      else setLoadingMore(true);
      setListError('');
      try {
        const response = await memosApi.list(
          filtersToQuery(filters, { limit: PAGE_SIZE, cursor: mode === 'more' ? cursorRef.current : null }),
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
    [filters],
  );

  useEffect(() => {
    void loadTemplates();
    void loadSummary();
  }, [loadTemplates, loadSummary]);

  useEffect(() => {
    cursorRef.current = null;
    void loadMemos('reset');
  }, [loadMemos]);

  // 切换撰写区模板时重置字段草稿（保留模板选择方便连续记账）
  useEffect(() => {
    setDraft(composerTemplate === undefined ? {} : emptyDraft(composerTemplate.fields));
    setFieldErrors({});
  }, [composerTemplate]);

  /* ------------------------------ 提交 ------------------------------ */

  const canSubmit = useMemo(() => {
    const hasContent = content.trim() !== '';
    const hasValues = composerTemplate !== undefined && !isDraftEmpty(draft);
    return hasContent || hasValues;
  }, [content, composerTemplate, draft]);

  const onSubmit = async (): Promise<void> => {
    const trimmed = content.trim();
    let values: Record<string, FieldValue> = {};

    if (composerTemplate !== undefined) {
      const normalized = normalizeDraft(composerTemplate.fields, draft);
      if (!normalized.ok) {
        setFieldErrors(normalized.errors);
        setFormError('字段校验未通过，请检查后重试');
        return;
      }
      values = normalized.values;
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
      setContent('');
      setDraft(composerTemplate === undefined ? {} : emptyDraft(composerTemplate.fields));
      setFieldErrors({});
      toast.success('已记录');
      cursorRef.current = null;
      void loadMemos('reset');
      void loadSummary();
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
      void loadSummary();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!submitting) void onSubmit();
    }
  };

  const patchFilters = (patch: Partial<MemoFilters>): void => setFilters((previous) => ({ ...previous, ...patch }));

  const jumpToDay = (day: string): void => {
    patchFilters({ from: day, to: day });
    toast.push(`已筛选 ${day} 的记录`);
  };

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">记录</h1>
          <p className="page-sub">
            {session.user === null ? '随手记下想法' : `${session.user.username}，随时记录你的想法`} · 可用 <code>#标签</code>{' '}
            归类
          </p>
        </div>
        <Link to="/templates" className="btn">
          管理模板
        </Link>
      </div>

      <div className="memo-layout">
        <div>
          <section className="composer">
            <label className="sr-only" htmlFor="composer-content">
              记录内容
            </label>
            <textarea
              id="composer-content"
              ref={textareaRef}
              className="textarea composer-input"
              autoFocus
              placeholder="写点什么… 支持 #标签，Ctrl / Cmd + Enter 快速提交"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />

            <div className="composer-fields">
              <div className="field">
                <label className="label" htmlFor="composer-template">
                  模板
                </label>
                <select
                  id="composer-template"
                  className="select"
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
                {templates.length === 0 && (
                  <div className="field-help">
                    还没有模板？<Link to="/templates">去创建或导入一个</Link>（不用模板也可以直接记录）
                  </div>
                )}
              </div>

              {composerTemplate !== undefined && (
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
              )}
            </div>

            {formError !== '' && (
              <div className="error-box mt-12" role="alert">
                <span>{formError}</span>
              </div>
            )}

            <div className="composer-foot">
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || !canSubmit}
                onClick={() => void onSubmit()}
              >
                {submitting ? '保存中…' : '记录'}
              </button>
              <span className="kbd-hint">Ctrl / Cmd + Enter</span>
              <span className="spacer" />
              {!canSubmit && trimmedHint(content, composerTemplate !== undefined, draft)}
            </div>
          </section>

          <div className="card mt-16">
            <div className="card-title">
              <span>筛选</span>
              {hasActiveFilters(filters) && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilters(emptyFilters())}>
                  清除筛选
                </button>
              )}
            </div>
            <div className="filters">
              <div>
                <label className="label" htmlFor="filter-template">
                  模板
                </label>
                <select
                  id="filter-template"
                  className="select"
                  value={filters.templateId}
                  onChange={(event) => patchFilters({ templateId: event.target.value })}
                >
                  <option value="">全部模板</option>
                  <option value={NO_TEMPLATE_FILTER}>无模板</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.icon} {template.name}
                    </option>
                  ))}
                </select>
              </div>
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
              <div>
                <label className="label" htmlFor="filter-q">
                  关键字
                </label>
                <input
                  id="filter-q"
                  className="input"
                  value={filters.q}
                  placeholder="搜索内容"
                  onChange={(event) => patchFilters({ q: event.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="row-between mt-16">
            <span className="muted small">
              共 {formatCount(total)} 条{hasActiveFilters(filters) ? '（已筛选）' : ''}
            </span>
            {listLoading && <span className="muted small">加载中…</span>}
          </div>

          {listError !== '' && <div className="mt-12"><ErrorBox message={listError} onRetry={() => void loadMemos('reset')} /></div>}

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
        </div>

        <aside>
          <div className="card">
            <div className="card-title">
              <span>概览</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadSummary()}>
                刷新
              </button>
            </div>
            {summaryError !== '' && <ErrorBox message={summaryError} onRetry={() => void loadSummary()} />}
            {summary === null && summaryError === '' && <Loading />}
            {summary !== null && (
              <>
                <div className="kpi-grid mb-16">
                  <Kpi label="总想法数" value={formatCount(summary.total)} />
                  <Kpi label="活跃天数" value={formatCount(summary.activeDays)} />
                  <Kpi
                    label="当前连续"
                    value={`${formatCount(summary.currentStreak)} 天`}
                    sub={`最长 ${formatCount(summary.longestStreak)} 天`}
                  />
                  <Kpi label="最近记录" value={summary.lastMemoAt === null ? '—' : summary.lastMemoAt.slice(0, 10)} />
                </div>

                <Heatmap days={summary.heatmap} weeks={12} onSelectDay={jumpToDay} />

                {summary.byTemplate.length > 0 && (
                  <div className="mt-16">
                    <div className="label">按模板分布</div>
                    <div className="stack-sm">
                      {summary.byTemplate.map((row) => (
                        <div className="row-between" key={row.templateId ?? 'none'}>
                          <span className="truncate">{row.templateName}</span>
                          <span className="muted small">
                            {formatCount(row.count)} 条
                            {summary.total > 0 ? ` · ${formatRatio(row.count / summary.total)}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summary.firstMemoAt !== null && (
                  <p className="muted small mt-16">第一条记录于 {summary.firstMemoAt.slice(0, 10)}</p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {editing !== null && (
        <MemoEditModal
          memo={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            cursorRef.current = null;
            void loadMemos('reset');
            void loadSummary();
          }}
        />
      )}
    </div>
  );
}

/** 提交按钮禁用时的中文原因提示 */
function trimmedHint(content: string, hasTemplate: boolean, draft: Record<string, FieldValue>): JSX.Element | null {
  if (content.trim() !== '') return null;
  if (hasTemplate && isDraftEmpty(draft)) return <span className="kbd-hint">请输入内容或填写至少一个字段</span>;
  if (!hasTemplate) return <span className="kbd-hint">请输入内容后再记录</span>;
  return null;
}
