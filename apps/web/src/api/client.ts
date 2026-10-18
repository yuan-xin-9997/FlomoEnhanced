/**
 * HTTP API 客户端（SPEC §8）。
 * - 统一 `credentials: 'same-origin'`
 * - 统一把 `{error:{code,message}}` 转成带中文消息的 `ApiError`
 * - 401 时触发全局未登录回调（由会话层接管跳转登录）
 */
import type {
  ApiErrorBody,
  HealthResponse,
  MeResponse,
  Memo,
  MemoListResponse,
  MemoSummary,
  MemoUpsertBody,
  Template,
  TemplateImportMode,
  TemplateImportResult,
  TemplateListResponse,
  TemplateUpsertBody,
  User,
} from '@flomo/shared';
import type { AnalyticsOverview, TemplateInsights } from '../lib/analyticsTypes';
import type { TemplateFile } from '@flomo/shared';

/** 网络层/接口层统一异常 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 是否登录失效错误 */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED');
}

/** 任意异常 → 中文可读文案 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return '发生未知错误，请稍后重试';
}

let unauthorizedHandler: (() => void) | null = null;

/** 注册 401 全局回调（会话 Provider 调用） */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const STATUS_FALLBACK: Record<number, string> = {
  400: '请求内容有误，请检查后重试',
  401: '登录状态已失效，请重新登录',
  403: '没有权限执行该操作',
  404: '请求的资源不存在',
  409: '与现有数据冲突',
  413: '提交的内容过大',
  422: '提交的内容未通过校验',
  429: '操作过于频繁，请稍后再试',
  500: '服务器内部错误，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
};

function fallbackMessage(status: number): string {
  return STATUS_FALLBACK[status] ?? `请求失败（HTTP ${status}）`;
}

type QueryValue = string | number | boolean | null | undefined;

/** 拼接查询串（跳过 null/undefined/空串） */
export function buildQuery(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const text = String(value);
    if (text === '') continue;
    search.set(key, text);
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 是否把 401 视为「未登录」并触发全局跳转（默认 true） */
  notifyUnauthenticated?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, notifyUnauthenticated = true } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, '网络连接失败，请检查网络或稍后重试');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody = (payload as ApiErrorBody | null)?.error;
    if (response.status === 401 && notifyUnauthenticated) unauthorizedHandler?.();
    throw new ApiError(
      errorBody?.code ?? 'INTERNAL',
      response.status,
      errorBody?.message !== undefined && errorBody.message !== '' ? errorBody.message : fallbackMessage(response.status),
      errorBody?.details,
    );
  }

  return payload as T;
}

/** 从 Content-Disposition 解析文件名（优先 RFC 5987 filename*） */
export function parseContentDisposition(header: string | null): string | null {
  if (header === null || header === '') return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star?.[1] !== undefined) {
    const raw = star[1].trim().replace(/^"|"$/g, '');
    const parts = raw.split("''");
    const value = parts.length > 1 ? parts.slice(1).join("''") : raw;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

/** 触发浏览器下载（fetch + blob，保证带 Cookie 与中文文件名） */
async function downloadFile(
  path: string,
  fallbackName: string,
  opts: { notifyUnauthenticated?: boolean } = {},
): Promise<void> {
  const { notifyUnauthenticated = false } = opts;
  let response: Response;
  try {
    response = await fetch(path, { method: 'GET', credentials: 'same-origin' });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, '网络连接失败，无法下载文件');
  }
  if (!response.ok) {
    if (response.status === 401 && notifyUnauthenticated) unauthorizedHandler?.();
    const text = await response.text();
    let message = fallbackMessage(response.status);
    try {
      const parsed = JSON.parse(text) as ApiErrorBody;
      if (parsed.error?.message !== undefined) message = parsed.error.message;
    } catch {
      /* 忽略非 JSON 响应体 */
    }
    throw new ApiError('DOWNLOAD_FAILED', response.status, message);
  }
  const blob = await response.blob();
  const filename = parseContentDisposition(response.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** 认证相关 */
export const authApi = {
  register(username: string, password: string): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/register', { method: 'POST', body: { username, password } });
  },
  login(username: string, password: string): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/login', { method: 'POST', body: { username, password } });
  },
  logout(): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST', notifyUnauthenticated: false });
  },
  me(): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/me', { notifyUnauthenticated: false });
  },
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return request<void>('/api/auth/password', { method: 'PATCH', body: { currentPassword, newPassword } });
  },
};

