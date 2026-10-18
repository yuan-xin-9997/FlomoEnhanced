/**
 * HTTP API 的公共 DTO（SPEC §8）。前后端共用，后端只返回这些结构。
 */
import type { FieldDefinition, FieldValue } from './fieldTypes.js';

/** 用户 DTO —— 永不包含任何密码字段（SPEC §8.1） */
export interface User {
  id: string;
  username: string;
  createdAt: string;
}

/** GET /api/auth/me 与注册/登录响应体 */
export interface MeResponse {
  user: User;
}

/** 模板 DTO（SPEC §8.2） */
export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldDefinition[];
  version: number;
  memoCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** 模板列表响应 */
export interface TemplateListResponse {
  items: Template[];
}

/** 创建/更新模板的请求体 */
export interface TemplateUpsertBody {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  fields: FieldDefinition[];
}

/** 模板导入结果（SPEC §7） */
export interface TemplateImportResult {
  imported: Template[];
  skipped: Array<{ name: string; reason: string }>;
  overwritten: Template[];
  errors: Array<{ index: number; name: string; message: string }>;
}

/** 模板导入模式（SPEC §7） */
export type TemplateImportMode = 'skip' | 'rename' | 'overwrite';

/** 想法 DTO（SPEC §8.3） */
export interface Memo {
  id: string;
  templateId: string | null;
  templateName: string | null;
  content: string;
  values: Record<string, FieldValue>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** GET /api/memos 响应（游标分页） */
export interface MemoListResponse {
  items: Memo[];
  nextCursor: string | null;
  total: number;
}

/** GET /api/memos/summary 响应（首页侧栏） */
export interface MemoSummary {
  total: number;
  byTemplate: Array<{ templateId: string | null; templateName: string; count: number }>;
  heatmap: Array<{ date: string; count: number }>;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  firstMemoAt: string | null;
  lastMemoAt: string | null;
}

/** 创建/更新想法的请求体 */
export interface MemoUpsertBody {
  content?: string;
  templateId?: string | null;
  values?: Record<string, FieldValue>;
  tags?: string[];
  createdAt?: string;
}

/** 统一错误码（SPEC §8） */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

/** 统一错误响应体（SPEC §8） */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** GET /api/health 响应（SPEC §8.5） */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSec: number;
  time: string;
  db: {
    ok: boolean;
    users: number;
    memos: number;
    templates: number;
    schemaVersion?: number;
  };
}
