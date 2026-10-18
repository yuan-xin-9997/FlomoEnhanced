/**
 * 想法路由（SPEC §8.3）—— **归 A2 实现**。
 * ⚠️ 导出名 `registerMemoRoutes` 不得修改。
 *
 * 说明：
 * - 全部端点要求登录（`requireUserPreHandler(app)`）；
 * - `:id` 一律按字符串（UUID）处理，取不到即非法 → 404；
 * - 与 A1 的认证路由一样，在独立作用域里放宽「空请求体」的 JSON 解析，保证 `DELETE`（无 body）可用；
 * - 查询参数（`templateId`/`from`/`to`/`tag`/`q`/`limit`/`cursor`）原样交给 domain 校验与解释。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Memo, MemoListResponse, MemoSummary, User } from '@flomo/shared';
import {
  createMemo,
  deleteMemo,
  getMemo,
  listMemos,
  memoSummary,
  updateMemo,
  type MemoWriteContext,
} from '../domain/memos.js';
import { unauthorized, validationError } from '../lib/errors.js';
import { requireUserPreHandler } from '../lib/session.js';
import { asObject } from '../lib/validate.js';

function currentUserOf(request: FastifyRequest): User {
  const user = request.currentUser;
  if (user === undefined) throw unauthorized('请先登录');
  return user;
}

function queryOf(request: FastifyRequest): Record<string, unknown> {
  const query = request.query;
  if (typeof query === 'object' && query !== null && !Array.isArray(query)) {
    return query as Record<string, unknown>;
  }
  return {};
}

/** 路由参数 `:id`（UUID 字符串；非法即空串，由 domain 转 404） */
function idOf(request: FastifyRequest): string {
  const params = request.params;
  if (typeof params === 'object' && params !== null) {
    const value = (params as Record<string, unknown>).id;
    if (typeof value === 'string') return value;
  }
  return '';
}

export function registerMemoRoutes(app: FastifyInstance): void {
  const requireUser = requireUserPreHandler(app);

  app.register(async (scope: FastifyInstance) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      const text = typeof body === 'string' ? body : '';
      if (text.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        // 与其他路由一致：非法 JSON 走统一错误体（422 VALIDATION_FAILED）
        done(validationError('请求体不是合法的 JSON'));
      }
    });

    /** 写操作上下文：时区 + 告警日志（例如「创建时间在未来」） */
    const contextOf = (request: FastifyRequest): MemoWriteContext => ({
      tz: app.config.tz,
      warn: (message: string, meta?: Record<string, unknown>): void => {
        if (meta === undefined) request.log.warn(message);
        else request.log.warn(meta, message);
      },
    });

    /** GET /api/memos/summary?from=&to= → 200 MemoSummary */
    scope.get('/api/memos/summary', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const query = queryOf(request);
      const summary: MemoSummary = memoSummary(
        app.db,
        user.id,
        { from: query.from, to: query.to },
        app.config.tz,
      );
      return await reply.status(200).send(summary);
    });

    /** GET /api/memos → 200 { items, nextCursor, total } */
    scope.get('/api/memos', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const query = queryOf(request);
      const result = listMemos(
        app.db,
        user.id,
        {
          templateId: query.templateId,
          from: query.from,
          to: query.to,
          tag: query.tag,
          q: query.q,
          limit: query.limit,
          cursor: query.cursor,
        },
        contextOf(request),
      );
      return await reply.status(200).send(result satisfies MemoListResponse);
    });

    /** POST /api/memos → 201 Memo */
    scope.post('/api/memos', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const body = asObject(request.body, '请求体');
      const memo = createMemo(
        app.db,
        user.id,
        {
          content: body.content,
          templateId: body.templateId,
          values: body.values,
          tags: body.tags,
          createdAt: body.createdAt,
        },
        contextOf(request),
      );
      return await reply.status(201).send(memo);
    });

    /** GET /api/memos/:id → 200 Memo */
    scope.get('/api/memos/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const memo: Memo = getMemo(app.db, user.id, idOf(request));
      return await reply.status(200).send(memo);
    });

    /** PATCH /api/memos/:id → 200 Memo */
    scope.patch('/api/memos/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const body = asObject(request.body, '请求体');
      const memo = updateMemo(
        app.db,
        user.id,
        idOf(request),
        {
          content: body.content,
          templateId: body.templateId,
          values: body.values,
          tags: body.tags,
        },
        contextOf(request),
      );
      return await reply.status(200).send(memo);
    });

    /** DELETE /api/memos/:id → 204（软删除） */
    scope.delete('/api/memos/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      deleteMemo(app.db, user.id, idOf(request));
      return await reply.status(204).send();
    });
  });
}
