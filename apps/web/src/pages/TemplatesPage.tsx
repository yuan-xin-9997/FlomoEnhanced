/**
 * 模板页（/templates）：卡片列表 + 归档/恢复 + 复制 + 硬删除 + 导入导出 + 编辑器入口。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Template } from '@flomo/shared';
import { errorMessage, templatesApi } from '../api/client';
import TemplateEditor from '../components/TemplateEditor';
import TemplateImportModal from '../components/TemplateImportModal';
import { EmptyState, ErrorBox, Loading, Segmented } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { templateExportFallbackName } from '../lib/memoQuery';
import { todayKey } from '../lib/dates';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useToast } from '../state/toast';

type FilterMode = 'active' | 'all';

export default function TemplatesPage(): JSX.Element {
  useDocumentTitle('模板');
  const toast = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [mode, setMode] = useState<FilterMode>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ open: boolean; template: Template | null }>({ open: false, template: null });
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const includeArchived = mode === 'all';

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const response = await templatesApi.list(includeArchived);
      setTemplates(response.items);
      setSelected((previous) => previous.filter((id) => response.items.some((item) => item.id === id)));
    } catch (loadError) {
      setError(errorMessage(loadError));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(() => templates.filter((item) => item.archivedAt === null).length, [templates]);

  const toggleSelected = (id: string): void =>
    setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

  const onDuplicate = async (template: Template): Promise<void> => {
    setBusyId(template.id);
    try {
      const copy = await templatesApi.duplicate(template.id);
      toast.success(`已复制为「${copy.name}」`);
      await load();
    } catch (duplicateError) {
      toast.error(errorMessage(duplicateError));
    } finally {
      setBusyId(null);
    }
  };

  const onArchiveToggle = async (template: Template): Promise<void> => {
    setBusyId(template.id);
    try {
      if (template.archivedAt === null) {
        await templatesApi.remove(template.id, false);
        toast.success(`已归档「${template.name}」`);
      } else {
        await templatesApi.restore(template.id);
        toast.success(`已恢复「${template.name}」`);
      }
      await load();
    } catch (archiveError) {
      toast.error(errorMessage(archiveError));
    } finally {
      setBusyId(null);
    }
  };

  const onHardDelete = async (template: Template): Promise<void> => {
    const message =
      `确定要彻底删除模板「${template.name}」吗？\n\n` +
      `该模板下有 ${template.memoCount} 条记录，删除后会解除它们与模板的关联（记录本身保留，字段值仍可查看）。\n\n` +
      '此操作不可恢复。';
    if (!window.confirm(message)) return;
    setBusyId(template.id);
    try {
      await templatesApi.remove(template.id, true);
      toast.success('模板已彻底删除');
      await load();
    } catch (deleteError) {
      toast.error(errorMessage(deleteError));
    } finally {
      setBusyId(null);
    }
  };

  const onExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const ids = selected.length > 0 ? selected : undefined;
      await templatesApi.exportFile(ids);
      toast.success(selected.length > 0 ? `已导出 ${selected.length} 个模板` : '已导出全部模板');
    } catch (exportError) {
      toast.error(errorMessage(exportError));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">模板</h1>
          <p className="page-sub">
            共 {activeCount} 个可用模板
            {includeArchived ? ` · 含归档共 ${templates.length} 个` : ''} · 导出文件名形如{' '}
            <code>{templateExportFallbackName(todayKey())}</code>
          </p>
        </div>
        <div className="row">
          <Segmented
            items={[
              { key: 'active', label: '使用中' },
              { key: 'all', label: '含归档' },
            ]}
            value={mode}
            onChange={(next) => setMode(next)}
          />
          <button type="button" className="btn" onClick={() => setImportOpen(true)}>
            导入
          </button>
          <button type="button" className="btn" disabled={exporting} onClick={() => void onExport()}>
            {exporting ? '导出中…' : selected.length > 0 ? `导出选中（${selected.length}）` : '导出全部'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditor({ open: true, template: null })}>
            新建模板
          </button>
        </div>
      </div>

      {error !== '' && <ErrorBox message={error} onRetry={() => void load()} />}

      {loading ? (
        <Loading />
      ) : templates.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="🧩"
            title={includeArchived ? '还没有任何模板' : '还没有可用的模板'}
            hint="创建模板后，记录时可以按字段结构化填写，并在洞察页做统计分析。"
          />
        </div>
      ) : (
        <div className="template-grid">
          {templates.map((template) => {
            const archived = template.archivedAt !== null;
            return (
              <article key={template.id} className={archived ? 'template-card archived' : 'template-card'}>
                <div className="template-card-head">
                  <span
                    className="template-icon"
                    style={template.color === '' ? undefined : { background: `${template.color}22`, color: template.color }}
                    aria-hidden="true"
                  >
                    {template.icon === '' ? '📄' : template.icon}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="template-name">{template.name}</div>
                    <div className="template-desc">{template.description === '' ? '（无描述）' : template.description}</div>
                  </div>
                  <label className="checkbox" title="选中后可只导出这些模板">
                    <input
                      type="checkbox"
                      checked={selected.includes(template.id)}
                      onChange={() => toggleSelected(template.id)}
                      aria-label={`选择 ${template.name}`}
                    />
                  </label>
                </div>

                <div className="row small muted">
                  <span>{template.fields.length} 个字段</span>
                  <span>·</span>
                  <span>{template.memoCount} 条记录</span>
                  <span>·</span>
                  <span title={formatDateTime(template.updatedAt)}>更新于 {template.updatedAt.slice(0, 10)}</span>
                  {archived && <span className="badge">已归档</span>}
                </div>

                <div className="template-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyId === template.id}
                    onClick={() => setEditor({ open: true, template })}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyId === template.id}
                    onClick={() => void onDuplicate(template)}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyId === template.id}
                    onClick={() => void onArchiveToggle(template)}
                  >
                    {archived ? '恢复' : '归档'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busyId === template.id}
                    onClick={() => void onHardDelete(template)}
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editor.open && (
        <TemplateEditor
          template={editor.template}
          onClose={() => setEditor({ open: false, template: null })}
          onSaved={() => void load()}
        />
      )}

      {importOpen && <TemplateImportModal onClose={() => setImportOpen(false)} onImported={() => void load()} />}
    </div>
  );
}
