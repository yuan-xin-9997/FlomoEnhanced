/**
 * 认证路由（SPEC §8.1）—— 业务实现归 A1。
 * 端点：POST /api/auth/register、POST /api/auth/login、POST /api/auth/logout、
 *       GET /api/auth/me、PATCH /api/auth/password。
 *
 * 安全约定：
 * - 登录失败统一文案「用户名或密码不正确」，不区分用户是否存在；
 * - 日志与错误体中**绝不**出现密码或会话令牌（`details` 里也只有中文提示）；
 * - 登录限流按 `ip:<ip>` 与 `user:<username>` 两个 key 分别计数。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MeResponse } from '@flomo/shared';
import { changePassword, loginUser, registerUser } from '../domain/users.js';
import { forbidden, rateLimited, unauthorized, validationError } from '../lib/errors.js';
import { createRateLimiter } from '../lib/ratelimit.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  findSessionIdByToken,
  requireUser,
  revokeOtherSessions,
  sessionTokenFromRequest,
  setSessionCookie,
} from '../lib/session.js';
import { asObject, asString } from '../lib/validate.js';

/** 登录限流窗口：15 分钟（SPEC §8.1） */
const RATE_WINDOW_MS = 15 * 60 * 1000;
/** 窗口内最大失败次数：10 次（SPEC §8.1） */
const RATE_MAX_FAILURES = 10;

/** 密码字段的宽松上限（真正的强度校验在 domain/users.ts） */
const PASSWORD_INPUT_MAX = 200;

/** 读取请求体中的用户名/密码（密码不 trim，原样参与哈希） */
function readCredentials(request: FastifyRequest): { username: string; password: string } {
  const body = asObject(request.body, '请求体');
  const username = asString(body.username, '用户名', { min: 1, max: 64 });
  const password = asString(body.password, '密码', { trim: false, min: 1, max: PASSWORD_INPUT_MAX });
  return { username, password };
}

/** 会话元信息（仅记录 UA 与 IP，用于审计；不含任何凭据） */
function sessionMeta(request: FastifyRequest): { userAgent?: string; ip?: string } {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' && userAgent !== '' ? userAgent.slice(0, 255) : undefined,
    ip: request.ip,
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // 限流器随应用实例创建（测试之间天然隔离）
  const limiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, maxFailures: RATE_MAX_FAILURES });

  // 认证路由放在独立作用域内，只在这里放宽「空请求体」的 JSON 解析，不影响 A2/A3 的路由。
  app.register(async (scope: FastifyInstance) => {
    /**
     * 允许空请求体：部分客户端即使是无 body 的写操作（如登出）也会带
     * `Content-Type: application/json`，Fastify 默认的 JSON 解析器会直接返回 400。
     * 这里把空 body 解析为 `undefined`；非法 JSON 则抛 422（统一错误体）。
     */
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      const text = typeof body === 'string' ? body : '';
      if (text.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(validationError('请求体不是合法的 JSON'));
      }
    });

    /** POST /api/auth/register → 201 { user } + Set-Cookie */
    scope.post('/api/auth/register', async (request, reply) => {
      if (app.config.allowRegistration === false) {
        throw forbidden('当前已关闭注册');
      }

      const { username, password } = readCredentials(request);
      const user = registerUser(app.db, username, password);

      const session = createSession(app, user.id, sessionMeta(request));
      setSessionCookie(reply, session.token, session.expiresAt, app.config);

      return await reply.status(201).send({ user } satisfies MeResponse);
    });

    /** POST /api/auth/login → 200 { user } + Set-Cookie；失败 401，超限 429 */
    scope.post('/api/auth/login', async (request, reply) => {
      const { username, password } = readCredentials(request);

      const ipKey = `ip:${request.ip}`;
      const userKey = `user:${username.toLowerCase()}`;
      if (!limiter.allow(ipKey) || !limiter.allow(userKey)) {
        throw rateLimited('登录尝试过于频繁，请稍后再试');
      }

      const user = loginUser(app.db, username, password);
      if (user === null) {
        limiter.recordFailure(ipKey);
        limiter.recordFailure(userKey);
        throw unauthorized('用户名或密码不正确');
      }

      limiter.reset(ipKey);
      limiter.reset(userKey);

      const session = createSession(app, user.id, sessionMeta(request));
      setSessionCookie(reply, session.token, session.expiresAt, app.config);

      return await reply.status(200).send({ user } satisfies MeResponse);
    });

    /** POST /api/auth/logout → 204（未登录也返回 204，幂等） */
    scope.post('/api/auth/logout', async (request, reply) => {
      const token = sessionTokenFromRequest(request);
      if (token !== null) destroySession(app, token);
      clearSessionCookie(reply);
      return await reply.status(204).send();
    });

    /** GET /api/auth/me → 200 { user } / 401 */
    scope.get('/api/auth/me', async (request, reply) => {
      const user = requireUser(app, request);
      return await reply.status(200).send({ user } satisfies MeResponse);
    });

    /** PATCH /api/auth/password → 204（吊销该用户其它会话，保留当前会话） */
    scope.patch('/api/auth/password', async (request, reply) => {
      const user = requireUser(app, request);

      const body = asObject(request.body, '请求体');
      const currentPassword = asString(body.currentPassword, '当前密码', {
        trim: false,
        min: 1,
        max: PASSWORD_INPUT_MAX,
      });
      const newPassword = asString(body.newPassword, '新密码', {
        trim: false,
        min: 1,
        max: PASSWORD_INPUT_MAX,
      });

      const token = sessionTokenFromRequest(request);
      const currentSessionId = token === null ? null : findSessionIdByToken(app, token);

      // 校验当前密码 + 更新哈希（校验失败抛 422「当前密码不正确」）
      changePassword(app.db, user.id, currentPassword, newPassword);

      // 吊销其它会话；保留本次请求所用的会话（其 Cookie 仍有效）。
      revokeOtherSessions(app, user.id, currentSessionId ?? '');

      return await reply.status(204).send();
    });
  });
}
