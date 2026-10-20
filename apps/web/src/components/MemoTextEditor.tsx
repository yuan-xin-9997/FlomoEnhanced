/**
 * 模板字段的文本模式编辑器：
 * - 每行「字段名：值」；
 * - 粘贴时把「插入后的完整文本」交给父组件立即解析；
 * - 手工输入只更新文本，由切换回模板模式 / 保存时再解析。
 */
import { useRef } from 'react';
import type { MemoTextLineError } from '@flomo/shared';

export interface MemoTextEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPasteText: (value: string) => void;
  lineErrors: readonly MemoTextLineError[];
  fieldErrors: Record<string, string>;
  /** 解析成功的提示（如「已识别 3 个字段」） */
  notice?: string;
  rows?: number;
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = '每行一个字段，例如：\n日期：2026-10-19\n金额：35.5\n备注：第一行\n第二行';

export default function MemoTextEditor({
  id,
  value,
  onChange,
  onPasteText,
  lineErrors,
  fieldErrors,
  notice = '',
  rows = 6,
  placeholder = DEFAULT_PLACEHOLDER,
}: MemoTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = event.clipboardData.getData('text');
    if (pasted === '') return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    const next = value.slice(0, start) + pasted + value.slice(end);
    onChange(next);
    onPasteText(next);
    const caret = start + pasted.length;
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node === null) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const messages = Array.from(
    new Set([
      ...lineErrors.map((error) => `第 ${error.line} 行：${error.message}`),
      ...Object.values(fieldErrors),
    ]),
  );

  return (
    <div className="memo-text-editor">
      <textarea
        id={id}
        ref={textareaRef}
        className={messages.length > 0 ? 'textarea memo-text-input input-error' : 'textarea memo-text-input'}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        aria-describedby={`${id}-hint`}
      />
      <div className="field-help" id={`${id}-hint`}>
        每行一个字段：字段名：值。粘贴会自动识别；切回模板模式或保存时会重新解析。
      </div>
      {messages.length > 0 && (
        <div className="error-box memo-text-errors mt-8" role="alert">
          <ul>
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      {notice !== '' && messages.length === 0 && <div className="notice mt-8">{notice}</div>}
    </div>
  );
}
