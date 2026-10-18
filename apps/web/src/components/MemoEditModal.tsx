/**
 * 想法编辑弹层：可改内容、字段值，并可切换/取消模板。
 * 契约要求（SPEC §8.3）：`templateId` 变更时必须同时给出 `values`，故保存时两者都提交。
 */
import { useMemo, useState } from 'react';
import type { FieldValue, Memo, Template } from '@flomo/shared';
import { errorMessage } from '../api/client';
import { memosApi } from '../api/client';
import { draftFromValues, emptyDraft, isDraftEmpty, normalizeDraft } from '../lib/fieldForm';
import { memoBodyOf } from '../lib/memoQuery';
import { useToast } from '../state/toast';
import FieldForm from './FieldForm';
import { Modal } from './ui';

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
  const [content, setContent] = useState(memo.content);
  const [templateId, setTemplateId] = useState(initialId);
  const [draft, setDraft] = useState<Record<string, FieldValue>>(() => {
    const template = choices.find((item) => item.id === initialId);
    return template?.fields !== null && template?.fields !== undefined
      ? draftFromValues(template.fields, memo.values)
      : {};
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = choices.find((item) => item.id === templateId);

  const onTemplateChange = (nextId: string): void => {
    setTemplateId(nextId);
    setErrors({});
    const template = choices.find((item) => item.id === nextId);
    if (template?.fields === null || template?.fields === undefined) {
      setDraft({});
      return;
    }
    // 切换模板时清空为新模板的空草稿（契约要求新模板的 values 必须给出）
    setDraft(emptyDraft(template.fields));
  };

  const onSave = async (): Promise<void> => {
    const trimmed = content.trim();
    let values: Record<string, FieldValue> = {};
    const fields = selected?.fields ?? null;

    if (fields !== null) {
      const normalized = normalizeDraft(fields, draft);
      if (!normalized.ok) {
        setErrors(normalized.errors);
        setFormError('请检查字段填写');
        return;
      }
      values = normalized.values;
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

      {selected?.fields !== null && selected?.fields !== undefined && (
        <FieldForm
          fields={selected.fields}
          values={draft}
          errors={errors}
          idPrefix="memo-edit"
          onChange={(key, value) => setDraft((previous) => ({ ...previous, [key]: value }))}
        />
      )}
    </Modal>
  );
}
