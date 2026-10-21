import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MemoPage from './MemoPage';

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

afterEach(cleanup);

describe('MemoPage 撰写区', () => {
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
