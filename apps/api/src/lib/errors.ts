/**
 * 统一错误模型与错误处理器（SPEC §8）。
 * 失败响应：`{ "error": { "code", "message", "details"? } }`，绝不回显内部堆栈。
 */
import type { FastifyInstance } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '@flomo/shared';

export type ErrorCode = ApiErrorCode;

/** 错误码 → HTTP 状态码 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

/** 应用内业务错误 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (details !== undefined) this.details = details;
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_FAILED', message, details);
}

export function unauthorized(message = '请先登录'): AppError {
  return new AppError('UNAUTHENTICATED', message);
}

export function forbidden(message = '没有权限执行该操作'): AppError {
  return new AppError('FORBIDDEN', message);
}

export function notFound(message = '资源不存在'): AppError {
  return new AppError('NOT_FOUND', message);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, details);
}

export function rateLimited(message = '操作过于频繁，请稍后再试'): AppError {
  return new AppError('RATE_LIMITED', message);
}

export function payloadTooLarge(message = '请求体过大'): AppError {
  return new AppError('PAYLOAD_TOO_LARGE', message);
}

export function internalError(message = '服务器内部错误，请稍后重试'): AppError {
  return new AppError('INTERNAL', message);
}

/** 统一错误响应结构 */
export interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
}

/** 把任意错误转换为 HTTP 响应结构；未知错误一律 500 + 中文文案 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
    return { status: error.status, body };
  }

  const statusCode = typeof error === 'object' && error !== null
    ? Number((error as { statusCode?: unknown }).statusCode)
    : Number.NaN;

  if (statusCode === 413) {
    return {
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大（上限 2 MB）' } },
    };
  }
  if (statusCode === 415) {
    return {
      status: 422,
      body: { error: { code: 'VALIDATION_FAILED', message: '请求头 Content-Type 必须为 application/json' } },
    };
  }
  if (statusCode === 429) {
    return { status: 429, body: { error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' } } };
  }
  if (statusCode === 404) {
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: '接口不存在' } } };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return {
      status: statusCode,
      body: { error: { code: 'VALIDATION_FAILED', message: '请求参数不合法' } },
    };
  }

  return { status: 500, body: { error: { code: 'INTERNAL', message: '服务器内部错误，请稍后重试' } } };
}

/** 注册全局错误处理器（日志保留细节，响应体不外泄） */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error);
    if (status >= 500) {
      request.log.error({ err: error, url: request.url, method: request.method }, '请求处理失败');
    } else if (status !== 404) {
      request.log.info({ code: body.error.code, url: request.url, method: request.method }, body.error.message);
    }
    void reply.status(status).type('application/json; charset=utf-8').send(body);
  });
}
