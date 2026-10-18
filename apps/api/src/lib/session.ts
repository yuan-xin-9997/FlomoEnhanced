/**
 * 会话管理（SPEC §8）—— 签名由基础脚手架冻结，实现归 A1。
 * 约定：Cookie 名 `flomo_session`，`HttpOnly`、`SameSite=Lax`、`Path=/`，有效期 `FLOMO_SESSION_TTL_DAYS`；
 * 会话表只存 `sha256(token)`（`sessions.token_hash`）。
 *
 * 安全要点：
 * - 令牌是 32 字节随机值的 base64url 编码，只出现在响应 Cookie 中，**绝不写日志**；
 * - 库中只存 `sha256(token)` 的 hex，即使数据库泄露也无法直接盗用会话；
 * - `last_seen_at` 采用 60 秒节流写库，避免高频读接口造成写放大。
 */
import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@flomo/shared';
import type { Config } from '../config.js';
import { findUserById } from '../domain/users.js';
import { unauthorized } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'flomo_session';

/** `last_seen_at` 写库节流窗口：小于该间隔不写库 */
export const SESSION_LAST_SEEN_THROTTLE_MS = 60_000;

/** Cookie 名（供内部兜底注册使用） */
const COOKIE_PLUGIN_NAME = '@fastify/cookie';

/** sessions 表行（显式列，禁止 SELECT *） */
const SESSION_COLUMNS = 'id, user_id, token_hash, created_at, expires_at, last_seen_at';

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

/** token → `sessions.token_hash`（sha256 的 hex） */
export function tokenHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 从请求 Cookie 中取出会话令牌；没有则返回 null。
 * 只做读取，不做任何校验（校验在 `resolveUser` 中）。
 */
export function sessionTokenFromRequest(req: FastifyRequest): string | null {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  const token = cookies?.[SESSION_COOKIE];
  return typeof token === 'string' && token !== '' ? token : null;
}

/** 按 token 查询会话行（过期判断交给调用方） */
function findSessionRow(app: FastifyInstance, token: string): SessionRow | null {
  const row = app.db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = ? LIMIT 1`)
    .get(tokenHashOf(token)) as unknown as SessionRow | undefined;
  return row ?? null;
}

/** 删除指定 id 的会话行 */
function destroySessionById(app: FastifyInstance, sessionId: string): void {
  app.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * 保证 `@fastify/cookie` 已注册。
 * 正常路径下 `app.ts` 已经 `await app.register(cookie)`，这里只做兜底（避免重复注册报错）。
 * `register()` 是惰性排队，由 `app.ready()`/`listen()` 统一加载，因此这里同步调用即可。
 */
function ensureCookiePlugin(app: FastifyInstance): void {
  if (typeof app.hasPlugin === 'function' && app.hasPlugin(COOKIE_PLUGIN_NAME)) return;
  app.register(cookie);
}

/**
 * 注册会话插件：解析 Cookie、把当前用户注入 `req.currentUser`。
 * 未登录时为 `undefined`（`FastifyRequest.currentUser` 是可选字段，见 `src/types.ts`），
 * 消费方一律用 `resolveUser`/`requireUser`/`requireUserPreHandler` 取值，不要直接读字段。
 * 钩子内部完全吞掉异常：`/api/health`、静态资源等未登录请求也绝不会因此报错。
 */
export function registerSessionPlugin(app: FastifyInstance): void {
  ensureCookiePlugin(app);
  app.decorateRequest('currentUser');
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.currentUser = resolveUser(app, request) ?? undefined;
  });
}

/** 创建会话，返回令牌与过期时间（UTC ISO） */
export function createSession(
  app: FastifyInstance,
  userId: string,
  meta: { userAgent?: string; ip?: string },
): { token: string; expiresAt: string } {
  // 256 bit 随机令牌：Cookie 中传输原始值，库中只存 sha256。
  const token = randomBytes(32).toString('base64url');
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + app.config.sessionTtlDays * 86_400_000).toISOString();

  app.db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      userId,
      tokenHashOf(token),
      now,
      expiresAt,
      now,
      meta.userAgent ?? null,
      meta.ip ?? null,
    );

  return { token, expiresAt };
}

/** 销毁单个会话（幂等：令牌不存在时什么都不做） */
export function destroySession(app: FastifyInstance, token: string): void {
  if (typeof token !== 'string' || token === '') return;
  app.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHashOf(token));
}

/** 吊销该用户除 `keepSessionId` 之外的全部会话（改密时使用） */
export function revokeOtherSessions(app: FastifyInstance, userId: string, keepSessionId: string): void {
  app.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepSessionId);
}

/** 按令牌查会话 id（改密时用于保留当前会话；无会话返回 null） */
export function findSessionIdByToken(app: FastifyInstance, token: string): string | null {
  const row = app.db
    .prepare('SELECT id FROM sessions WHERE token_hash = ? LIMIT 1')
    .get(tokenHashOf(token)) as unknown as { id?: string } | undefined;
  return typeof row?.id === 'string' ? row.id : null;
}

/**
 * 解析当前用户；未登录/令牌无效/会话过期/用户不存在都返回 null。
 * 任意异常（含数据库异常）都被吞掉，保证这个钩子对任何请求都安全。
 */
export function resolveUser(app: FastifyInstance, req: FastifyRequest): User | null {
  try {
    const token = sessionTokenFromRequest(req);
    if (token === null) return null;

    const row = findSessionRow(app, token);
    if (row === null) return null;

    const nowMs = Date.now();
    const expiresMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      // 过期即删除该行，避免过期会话长期占用存储。
      destroySessionById(app, row.id);
      return null;
    }

    const user = findUserById(app.db, row.user_id);
    if (user === null) {
      destroySessionById(app, row.id);
      return null;
    }

    // 节流：与上次活跃时间相差不足 60 秒则不写库（读接口高频轮询时避免写放大）。
    const lastSeenMs = Date.parse(row.last_seen_at);
    if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs >= SESSION_LAST_SEEN_THROTTLE_MS) {
      app.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), row.id);
    }

    return user;
  } catch (error) {
    try {
      app.log.error({ err: error }, '会话解析失败（已按未登录处理）');
    } catch {
      // 日志本身失败也不允许影响请求
    }
    return null;
  }
}

/** 要求已登录；未登录抛 401 */
export function requireUser(app: FastifyInstance, req: FastifyRequest): User {
  const user = req.currentUser ?? resolveUser(app, req);
  if (user === null || user === undefined) throw unauthorized('请先登录');
  return user;
}

/** 生成可复用的 preHandler（未登录抛 401，由 `registerErrorHandler` 统一转为 JSON 错误体） */
export function requireUserPreHandler(app: FastifyInstance): (req: FastifyRequest) => Promise<void> {
  return async (req: FastifyRequest): Promise<void> => {
    req.currentUser = requireUser(app, req);
  };
}

/**
 * 写会话 Cookie。
 *
 * ⚠️ 刻意**不设置** `secure`：当前服务以明文 HTTP 部署在 `http://192.168.0.111:35080`，
 * 若加上 `Secure` 属性，浏览器在 HTTP 下不会回传该 Cookie，登录态会直接失效。
 * 将来若全站启用 HTTPS，应改为 `secure: true`（或 `'auto'`）。
 */
export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, config: Config): void {
  const ttlSeconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  const maxAge = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds
    : Math.max(0, Math.floor(config.sessionTtlDays * 86_400));

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/** 清除会话 Cookie（登出；属性需与写入时一致，浏览器才会真正删除） */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}
