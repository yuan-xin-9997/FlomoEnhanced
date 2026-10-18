/**
 * 请求校验工具（SPEC §8）：所有失败都抛 `AppError('VALIDATION_FAILED', 中文信息)`。
 */
import type { FastifyRequest } from 'fastify';
import { forbidden, validationError } from './errors.js';

const JSON_CONTENT_TYPE = /^application\/(?:json|[a-z0-9.+-]+\+json)\s*(?:;.*)?$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function hasRequestBody(req: FastifyRequest): boolean {
  const length = req.headers['content-length'];
  if (typeof length === 'string' && Number(length) > 0) return true;
  return req.headers['transfer-encoding'] !== undefined;
}

/**
 * 写操作要求 `Content-Type: application/json`（SPEC §8）。
 * 无请求体且无 Content-Type 的写操作（如登出）放行。
 */
export function requireJsonBody(req: FastifyRequest): void {
  const header = req.headers['content-type'];
  if (typeof header === 'string' && JSON_CONTENT_TYPE.test(header.trim())) return;
  if (header === undefined && !hasRequestBody(req)) return;
  throw validationError('请求头 Content-Type 必须为 application/json');
}

/** 同源校验的可选项 */
export interface SameOriginOptions {
  /** 缺少 Origin/Referer 时是否放行，默认 true */
  allowMissing?: boolean;
  /** 额外允许的来源（含协议与端口），如 `http://127.0.0.1:5173` */
  extraOrigins?: string[];
}

function requestOrigins(req: FastifyRequest): string[] {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return [];
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = (protoHeader ?? req.protocol ?? 'http').split(',')[0]?.trim() || 'http';
  return [`${proto}://${host}`, `http://${host}`, `https://${host}`];
}

/** 解析 Origin / Referer 里的来源 */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * 校验写操作同源：存在 `Origin` / `Referer` 时必须与 Host 同源，否则 403；都没有则放行。
 */
export function assertSameOrigin(req: FastifyRequest, options: SameOriginOptions = {}): void {
  const allowMissing = options.allowMissing ?? true;
  const allowed = new Set([...requestOrigins(req), ...(options.extraOrigins ?? [])]);

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer ?? req.headers.referrer;
  const raw = typeof originHeader === 'string' && originHeader !== ''
    ? originHeader
    : typeof refererHeader === 'string' && refererHeader !== ''
      ? refererHeader
      : null;

  if (raw === null) {
    if (allowMissing) return;
    throw forbidden('缺少 Origin/Referer，已拒绝跨站写入');
  }
  if (raw === 'null') throw forbidden('请求来源不被允许（跨站请求已被拒绝）');

  const origin = originOf(raw);
  if (origin === null || !allowed.has(origin)) {
    throw forbidden('请求来源不被允许（跨站请求已被拒绝）');
  }
}

/** 字符串选项 */
export interface StringOptions {
  /** 最小字符数 */
  min?: number;
  /** 最大字符数 */
  max?: number;
  /** 必须匹配的正则 */
  pattern?: RegExp;
  /** 是否 trim，默认 true */
  trim?: boolean;
  /** 允许空字符串，默认 true */
  allowEmpty?: boolean;
}

/** 必填字符串（按 code point 计长度） */
export function asString(value: unknown, field: string, options: StringOptions = {}): string {
  if (typeof value !== 'string') throw validationError(`「${field}」必须是字符串`);
  const trim = options.trim ?? true;
  const result = trim ? value.trim() : value;
  const length = Array.from(result).length;
  if (!(options.allowEmpty ?? true) && length === 0) throw validationError(`「${field}」不能为空`);
  if (options.min !== undefined && length < options.min) {
    throw validationError(`「${field}」至少需要 ${options.min} 个字符`);
  }
  if (options.max !== undefined && length > options.max) {
    throw validationError(`「${field}」不能超过 ${options.max} 个字符`);
  }
  if (options.pattern !== undefined && !options.pattern.test(result)) {
    throw validationError(`「${field}」格式不正确`);
  }
  return result;
}

/** 可选字符串：`null`/`undefined` → undefined */
export function asOptionalString(value: unknown, field: string, options: StringOptions = {}): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, field, options);
}

/** 可选布尔：兼容 true/false 与 '1'/'0'/'true'/'false' */
export function asBoolean(value: unknown, field: string, fallback?: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw validationError(`「${field}」必须是布尔值`);
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', '是'].includes(normalized)) return true;
    if (['false', '0', 'no', '否'].includes(normalized)) return false;
  }
  throw validationError(`「${field}」必须是布尔值`);
}

/** 有限数字（接受数字字符串） */
export function asFiniteNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) throw validationError(`「${field}」必须是数字`);
  if (options.min !== undefined && parsed < options.min) {
    throw validationError(`「${field}」不能小于 ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw validationError(`「${field}」不能大于 ${options.max}`);
  }
  return parsed;
}

/** 整数 */
export function asInteger(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  const parsed = asFiniteNumber(value, field, options);
  if (!Number.isInteger(parsed)) throw validationError(`「${field}」必须是整数`);
  return parsed;
}

/** 字符串数组（单个字符串按单项处理；按 code point 校验每项长度） */
export function asStringArray(
  value: unknown,
  field: string,
  options: { minItems?: number; maxItems?: number; itemMaxLength?: number; trim?: boolean } = {},
): string[] {
  let list: unknown[];
  if (typeof value === 'string') {
    list = [value];
  } else if (Array.isArray(value)) {
    list = value;
  } else {
    throw validationError(`「${field}」必须是字符串数组`);
  }
  const trim = options.trim ?? true;
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw validationError(`「${field}」的每一项都必须是字符串`);
    const text = trim ? item.trim() : item;
    if (text === '') continue;
    if (options.itemMaxLength !== undefined && Array.from(text).length > options.itemMaxLength) {
      throw validationError(`「${field}」的每一项不能超过 ${options.itemMaxLength} 个字符`);
    }
    result.push(text);
  }
  if (options.minItems !== undefined && result.length < options.minItems) {
    throw validationError(`「${field}」至少需要 ${options.minItems} 项`);
  }
  if (options.maxItems !== undefined && result.length > options.maxItems) {
    throw validationError(`「${field}」最多 ${options.maxItems} 项`);
  }
  return result;
}

/** 普通对象（非 null、非数组） */
export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationError(`「${field}」必须是对象`);
  }
  return value as Record<string, unknown>;
}

/** 可选 ISO 日期 `YYYY-MM-DD` */
export function asOptionalIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !DATE_ONLY.test(value.trim())) {
    throw validationError(`「${field}」必须是 YYYY-MM-DD 格式的日期`);
  }
  return value.trim();
}

/** 从对象中取出存在的键（值为 undefined 的键会被剔除） */
export function pickDefined<T extends Record<string, unknown>, K extends keyof T & string>(
  source: T,
  keys: readonly K[],
): Partial<Record<K, T[K]>> {
  const result: Partial<Record<K, T[K]>> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
