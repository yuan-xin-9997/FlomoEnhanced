import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Template } from '@flomo/shared';
import { analyticsApi, templatesApi } from '../api/client';
import type { AnalyticsOverview, TemplateInsights } from '../lib/analyticsTypes';
import { ToastProvider } from '../state/toast';
import InsightsPage from './InsightsPage';

vi.mock('../api/client', () => ({
  templatesApi: { list: vi.fn() },
  analyticsApi: { overview: vi.fn(), templateInsights: vi.fn(), exportCsv: vi.fn() },
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock('../components/EChart', () => ({ default: () => null }));
vi.mock('../components/WordCloud', () => ({ default: () => null }));
vi.mock('../components/FieldInsightCard', () => ({ default: () => null, NumericFieldRankViz: () => null }));

const range = { from: '2026-10-01T00:00:00+08:00', to: '2026-10-22T23:59:59+08:00', timezone: 'Asia/Shanghai', days: 22, granularity: 'day' as const, label: '验收区间' };
const common = { range, generatedAt: range.to, tookMs: 0, timeline: { granularity: 'day' as const, points: [] }, heatmap: { max: 0, days: [] }, weekday: { buckets: [] }, hourOfDay: { buckets: [] }, tags: [] };
const overview: AnalyticsOverview = { ...common, numericFields: [], summary: { memoCount: 0, templateCount: 0, byTemplate: [], totalChars: 0, avgChars: 0, activeDays: 0, dayCoverage: 0, longestStreak: 0, currentStreak: 0 } };
const templates: Template[] = ['a', 'b'].map((id) => ({ id, name: `模板${id.toUpperCase()}`, description: '', icon: '', color: '', fields: [], version: 1, memoCount: 0, createdAt: range.from, updatedAt: range.to, archivedAt: null }));

function insights(id: string): TemplateInsights {
  return { ...common, template: templates.find((template) => template.id === id)!, fields: [], summary: { memoCount: 0, allMemoCount: 0, shareOfAllMemos: 0, totalChars: 0, avgChars: 0, memosWithContent: 0, activeDays: 0, dayCoverage: 0, longestStreak: 0, currentStreak: 0, busiestDay: null, firstMemoAt: null, lastMemoAt: null, fieldFillRate: [] } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(templatesApi.list).mockResolvedValue({ items: templates });
  vi.mocked(analyticsApi.overview).mockResolvedValue(overview);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function openPage() {
  render(<MemoryRouter><ToastProvider><InsightsPage /></ToastProvider></MemoryRouter>);
  await screen.findByText('使用模板数');
  await screen.findByRole('option', { name: '模板B' });
  return screen.getByLabelText('选择模板');
}

describe('洞察请求与筛选条件保持一致', () => {
  it.each(['success', 'failure'])('忽略旧请求的%s，只显示并导出最后选择的模板', async (outcome) => {
    const first = deferred<TemplateInsights>();
    const second = deferred<TemplateInsights>();
    vi.mocked(analyticsApi.templateInsights).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const selector = await openPage();
    fireEvent.change(selector, { target: { value: 'a' } });
    fireEvent.change(selector, { target: { value: 'b' } });
    expect((screen.getByRole('button', { name: '导出 CSV' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { second.resolve(insights('b')); });
    expect(screen.getByText(/使用「模板B」的记录/)).toBeTruthy();
    await act(async () => { if (outcome === 'success') first.resolve(insights('a')); else first.reject(new Error('旧请求失败')); });
    expect(screen.getByText(/使用「模板B」的记录/)).toBeTruthy();
    expect(screen.queryByText(/使用「模板A」的记录/)).toBeNull();
    expect(screen.queryByText('旧请求失败')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    await waitFor(() => expect(analyticsApi.exportCsv).toHaveBeenCalledWith('b', expect.any(Object), expect.any(String)));
  });

  it('区间无效时使旧请求失效并禁用导出', async () => {
    const pending = deferred<TemplateInsights>();
    vi.mocked(analyticsApi.templateInsights).mockReturnValue(pending.promise);
    const selector = await openPage();
    fireEvent.change(selector, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('tab', { name: '自定义' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2099-01-01' } });
    await act(async () => { pending.resolve(insights('a')); });
    expect(screen.queryByText(/使用「模板A」的记录/)).toBeNull();
    expect((screen.getByRole('button', { name: '导出 CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('正在统计…')).toBeNull();
  });
});
