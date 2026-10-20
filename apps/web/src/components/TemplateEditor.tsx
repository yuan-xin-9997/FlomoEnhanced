/**
 * 模板编辑器（核心）：模板信息 + 字段列表（新增/删除/上下移/拖拽排序/复制）
 * + 按类型显示的专属配置 + 实时预览。
 */
import { useMemo, useRef, useState } from 'react';
import { FIELD_TYPES, FIELD_TYPE_META, formatFieldValue } from '@flomo/shared';
import type { FieldDefinition, FieldType, FieldValue, Template } from '@flomo/shared';
import { errorMessage, templatesApi } from '../api/client';
import {
  addOption,
  blankField,
  changeFieldType,
  draftFromTemplate,
  draftToBody,
  duplicateFieldAt,
  moveField,
  patchField,
  patchOption,
  removeFieldAt,
  removeOption,
  shiftField,
  syncKeyOnLabelChange,
  validateTemplateDraft,
  blankTemplateDraft,
} from '../lib/templateDraft';
import type { TemplateDraft } from '../lib/templateDraft';
import { useToast } from '../state/toast';
import FieldForm from './FieldForm';
import { Modal } from './ui';

const ICON_CHOICES = ['📝', '💰', '🏃', '📚', '🍜', '💊', '🎯', '🧠', '🛒', '✈️', '🎬', '🧾'];

export interface TemplateEditorProps {
  /** null 表示新建 */
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}

