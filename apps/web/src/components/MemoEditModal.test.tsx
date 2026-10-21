import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Memo, Template } from '@flomo/shared';
import { memosApi } from '../api/client';
import { ToastProvider } from '../state/toast';
import MemoEditModal from './MemoEditModal';

vi.mock('../api/client', () => ({
  memosApi: { update: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}));

const template: Template = {
  id: 't1', name: '日记', description: '', icon: '📄', color: '#30cf79',
  fields: [
    { key: 'date', label: '日期', type: 'date' },
    { key: 'score', label: '评分', type: 'rating' },
  ],
  version: 1, memoCount: 1, archivedAt: null,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
};
const memo: Memo = {
  id: 'm1', templateId: template.id, templateName: template.name, content: '',
  values: { date: '2026-10-21' }, tags: [],
  createdAt: template.createdAt, updatedAt: template.updatedAt,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MemoEditModal 模式切换', () => {
  it.each([
    ['未知字段：不能丢弃\n日期：2026-10-21', true],
    ['日期：错误日期', true],
    ['\n日期 = 2026-10-21\n\n', false],
    ['评分：4 星，今天精神很好', false],
  ])('保留原文并阻止未修正的识别错误保存：%s', async (original, invalid) => {
    const { container } = render(
      <ToastProvider>
        <MemoEditModal memo={memo} templates={[template]} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
    fireEvent.change(container.querySelector('#memo-edit-text-fields')!, { target: { value: original } });

    for (let round = 0; round < 2; round += 1) {
      fireEvent.click(screen.getByRole('tab', { name: '模板模式' }));
      if (invalid) {
        fireEvent.click(screen.getByRole('button', { name: '保存' }));
        expect(memosApi.update).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('请切回文本模式修正后再保存');
      }
      fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
      expect(container.querySelector<HTMLTextAreaElement>('#memo-edit-text-fields')!.value).toBe(original);
    }

    fireEvent.change(container.querySelector('#memo-edit-text-fields')!, {
      target: { value: '日期：2026-10-21' },
    });
    fireEvent.click(screen.getByRole('tab', { name: '模板模式' }));
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-22' } });
    fireEvent.click(screen.getByRole('tab', { name: '文本模式' }));
    expect(container.querySelector<HTMLTextAreaElement>('#memo-edit-text-fields')!.value).toContain('日期：2026-10-22');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(memosApi.update).toHaveBeenCalledTimes(1));
  });
});
