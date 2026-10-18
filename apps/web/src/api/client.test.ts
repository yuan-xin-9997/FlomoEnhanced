import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, errorMessage, isUnauthenticated, parseContentDisposition } from './client';

describe('buildQuery', () => {
  it('跳过 null/undefined/空串，保留 0 与 false', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: false, f: 0 })).toBe('?a=1&e=false&f=0');
    expect(buildQuery({})).toBe('');
  });
});

describe('ApiError 与中文消息', () => {
  it('errorMessage 优先使用后端中文消息', () => {
    expect(errorMessage(new ApiError('VALIDATION_FAILED', 422, '内容与模板值不能同时为空'))).toBe(
      '内容与模板值不能同时为空',
    );
    expect(errorMessage(new Error('自定义错误'))).toBe('自定义错误');
    expect(errorMessage('字符串错误')).toBe('发生未知错误，请稍后重试');
  });

  it('isUnauthenticated 识别 401 / UNAUTHENTICATED', () => {
    expect(isUnauthenticated(new ApiError('UNAUTHENTICATED', 401, '请先登录'))).toBe(true);
    expect(isUnauthenticated(new ApiError('NOT_FOUND', 404, '不存在'))).toBe(false);
    expect(isUnauthenticated(new Error('x'))).toBe(false);
  });

  it('请求失败时使用后端消息且不泄露细节', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: '同名模板已存在' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { templatesApi } = await import('./client');
      await expect(templatesApi.create({ name: 'x', fields: [] })).rejects.toThrow('同名模板已存在');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('无响应体时回退到状态码中文文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    try {
      const { authApi } = await import('./client');
      await expect(authApi.me()).rejects.toThrow('服务器内部错误，请稍后重试');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('parseContentDisposition', () => {
  it('解析 filename 与 RFC 5987 filename*', () => {
    expect(parseContentDisposition('attachment; filename="flomo-templates-20261018.json"')).toBe(
      'flomo-templates-20261018.json',
    );
    const chineseName = '每日开销-20261018.csv';
    expect(
      parseContentDisposition(`attachment; filename=fallback.csv; filename*=UTF-8''${encodeURIComponent(chineseName)}`),
    ).toBe(chineseName);
    expect(parseContentDisposition('attachment')).toBeNull();
    expect(parseContentDisposition(null)).toBeNull();
  });
});