function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export default function TemplateEditor({ template, onClose, onSaved }: TemplateEditorProps): JSX.Element {
  const toast = useToast();
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    template === null ? blankTemplateDraft() : draftFromTemplate(template),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [previewValues, setPreviewValues] = useState<Record<string, FieldValue>>({});
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const dragIndex = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // 编辑既有模板时，已存在字段的 key 视为不可变；只有本次新增的字段才随显示名自动重算 key。
  const initialKeysRef = useRef<Set<string>>(new Set((template?.fields ?? []).map((field) => field.key)));

  const fieldCount = draft.fields.length;
  const patchDraft = (patch: Partial<TemplateDraft>): void => setDraft((previous) => ({ ...previous, ...patch }));
  const setFields = (fields: FieldDefinition[]): void => setDraft((previous) => ({ ...previous, fields }));

  const previewSummary = useMemo(
    () =>
      draft.fields.map((def) => ({
        key: def.key,
        label: def.label,
        text: formatFieldValue(def, previewValues[def.key]),
      })),
    [draft.fields, previewValues],
  );

  const onSave = async (): Promise<void> => {
    const validationErrors = validateTemplateDraft(draft);
    setErrors(validationErrors);
    if (validationErrors.length > 0) {
      setSubmitError('模板校验未通过，请修正下面列出的问题');
      return;
    }
    setSubmitError('');
    setSaving(true);
    try {
      if (template === null) {
        await templatesApi.create(draftToBody(draft));
        toast.success('模板已创建');
      } else {
        await templatesApi.update(template.id, draftToBody(draft));
        toast.success('模板已保存');
      }
      onSaved();
      onClose();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={template === null ? '新建模板' : `编辑模板：${template.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? '保存中…' : template === null ? '创建模板' : '保存修改'}
          </button>
        </>
      }
    >
      {submitError !== '' && (
        <div className="error-box mb-16" role="alert">
          <span>{submitError}</span>
        </div>
      )}
      {errors.length > 0 && (
        <ul className="import-result mb-16" aria-live="polite">
          {errors.slice(0, 12).map((message, index) => (
            <li key={index}>{message}</li>
          ))}
          {errors.length > 12 && <li>…还有 {errors.length - 12} 条问题</li>}
        </ul>
      )}

      <div className="split">
        <div>
          {/* ---------------- 模板信息 ---------------- */}
          <div className="card mb-16">
            <div className="card-title">基础信息</div>
            <div className="field">
              <label className="label" htmlFor="tpl-name">
                名称<span className="req">*</span>
              </label>
              <input
                id="tpl-name"
                className="input"
                value={draft.name}
                maxLength={40}
                placeholder="如：每日开销"
                onChange={(event) => patchDraft({ name: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="tpl-desc">
                描述
              </label>
              <input
                id="tpl-desc"
                className="input"
                value={draft.description}
                maxLength={200}
                placeholder="这个模板用来记录什么？"
                onChange={(event) => patchDraft({ description: event.target.value })}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="tpl-icon">
                  图标
                </label>
                <input
                  id="tpl-icon"
                  className="input"
                  value={draft.icon}
                  maxLength={8}
                  placeholder="emoji"
                  onChange={(event) => patchDraft({ icon: event.target.value })}
                />
                <div className="chips mt-8">
                  {ICON_CHOICES.map((icon) => (
                    <button key={icon} type="button" className="chip" onClick={() => patchDraft({ icon })}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="tpl-color">
                  颜色
                </label>
                <div className="inline-field">
                  <input
                    id="tpl-color"
                    className="swatch"
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#30cf79'}
                    onChange={(event) => patchDraft({ color: event.target.value })}
                  />
                  <input
                    className="input"
                    value={draft.color}
                    placeholder="#30cf79"
                    onChange={(event) => patchDraft({ color: event.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- 字段列表 ---------------- */}
          <div className="card">
            <div className="card-title">
              <span>
                字段 <small>共 {fieldCount} 个</small>
              </span>
              <span className="row">
                <select
                  className="select"
                  style={{ width: 130 }}
                  value={newFieldType}
                  onChange={(event) => setNewFieldType(event.target.value as FieldType)}
                  aria-label="新增字段类型"
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {FIELD_TYPE_META[type].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setFields([...draft.fields, blankField(draft.fields, newFieldType)])}
                >
                  添加字段
                </button>
              </span>
            </div>

            <div className="field-editor-list">
              {draft.fields.map((def, index) => (
                <div
                  // 用位置作为 React key：key 会随显示名/类型自动重算，
                  // 若把 def.key 放进 key，输入时会整卡重建导致输入框失焦（无法连续输入）。
                  key={index}
                  className={`field-editor${dropIndex === index ? ' drop-target' : ''}`}
                  draggable
                  onDragStart={() => {
                    dragIndex.current = index;
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropIndex(index);
                  }}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDropIndex(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = dragIndex.current;
                    if (from !== null && from !== index) setFields(moveField(draft.fields, from, index));
                    dragIndex.current = null;
                    setDropIndex(null);
                  }}
                >
                  <div className="field-editor-head">
                    <span className="drag-handle" title="拖动排序" aria-hidden="true">
                      ⠿
                    </span>
                    <span className="badge">#{index + 1}</span>
                    <strong className="truncate">{def.label === '' ? '未命名字段' : def.label}</strong>
                    <span className="badge badge-accent">{FIELD_TYPE_META[def.type].label}</span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="上移"
                      disabled={index === 0}
                      onClick={() => setFields(shiftField(draft.fields, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="下移"
                      disabled={index === fieldCount - 1}
                      onClick={() => setFields(shiftField(draft.fields, index, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="复制字段"
                      onClick={() => setFields(duplicateFieldAt(draft.fields, index))}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      title="删除字段"
                      onClick={() => setFields(removeFieldAt(draft.fields, index))}
                    >
                      删除
                    </button>
                  </div>

                  <div className="field-editor-grid">
                    <div>
                      <label className="label">显示名</label>
                      <input
                        className="input"
                        value={def.label}
                        maxLength={40}
                        onChange={(event) =>
                          setFields(
                            syncKeyOnLabelChange(draft.fields, index, event.target.value, {
                              allowSync: !initialKeysRef.current.has(def.key),
                            }),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="label">机器名 key</label>
                      <input
                        className="input mono"
                        value={def.key}
                        onChange={(event) => setFields(patchField(draft.fields, index, { key: event.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="label">类型</label>
                      <select
                        className="select"
                        value={def.type}
                        onChange={(event) =>
                          setFields(
                            patchField(
                              draft.fields,
                              index,
                              changeFieldType(def, event.target.value as FieldType, {
                                otherKeys: draft.fields
                                  .filter((_, position) => position !== index)
                                  .map((item) => item.key),
                                allowSync: !initialKeysRef.current.has(def.key),
                              }),
                            ),
                          )
                        }
                      >
                        {FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {FIELD_TYPE_META[type].label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="label">占位符</label>
                      <input
                        className="input"
                        value={def.placeholder ?? ''}
                        maxLength={60}
                        onChange={(event) =>
                          setFields(patchField(draft.fields, index, { placeholder: event.target.value }))
                        }
                      />
                    </div>
                    <div className="span-all">
                      <label className="label">帮助文本</label>
                      <input
                        className="input"
                        value={def.help ?? ''}
                        maxLength={120}
                        onChange={(event) => setFields(patchField(draft.fields, index, { help: event.target.value }))}
                      />
                    </div>

                    {/* 数值型专属配置 */}
                    {FIELD_TYPE_META[def.type].numeric && (
                      <>
                        <div>
                          <label className="label">最小值</label>
                          <input
                            className="input"
                            type="number"
                            value={def.min ?? ''}
                            onChange={(event) =>
                              setFields(patchField(draft.fields, index, { min: numberOrUndefined(event.target.value) }))
                            }
                          />
                        </div>
                        <div>
                          <label className="label">最大值</label>
                          <input
                            className="input"
                            type="number"
                            value={def.max ?? ''}
                            onChange={(event) =>
                              setFields(patchField(draft.fields, index, { max: numberOrUndefined(event.target.value) }))
                            }
                          />
                        </div>
                        {def.type !== 'rating' && (
                          <div>
                            <label className="label">步长 step</label>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              value={def.step ?? ''}
                              onChange={(event) =>
                                setFields(
                                  patchField(draft.fields, index, { step: numberOrUndefined(event.target.value) }),
                                )
                              }
                            />
                          </div>
                        )}
                        {def.type === 'rating' ? (
                          <div>
                            <label className="label">满分 scale（1-10）</label>
                            <input
                              className="input"
                              type="number"
                              min={1}
                              max={10}
                              value={def.scale ?? 5}
                              onChange={(event) =>
                                setFields(patchField(draft.fields, index, { scale: numberOrUndefined(event.target.value) }))
                              }
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="label">小数位 precision（0-6）</label>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={6}
                              value={def.precision ?? FIELD_TYPE_META[def.type].precision}
                              onChange={(event) =>
                                setFields(
                                  patchField(draft.fields, index, { precision: numberOrUndefined(event.target.value) }),
                                )
                              }
                            />
                          </div>
                        )}
                        {def.type === 'currency' && (
                          <div>
                            <label className="label">币种（ISO-4217）</label>
                            <input
                              className="input"
                              value={def.currency ?? 'CNY'}
                              maxLength={3}
                              onChange={(event) =>
                                setFields(
                                  patchField(draft.fields, index, { currency: event.target.value.toUpperCase() }),
                                )
                              }
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* 文本型专属配置 */}
                    {FIELD_TYPE_META[def.type].maxLength !== undefined && (
                      <div>
                        <label className="label">最大长度 maxLength</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={def.maxLength ?? FIELD_TYPE_META[def.type].maxLength ?? ''}
                          onChange={(event) =>
                            setFields(patchField(draft.fields, index, { maxLength: numberOrUndefined(event.target.value) }))
                          }
                        />
                      </div>
                    )}

                    {/* 选择型选项编辑 */}
                    {FIELD_TYPE_META[def.type].requiresOptions && (
                      <div className="span-all">
                        <div className="row-between mb-8">
                          <span className="label mt-0">选项（value / 显示名 / 颜色）</span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setFields(addOption(draft.fields, index))}
                          >
                            添加选项
                          </button>
                        </div>
                        <div className="stack-sm">
                          {(def.options ?? []).map((option, optionIndex) => (
                            <div className="option-row" key={`${optionIndex}-${option.value}`}>
                              <input
                                className="input mono"
                                value={option.value}
                                placeholder="value"
                                onChange={(event) =>
                                  setFields(patchOption(draft.fields, index, optionIndex, { value: event.target.value }))
                                }
                              />
                              <input
                                className="input"
                                value={option.label}
                                placeholder="显示名"
                                onChange={(event) =>
                                  setFields(patchOption(draft.fields, index, optionIndex, { label: event.target.value }))
                                }
                              />
                              <input
                                className="swatch"
                                type="color"
                                title="选项颜色"
                                value={
                                  option.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(option.color)
                                    ? option.color
                                    : '#e0e0e0'
                                }
                                onChange={(event) =>
                                  setFields(patchOption(draft.fields, index, optionIndex, { color: event.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => setFields(removeOption(draft.fields, index, optionIndex))}
                              >
                                删除
                              </button>
                            </div>
                          ))}
                          {(def.options ?? []).length === 0 && (
                            <span className="muted small">至少需要 1 个选项，否则模板无法保存。</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="span-all">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={def.required === true}
                          onChange={(event) =>
                            setFields(patchField(draft.fields, index, { required: event.target.checked }))
                          }
                        />
                        必填字段
                      </label>
                    </div>

                    <div className="span-all">
                      <label className="label">默认值（用同类型控件填写）</label>
                      <FieldForm
                        fields={[{ ...def, required: false, help: undefined, defaultValue: undefined }]}
                        values={{ [def.key]: def.defaultValue ?? null }}
                        idPrefix={`default-${index}`}
                        onChange={(_key, value) =>
                          setFields(patchField(draft.fields, index, { defaultValue: value }))
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
              {fieldCount === 0 && <div className="muted small">还没有字段，先从上面的下拉里添加一个。</div>}
            </div>
          </div>
        </div>

        {/* ---------------- 实时预览 ---------------- */}
        <div className="preview-pane">
          <div className="card-title">
            <span>实时预览</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreviewValues({})}>
              清空
            </button>
          </div>
          <div className="small muted mb-8">
            {draft.icon} {draft.name === '' ? '（未命名模板）' : draft.name}
            {draft.description !== '' && ` · ${draft.description}`}
          </div>
          <FieldForm
            fields={draft.fields}
            values={previewValues}
            idPrefix="preview"
            onChange={(key, value) => setPreviewValues((previous) => ({ ...previous, [key]: value }))}
          />
          {previewSummary.some((row) => row.text !== '') && (
            <div className="mt-16">
              <div className="label">按 shared 的 formatFieldValue 展示</div>
              <div className="stack-sm">
                {previewSummary.map((row) => (
                  <div className="row-between" key={row.key}>
                    <span className="muted small truncate">{row.label}</span>
                    <span className="small truncate">{row.text === '' ? '—' : row.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
