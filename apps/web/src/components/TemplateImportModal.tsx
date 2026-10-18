/**
 * 模板导入弹层：选择本地 `.json` → 浏览器端预校验（parseTemplateFile）→
 * 选择冲突模式 → POST /api/templates/import → 展示结果明细。
 */
import { useRef, useState } from 'react';
import type { TemplateImportMode } from '@flomo/shared';
import { errorMessage, templatesApi } from '../api/client';
import { IMPORT_MODE_LABELS, previewTemplateFile, summarizeImportResult } from '../lib/templateImport';
import type { ImportPreview, ImportSummary } from '../lib/templateImport';
import { useToast } from '../state/toast';
import { Modal } from './ui';

export interface TemplateImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

export default function TemplateImportModal({ onClose, onImported }: TemplateImportModalProps): JSX.Element {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [mode, setMode] = useState<TemplateImportMode>('rename');
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const onPickFile = async (file: File | undefined): Promise<void> => {
    setSummary(null);
    setSubmitError('');
    setPreview(null);
    setPreviewError('');
    if (file === undefined) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPreviewError('无法读取该文件，请重新选择');
      return;
    }
    const result = previewTemplateFile(text, file.name);
    if (!result.ok) {
      setPreviewError(result.message);
      return;
    }
    setPreview(result.preview);
  };

  const onImport = async (): Promise<void> => {
    if (preview === null) return;
    setImporting(true);
    setSubmitError('');
    try {
      const result = await templatesApi.import(preview.file, mode);
      const next = summarizeImportResult(result);
      setSummary(next);
      onImported();
      if (next.failed === 0) toast.success(`导入完成：新增 ${next.imported} 个模板`);
      else toast.push(`导入完成，但有 ${next.failed} 个模板失败`, 'error');
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title="导入模板"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={importing}>
            关闭
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={preview === null || importing}
            onClick={() => void onImport()}
          >
            {importing ? '导入中…' : '开始导入'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="import-file">
         选择 `.flomo-template.json` 文件
        </label>
        <input
          id="import-file"
          ref={inputRef}
          className="input"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void onPickFile(event.target.files?.[0])}
        />
        <div className="field-help">文件会在浏览器本地先做格式与字段定义校验，不会直接提交非法内容。</div>
      </div>

      {previewError !== '' && (
        <div className="error-box mb-16" role="alert">
          <span>{previewError}</span>
        </div>
      )}

      {preview !== null && (
        <>
          <div className="notice mb-16">
            文件来自 {preview.appName} {preview.appVersion}，导出于 {preview.exportedAt.slice(0, 19).replace('T', ' ')}，
            共 {preview.templates.length} 个模板。
          </div>

          <div className="field">
            <label className="label" htmlFor="import-mode">
              同名冲突处理
            </label>
            <select
              id="import-mode"
              className="select"
              value={mode}
              onChange={(event) => setMode(event.target.value as TemplateImportMode)}
            >
              {(Object.keys(IMPORT_MODE_LABELS) as TemplateImportMode[]).map((key) => (
                <option key={key} value={key}>
                  {IMPORT_MODE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="import-result mb-16">
            <strong>将导入：</strong>
            <ul>
              {preview.templates.map((entry, index) => (
                <li key={index}>
                  {entry.icon} {entry.name}
                  {entry.description !== '' && <span className="muted"> · {entry.description}</span>}
                  <span className="muted">
                    {' '}
                    · {entry.fieldCount} 个字段（{entry.typeSummary}）
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {submitError !== '' && (
        <div className="error-box mb-16" role="alert">
          <span>{submitError}</span>
        </div>
      )}

      {summary !== null && (
        <div className="import-result" aria-live="polite">
          <strong>导入结果</strong>
          <ul>
            <li>新增 {summary.imported} 个{summary.importedNames.length > 0 && `：${summary.importedNames.join('、')}`}</li>
            <li>
              覆盖 {summary.overwritten} 个
              {summary.overwrittenNames.length > 0 && `：${summary.overwrittenNames.join('、')}`}
            </li>
            <li>跳过 {summary.skipped} 个{summary.skippedDetail.length > 0 && `：${summary.skippedDetail.map((item) => `${item.name}（${item.reason}）`).join('、')}`}</li>
            <li>失败 {summary.failed} 个</li>
          </ul>
          {summary.errors.length > 0 && (
            <ul>
              {summary.errors.map((item, index) => (
                <li key={index}>
                  第 {item.index + 1} 个「{item.name}」：{item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
