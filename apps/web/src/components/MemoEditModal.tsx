/**
 * 想法编辑弹层：可改内容、字段值，并可切换/取消模板。
 * 契约要求（SPEC §8.3）：`templateId` 变更时必须同时给出 `values`，故保存时两者都提交。
 * 模板字段支持「模板模式 / 文本模式」切换（与撰写区一致）。
 */
import { useMemo, useState } from 'react';
import { formatMemoText } from '@flomo/shared';
import type { FieldValue, Memo, MemoTextLineError, Template } from '@flomo/shared';
import { errorMessage } from '../api/client';
import { memosApi } from '../api/client';
import { draftFromValues, emptyDraft, isDraftEmpty, normalizeDraft } from '../lib/fieldForm';
import { parseMemoTextDraft } from '../lib/memoText';
import { memoBodyOf } from '../lib/memoQuery';
import { useToast } from '../state/toast';
import FieldForm from './FieldForm';
import MemoTextEditor from './MemoTextEditor';
import { Modal, Segmented } from './ui';

type EditMode = 'template' | 'text';

export interface MemoEditModalProps {
  memo: Memo;
  templates: readonly Template[];
  onClose: () => void;
  onSaved: () => void;
}

/** 已删除模板的占位（保留原关联，避免误清空历史数据） */
interface TemplateChoice {
  id: string;
  name: string;
  icon: string;
  fields: Template['fields'] | null;
}