/** 模板相关（SPEC §8.2 / §7） */
export const templatesApi = {
  list(includeArchived = false): Promise<TemplateListResponse> {
    return request<TemplateListResponse>(`/api/templates${buildQuery({ includeArchived: includeArchived ? 1 : undefined })}`);
  },
  create(body: TemplateUpsertBody): Promise<Template> {
    return request<Template>('/api/templates', { method: 'POST', body });
  },
  get(id: string): Promise<Template> {
    return request<Template>(`/api/templates/${encodeURIComponent(id)}`);
  },
  update(id: string, body: Partial<TemplateUpsertBody>): Promise<Template> {
    return request<Template>(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  },
  remove(id: string, hard = false): Promise<void> {
    return request<void>(`/api/templates/${encodeURIComponent(id)}${hard ? '?hard=1' : ''}`, { method: 'DELETE' });
  },
  restore(id: string): Promise<Template> {
    return request<Template>(`/api/templates/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },
  duplicate(id: string): Promise<Template> {
    return request<Template>(`/api/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  },
  exportUrl(ids?: readonly string[]): string {
    return `/api/templates/export${buildQuery({ ids: ids === undefined || ids.length === 0 ? undefined : ids.join(',') })}`;
  },
  exportFile(ids?: readonly string[]): Promise<void> {
    return downloadFile(templatesApi.exportUrl(ids), 'flomo-templates.json', { notifyUnauthenticated: true });
  },
  import(file: TemplateFile, mode: TemplateImportMode): Promise<TemplateImportResult> {
    return request<TemplateImportResult>(`/api/templates/import${buildQuery({ mode })}`, { method: 'POST', body: file });
  },
};

/** 想法相关（SPEC §8.3） */
export const memosApi = {
  list(params: {
    templateId?: string | null;
    from?: string;
    to?: string;
    tag?: string;
    q?: string;
    limit?: number;
    cursor?: string | null;
  } = {}): Promise<MemoListResponse> {
    return request<MemoListResponse>(
      `/api/memos${buildQuery({
        templateId: params.templateId ?? undefined,
        from: params.from,
        to: params.to,
        tag: params.tag,
        q: params.q,
        limit: params.limit,
        cursor: params.cursor ?? undefined,
      })}`,
    );
  },
  create(body: MemoUpsertBody): Promise<Memo> {
    return request<Memo>('/api/memos', { method: 'POST', body });
  },
  get(id: string): Promise<Memo> {
    return request<Memo>(`/api/memos/${encodeURIComponent(id)}`);
  },
  update(id: string, body: MemoUpsertBody): Promise<Memo> {
    return request<Memo>(`/api/memos/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  },
  remove(id: string): Promise<void> {
    return request<void>(`/api/memos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  summary(params: { from?: string; to?: string } = {}): Promise<MemoSummary> {
    return request<MemoSummary>(`/api/memos/summary${buildQuery({ from: params.from, to: params.to })}`);
  },
};

/** 洞察分析（SPEC §8.4 / docs/ANALYTICS.md） */
export const analyticsApi = {
  overview(params: { from?: string; to?: string } = {}): Promise<AnalyticsOverview> {
    return request<AnalyticsOverview>(`/api/analytics/overview${buildQuery({ from: params.from, to: params.to })}`);
  },
  templateInsights(
    templateId: string,
    params: { from?: string; to?: string; granularity?: 'day' | 'week' | 'month' } = {},
  ): Promise<TemplateInsights> {
    return request<TemplateInsights>(
      `/api/analytics/templates/${encodeURIComponent(templateId)}/insights${buildQuery({
        from: params.from,
        to: params.to,
        granularity: params.granularity,
      })}`,
    );
  },
  csvUrl(templateId: string, params: { from?: string; to?: string } = {}): string {
    return `/api/analytics/templates/${encodeURIComponent(templateId)}/export.csv${buildQuery({
      from: params.from,
      to: params.to,
    })}`;
  },
  exportCsv(templateId: string, params: { from?: string; to?: string } = {}, fallbackName = 'memos.csv'): Promise<void> {
    return downloadFile(analyticsApi.csvUrl(templateId, params), fallbackName, { notifyUnauthenticated: true });
  },
};

/** 健康检查（部署健康检查同源接口，前端设置页可选展示） */
export const healthApi = {
  get(): Promise<HealthResponse> {
    return request<HealthResponse>('/api/health', { notifyUnauthenticated: false });
  },
};

export type { User };
