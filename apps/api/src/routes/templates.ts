/**
 * 模板路由（SPEC §8.2、§7）—— **归 A2 实现**。
 * ⚠️ 导出名 `registerTemplateRoutes` 不得修改。
 *
 * 说明：
 * - 全部端点要求登录（`requireUserPreHandler(app)`）；未登录 `req.currentUser` 为 `undefined`；
 * - `:id` 一律按字符串（UUID）处理，取不到即视为非法 → 404；
 * - 导入文件头部（format / formatVersion / templates）不合法按 SPEC §7「整体失败」返回 **400**；
 * - 与 A1 的认证路由一样，在独立作用域里放宽「空请求体」的 JSON 解析，保证 `DELETE`（无 body）可用。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Template, TemplateImportMode, TemplateListResponse, User } from '@flomo/shared';
import {
  archiveTemplate,
  createTemplate,
  duplicateTemplate,
  exportTemplates,
  getTemplate,
  hardDeleteTemplate,
  importTemplates,
  inspectTemplateFileHeader,
  listTemplates,
  restoreTemplate,
  updateTemplate,
} from '../domain/templates.js';
import { unauthorized, validationError } from '../lib/errors.js';
import { requireUserPreHandler } from '../lib/session.js';
import { localDayKeyOf } from '../lib/time.js';
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

/** `?includeArchived=1` / `?hard=1` 之类的布尔开关 */
function readFlag(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === '') return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  }
  return false;
}

/** `?ids=a,b` 或 `?ids=a&ids=b` */
function readIds(raw: unknown): string[] | undefined {
  const list: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed !== '') list.push(trimmed);
    }
  };
  if (Array.isArray(raw)) for (const item of raw) push(item);
  else push(raw);
  return list.length === 0 ? undefined : list;
}

/** 导入模式：query 优先，其次请求体的 `mode` 字段，默认 `rename` */
function readImportMode(raw: unknown): TemplateImportMode {
  if (raw === undefined || raw === null || raw === '') return 'rename';
  if (raw === 'skip' || raw === 'rename' || raw === 'overwrite') return raw;
  throw validationError('导入模式非法，只能是 rename / skip / overwrite');
}

export function registerTemplateRoutes(app: FastifyInstance): void {
  const requireUser = requireUserPreHandler(app);

  // 独立作用域：容忍空请求体的 JSON 解析（DELETE 一般不带 body）
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
        done(validationError('请求体不是合法的 JSON'));
      }
    });

    /** GET /api/templates?includeArchived=1 → 200 { items } */
    scope.get('/api/templates', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const includeArchived = readFlag(queryOf(request).includeArchived);
      const items = listTemplates(app.db, user.id, { includeArchived });
      return await reply.status(200).send({ items } satisfies TemplateListResponse);
    });

    /** GET /api/templates/export?ids=a,b → `.flomo-template.json`（附件下载） */
    scope.get('/api/templates/export', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const ids = readIds(queryOf(request).ids);
      const file = exportTemplates(app.db, user.id, ids, app.config.appVersion);
      const stamp = localDayKeyOf(Date.now(), app.config.tz).replace(/-/g, '');
      return await reply
        .status(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="flomo-templates-${stamp}.json"`)
        .send(file);
    });

    /** POST /api/templates/import → 200 TemplateImportResult（头部非法 → 400） */
    scope.post('/api/templates/import', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const raw = request.body;

      const header = inspectTemplateFileHeader(raw);
      if (!header.ok) {
        return await reply
          .status(400)
          .type('application/json; charset=utf-8')
          .send({ error: { code: 'VALIDATION_FAILED', message: header.message } });
      }

      const queryMode = queryOf(request).mode;
      let modeRaw: unknown = queryMode;
      if (modeRaw === undefined || modeRaw === '') {
        const bodyRecord = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
        modeRaw = bodyRecord.mode;
      }
      const mode = readImportMode(modeRaw);

      const result = importTemplates(app.db, user.id, raw, mode, app.config.appVersion);
      return await reply.status(200).send(result);
    });

    /** POST /api/templates → 201 Template */
    scope.post('/api/templates', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const body = asObject(request.body, '请求体');
      const template = createTemplate(app.db, user.id, {
        name: body.name,
        description: body.description,
        icon: body.icon,
        color: body.color,
        fields: body.fields,
      });
      return await reply.status(201).send(template);
    });

    /** GET /api/templates/:id → 200 Template */
    scope.get('/api/templates/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const template: Template = getTemplate(app.db, user.id, idOf(request));
      return await reply.status(200).send(template);
    });

    /** PATCH /api/templates/:id → 200 Template（`fields` 整体替换并 version+1） */
    scope.patch('/api/templates/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const body = asObject(request.body, '请求体');
      const template = updateTemplate(app.db, user.id, idOf(request), {
        name: body.name,
        description: body.description,
        icon: body.icon,
        color: body.color,
        fields: body.fields,
      });
      return await reply.status(200).send(template);
    });

    /** DELETE /api/templates/:id?hard=1 → 204 */
    scope.delete('/api/templates/:id', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const id = idOf(request);
      if (readFlag(queryOf(request).hard)) hardDeleteTemplate(app.db, user.id, id);
      else archiveTemplate(app.db, user.id, id);
      return await reply.status(204).send();
    });

    /** POST /api/templates/:id/restore → 200 Template */
    scope.post('/api/templates/:id/restore', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const template = restoreTemplate(app.db, user.id, idOf(request));
      return await reply.status(200).send(template);
    });

    /** POST /api/templates/:id/duplicate → 201 Template */
    scope.post('/api/templates/:id/duplicate', { preHandler: requireUser }, async (request, reply) => {
      const user = currentUserOf(request);
      const template = duplicateTemplate(app.db, user.id, idOf(request));
      return await reply.status(201).send(template);
    });
  });
}
