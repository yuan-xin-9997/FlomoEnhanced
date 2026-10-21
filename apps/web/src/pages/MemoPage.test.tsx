import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MemoPage from './MemoPage';
import { memosApi } from '../api/client';

vi.mock('../api/client', () => {
  const template = {
    id: 't1',
    name: '睡眠日志',
    description: '',
    icon: '🌙',
    color: '#30cf79',
    fields: [
      { key: 'date', label: '日期', type: 'date' },
      { key: 'note', label: '睡眠情况', type: 'longtext' },
    ],
    version: 1,
    memoCount: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    archivedAt: null,
  };
  return {
    templatesApi: { list: vi.fn(async () => ({ items: [template, {
      ...template,
      id: 't2',
      name: '阅读记录',
      fields: [{ key: 'book', label: '书名', type: 'text', placeholder: '输入正在读的书' }],
    }], total: 2 })) },
    memosApi: {
      list: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      create: vi.fn(),
    },
    errorMessage: (error: unknown) => String(error),
  };
});

vi.mock('../state/overview', () => {
  const overview = { reload: vi.fn(async () => undefined) };
  return { useOverview: () => overview };
});

vi.mock('../state/toast', () => {
  const toast = { push: vi.fn(), success: vi.fn(), error: vi.fn() };
  return { useToast: () => toast };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MemoPage 撰写区', () => {
  it.each([
    ['未知字段：保留这段原文\n日期：2026-10-21', '2026-10-21'],
    ['日期：这不是日期', ''],
    ['完全无法识别的内容', ''],
  ])('保留识别失败的文本并在两种模式下阻止保存：%s', async (original, date) => {
    const { container } = render(<MemoryRouter><MemoPage /></MemoryRouter>);
    const templateSelect = await screen.findByLabelText('模板', { selector: 'select' });
    fireEvent.change(templateSelect, { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
    fireEvent.change(container.querySelector('#composer-text-fields')!, { target: { value: original } });

    for (let round = 0; round < 2; round += 1) {
      fireEvent.click(screen.getByRole('tab', { name: '模板模式' }));
      const dateInput = container.querySelector<HTMLInputElement>('#composer-date')!;
      expect(dateInput.value).toBe(date);
      expect(dateInput.matches(':disabled')).toBe(true);
      const save = screen.getByRole('button', { name: '记录' });
      expect((save as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(save);
      expect(screen.getByRole('alert').textContent).toContain('请切回文本模式修正后再保存');
      expect(memosApi.create).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
      expect(container.querySelector<HTMLTextAreaElement>('#composer-text-fields')!.value).toBe(original);
      fireEvent.click(screen.getByRole('button', { name: '记录' }));
      expect(screen.getByText('文本识别未通过，请根据提示修正后再保存')).toBeTruthy();
      expect(memosApi.create).not.toHaveBeenCalled();
    }

    fireEvent.change(container.querySelector('#composer-text-fields')!, {
      target: { value: '日期：2026-10-21\n睡眠情况：已修正' },
    });
    fireEvent.click(screen.getByRole('tab', { name: '模板模式' }));
    const note = screen.getByLabelText('睡眠情况');
    expect(note.matches(':disabled')).toBe(false);
    fireEvent.change(note, { target: { value: '模板模式修改' } });
    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
    expect(container.querySelector<HTMLTextAreaElement>('#composer-text-fields')!.value)
      .toContain('睡眠情况：模板模式修改');
    fireEvent.click(screen.getByRole('button', { name: '记录' }));
    await waitFor(() => expect(memosApi.create).toHaveBeenCalledTimes(1));
    expect(memosApi.create).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 't1', values: { date: '2026-10-21', note: '模板模式修改' },
    }));
  });

  it('选择模板后隐藏自由内容框，模板模式与文本模式共用同一个输入区', async () => {
    const { container } = render(
      <MemoryRouter>
        <MemoPage />
      </MemoryRouter>,
    );

    const templateSelect = await screen.findByLabelText('模板', { selector: 'select' });
    fireEvent.change(templateSelect, { target: { value: 't1' } });

    await waitFor(() => expect(container.querySelector('#composer-content')).toBeNull());
    expect(container.querySelector('.composer-fields-primary')).not.toBeNull();
    expect(container.querySelector('.composer-fields-primary #composer-date')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));

    await waitFor(() =>
      expect(container.querySelector('.composer-fields-primary #composer-text-fields')).not.toBeNull(),
    );
    expect(container.querySelector('#composer-content')).toBeNull();
    const textInput = container.querySelector<HTMLTextAreaElement>('#composer-text-fields')!;
    expect(textInput.placeholder).toBe('每行一个字段：\n日期：请输入日期\n睡眠情况：请输入多行文本');
    expect(textInput.value).toBe('');

    fireEvent.change(templateSelect, { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
    await waitFor(() => expect(container.querySelector<HTMLTextAreaElement>('#composer-text-fields')?.placeholder)
      .toBe('每行一个字段：\n书名：输入正在读的书'));
  });
});