export default function MemoEditModal({ memo, templates, onClose, onSaved }: MemoEditModalProps): JSX.Element {
  const toast = useToast();
  const choices = useMemo<TemplateChoice[]>(() => {
    const list: TemplateChoice[] = templates.map((template) => ({
      id: template.id,
      name: template.name,
      icon: template.icon,
      fields: template.fields,
    }));
    const currentId = memo.templateId;
    if (currentId !== null && !list.some((item) => item.id === currentId)) {
      list.push({ id: currentId, name: memo.templateName ?? '已删除的模板', icon: '🗑️', fields: null });
    }
    return list;
  }, [templates, memo.templateId, memo.templateName]);

  const initialId = memo.templateId ?? '';
  const initialTemplate = choices.find((item) => item.id === initialId);
  const initialFields = initialTemplate?.fields ?? null;
  const initialDraft = initialFields === null ? {} : draftFromValues(initialFields, memo.values);

  const [content, setContent] = useState(memo.content);
  const [templateId, setTemplateId] = useState(initialId);
  const [draft, setDraft] = useState<Record<string, FieldValue>>(initialDraft);
  const [mode, setMode] = useState<EditMode>('template');
  const [textDraft, setTextDraft] = useState(() =>
    initialFields === null ? '' : formatMemoText(initialFields, initialDraft),
  );
  const [textLineErrors, setTextLineErrors] = useState<MemoTextLineError[]>([]);
  const [textNotice, setTextNotice] = useState('');
  const [textWarning, setTextWarning] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = choices.find((item) => item.id === templateId);
  const fields = selected?.fields ?? null;
  const hasFields = fields !== null && fields.length > 0;
  const effectiveMode: EditMode = hasFields ? mode : 'template';

  /** 解析文本 → 草稿 / 错误 / 提示；返回解析结果供保存时判断 */
  const applyText = (text: string): ReturnType<typeof parseMemoTextDraft> | null => {
    if (fields === null) return null;
    const parsed = parseMemoTextDraft(fields, text);
    setDraft(parsed.draft);
    setErrors(parsed.errors);
    setTextLineErrors(parsed.lineErrors);
    setTextNotice(parsed.ok ? `已识别 ${parsed.matchedCount} 个字段` : '');
    setTextWarning('');
    setFormError('');
    return parsed;
  };

  /** 手工输入不立即解析；清掉旧提示，等切换 / 保存时再处理 */
  const onTextChange = (text: string): void => {
    setTextDraft(text);
    setTextLineErrors([]);
    setTextNotice('');
    setTextWarning('');
    setErrors({});
    setFormError('');
  };

  /** 粘贴后立即按「插入后的完整文本」解析 */
  const onTextPaste = (text: string): void => {
    setTextDraft(text);
    applyText(text);
  };

  const onModeChange = (next: EditMode): void => {
    if (next === effectiveMode) return;
    if (next === 'text') {
      if (fields !== null) setTextDraft(formatMemoText(fields, draft));
      setTextLineErrors([]);
      setTextNotice('');
      setTextWarning('');
      setErrors({});
      setFormError('');
      setMode('text');
      return;
    }

    // 文本 → 模板：重新解析当前文本，让手动修改也生效
    if (fields !== null) {
      const parsed = applyText(textDraft);
      if (parsed !== null && parsed.lineErrors.length > 0) {
        setTextWarning(`文本中有 ${parsed.lineErrors.length} 行无法识别，已忽略；当前以模板字段为准。`);
      }
    }
    setMode('template');
  };

  const onTemplateChange = (nextId: string): void => {
    setTemplateId(nextId);
    setErrors({});
    setTextLineErrors([]);
    setTextNotice('');
    setTextWarning('');
    setFormError('');
    setMode('template');
    const template = choices.find((item) => item.id === nextId);
    if (template?.fields === null || template?.fields === undefined) {
      setDraft({});
      setTextDraft('');
      return;
    }
    // 切换模板时清空为新模板的空草稿（契约要求新模板的 values 必须给出）
    const nextDraft = emptyDraft(template.fields);
    setDraft(nextDraft);
    setTextDraft(formatMemoText(template.fields, nextDraft));
  };

  const onSave = async (): Promise<void> => {
    const trimmed = content.trim();
    let values: Record<string, FieldValue> = {};

    if (fields !== null) {
      if (effectiveMode === 'text') {
        const parsed = applyText(textDraft);
        if (parsed === null || !parsed.ok) {
          setFormError('文本识别未通过，请根据提示修正后再保存');
          return;
        }
        values = parsed.values;
      } else {
        const normalized = normalizeDraft(fields, draft);
        if (!normalized.ok) {
          setErrors(normalized.errors);
          setFormError('请检查字段填写');
          return;
        }
        values = normalized.values;
      }
    } else if (selected !== undefined && selected !== null) {
      // 模板定义不可用（已硬删除）：保留原值
      values = memo.values;
    }

    if (trimmed === '' && isDraftEmpty(values)) {
      setFormError('内容与字段值不能同时为空');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await memosApi.update(
        memo.id,
        memoBodyOf({ content: trimmed, templateId: templateId === '' ? null : templateId, values }),
      );
      toast.success('已保存修改');
      onSaved();
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="编辑想法"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      {formError !== '' && (
        <div className="error-box mb-16" role="alert">
          <span>{formError}</span>
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="memo-edit-content">
          内容
        </label>
        <textarea
          id="memo-edit-content"
          className="textarea"
          value={content}
          rows={4}
          placeholder="写点什么… 可用 #标签"
          onChange={(event) => setContent(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="memo-edit-template">
          模板
        </label>
        <select
          id="memo-edit-template"
          className="select"
          value={templateId}
          onChange={(event) => onTemplateChange(event.target.value)}
        >
          <option value="">不使用模板（清空字段值）</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.icon} {item.name}
              {item.fields === null ? '（字段定义不可用）' : ''}
            </option>
          ))}
        </select>
        <div className="field-help">切换模板后需要重新填写新模板的字段值。</div>
      </div>

      {selected?.fields === null && <div className="notice notice-warn">该模板已不存在，仅可编辑内容或取消模板关联。</div>}

      {fields !== null && (
        <>
          {hasFields && (
            <div className="fields-mode-head">
              <span className="memo-mode-label">模板字段</span>
              <Segmented
                items={[
                  { key: 'template', label: '模板模式' },
                  { key: 'text', label: '文本模式' },
                ]}
                value={effectiveMode}
                onChange={(key) => onModeChange(key as EditMode)}
              />
            </div>
          )}

          {effectiveMode === 'template' ? (
            <FieldForm
              fields={fields}
              values={draft}
              errors={errors}
              idPrefix="memo-edit"
              onChange={(key, value) => {
                setDraft((previous) => ({ ...previous, [key]: value }));
                setErrors((previous) => {
                  if (previous[key] === undefined) return previous;
                  const next = { ...previous };
                  delete next[key];
                  return next;
                });
              }}
            />
          ) : (
            <MemoTextEditor
              id="memo-edit-text-fields"
              fields={fields}
              value={textDraft}
              onChange={onTextChange}
              onPasteText={onTextPaste}
              lineErrors={textLineErrors}
              fieldErrors={errors}
              notice={textNotice}
              rows={6}
            />
          )}
        </>
      )}

      {textWarning !== '' && <div className="notice notice-warn mt-12">{textWarning}</div>}
    </Modal>
  );
}
