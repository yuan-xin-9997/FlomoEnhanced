import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Template } from '@flomo/shared';
import TemplateEditor from './TemplateEditor';
import { ToastProvider } from '../state/toast';

afterEach(cleanup);

function renderEditor(template: Template | null = null): HTMLElement {
  const { container } = render(
    <ToastProvider>
      <TemplateEditor template={template} onClose={() => undefined} onSaved={() => undefined} />
    </ToastProvider>,
  );
  return container;
}

function displayNameInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.field-editor-grid input.input:not(.mono)');
  if (input === null) throw new Error('找不到显示名输入框');
  return input;
}

function keyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.field-editor-grid input.mono');
  if (input === null) throw new Error('找不到机器名输入框');
  return input;
}

function fieldTypeSelect(container: HTMLElement): HTMLSelectElement {
  const selects = container.querySelectorAll<HTMLSelectElement>('select');
  const select = selects[1];
  if (select === undefined) throw new Error('找不到字段类型下拉框');
  return select;
}

describe('TemplateEditor 新建模板', () => {
  it('清空显示名后继续输入不会因 key 重算而失焦', () => {
    const container = renderEditor();
    const input = displayNameInput(container);

    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '金' } });

    expect(input.value).toBe('金');
    expect(document.activeElement).toBe(input);
    expect(keyInput(container).value).not.toBe('text');
  });

  it('切换字段类型时显示名与机器名 key 一起跟随变化', () => {
    const container = renderEditor();
    expect(displayNameInput(container).value).toBe('单行文本');
    expect(keyInput(container).value).toBe('text');

    fireEvent.change(fieldTypeSelect(container), { target: { value: 'number' } });

    expect(displayNameInput(container).value).toBe('数字');
    expect(keyInput(container).value).toBe('number');
  });
});
