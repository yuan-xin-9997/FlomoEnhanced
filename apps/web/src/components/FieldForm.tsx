/**
 * 按字段类型渲染的填写表单（记录页、编辑弹层、模板预览共用）。
 * 取值归一化交由 `@flomo/shared` 的 `normalizeFieldValue`，本组件只做展示与用户交互。
 */
import { effectiveScale } from '@flomo/shared';
import type { FieldDefinition, FieldValue } from '@flomo/shared';
import {
  controlKindOf,
  controlTextOf,
  currencySymbol,
  inputStepOf,
  localInputToIso,
  numericUnitOf,
} from '../lib/fieldForm';

export interface FieldFormProps {
  fields: readonly FieldDefinition[];
  values: Record<string, FieldValue>;
  onChange: (key: string, value: FieldValue) => void;
  errors?: Record<string, string>;
  idPrefix: string;
}

/** 渲染单个字段控件 */
function FieldControl({
  def,
  value,
  onChange,
  id,
  invalid,
}: {
  def: FieldDefinition;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  id: string;
  invalid: boolean;
}): JSX.Element {
  const kind = controlKindOf(def.type);
  const text = controlTextOf(def, value);
  const className = invalid ? 'input input-error' : 'input';

  switch (kind) {
    case 'textarea':
      return (
        <textarea
          id={id}
          className={invalid ? 'textarea input-error' : 'textarea'}
          value={text}
          placeholder={def.placeholder ?? ''}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
        />
      );

    case 'number': {
      const unit = numericUnitOf(def);
      return (
        <div className="inline-field">
          {unit.prefix !== '' && <span className="suffix">{unit.prefix}</span>}
          <input
            id={id}
            className={className}
            type="number"
            inputMode="decimal"
            value={text}
            placeholder={def.placeholder ?? ''}
            min={def.min}
            max={def.max}
            step={inputStepOf(def)}
            onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          />
          {unit.suffix !== '' && <span className="suffix">{unit.suffix}</span>}
        </div>
      );
    }

    case 'date':
      return (
        <input
          id={id}
          className={className}
          type="date"
          value={text}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
      );

    case 'datetime-local':
      return (
        <input
          id={id}
          className={className}
          type="datetime-local"
          value={text}
          onChange={(event) => onChange(event.target.value === '' ? null : localInputToIso(event.target.value))}
        />
      );

    case 'select': {
      const options = def.options ?? [];
      return (
        <select
          id={id}
          className={className}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">— 请选择 —</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    case 'multiselect': {
      const options = def.options ?? [];
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="multiselect" id={id} role="group" aria-label={def.label}>
          {options.map((option) => {
            const active = picked.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={active ? 'chip active' : 'chip'}
                aria-pressed={active}
                style={
                  option.color !== undefined && option.color !== '' && !active
                    ? { borderColor: option.color, color: option.color }
                    : undefined
                }
                onClick={() =>
                  onChange(active ? picked.filter((item) => item !== option.value) : [...picked, option.value])
                }
              >
                {option.label}
              </button>
            );
          })}
          {options.length === 0 && <span className="muted small">该字段尚未配置选项</span>}
        </div>
      );
    }

    case 'switch':
      return (
        <label className="switch" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-text">{value === true ? '是' : '否'}</span>
        </label>
      );

    case 'rating': {
      const scale = effectiveScale(def);
      const current = typeof value === 'number' ? value : null;
      return (
        <div className="stars" id={id} role="radiogroup" aria-label={def.label}>
          {Array.from({ length: scale }, (_, index) => index + 1).map((score) => (
            <button
              key={score}
              type="button"
              className={current !== null && score <= current ? 'star on' : 'star'}
              aria-label={`${score} 分`}
              aria-checked={current === score}
              role="radio"
              onClick={() => onChange(current === score ? null : score)}
            >
              {current !== null && score <= current ? '★' : '☆'}
            </button>
          ))}
          <span className="suffix">{current === null ? `未评分（满分 ${scale}）` : `${current} / ${scale}`}</span>
        </div>
      );
    }

    case 'url':
      return (
        <input
          id={id}
          className={className}
          type="url"
          inputMode="url"
          value={text}
          placeholder={def.placeholder ?? 'https://'}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <input
          id={id}
          className={className}
          type="text"
          value={text}
          placeholder={def.placeholder ?? ''}
          maxLength={def.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

export default function FieldForm({ fields, values, onChange, errors, idPrefix }: FieldFormProps): JSX.Element {
  if (fields.length === 0) {
    return <div className="muted small">该模板尚未定义字段。</div>;
  }

  return (
    <div>
      {fields.map((def) => {
        const id = `${idPrefix}-${def.key}`;
        const error = errors?.[def.key];
        return (
          <div className="field" key={def.key}>
            <label className="label" htmlFor={id}>
              {def.label}
              {def.required === true && <span className="req">*</span>}
              {def.type === 'currency' && <span className="muted small">（{currencySymbol(def.currency ?? 'CNY')}）</span>}
            </label>
            <FieldControl
              def={def}
              value={values[def.key]}
              id={id}
              invalid={error !== undefined}
              onChange={(next) => onChange(def.key, next)}
            />
            {def.help !== undefined && def.help !== '' && <div className="field-help">{def.help}</div>}
            {error !== undefined && <div className="field-error">{error}</div>}
          </div>
        );
      })}
    </div>
  );
}
