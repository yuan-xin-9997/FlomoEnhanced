/**
 * Fastify 应用装配（SPEC §3、§8、§8.6）。
 * A1/A2/A3/A4 不需要修改本文件。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@flomo/shared';
import type { Config } from './config.js';
import { registerErrorHandler } from './lib/errors.js';
import { registerSessionPlugin } from './lib/session.js';
import { assertSameOrigin, requireJsonBody } from './lib/validate.js';
import { registerRoutes } from './routes/index.js';

/** 请求体上限 2 MB */
export const BODY_LIMIT = 2 * 1024 * 1024;

export interface BuildAppOptions {
  config: Config;
  db: DatabaseSync;
}

/** 写方法集合（需要 JSON Content-Type + 同源校验） */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 已用于 buildApp 的数据库实例（避免同一连接挂多个应用导致泄漏） */
const usedDatabases = new WeakSet<DatabaseSync>();

function renderNoticeHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#faf9f7;color:#26211c;margin:0;padding:48px 16px;text-align:center">
<h1 style="font-size:20px">${title}</h1>
<p style="color:#6b6157;line-height:1.8">${message}</p>
</body></html>`;
}

/** 前端未构建时的降级提示页（不崩） */
export const WEB_DIST_MISSING_HTML = renderNoticeHtml(
  '浮墨增强版',
  '前端资源尚未构建：请先在项目根目录执行 <code>npm run build</code>，或检查环境变量 <code>FLOMO_WEB_DIST</code> 指向的目录是否存在。API 服务本身已正常运行，可访问 <code>/api/health</code> 检查。',
);

function jsonNotFound(): ApiErrorBody {
  return { error: { code: 'NOT_FOUND', message: '接口不存在' } };
}

function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

/**
 * 装配应用：配置、数据库、安全头、路由、静态资源与 SPA 回退。
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  if (usedDatabases.has(db)) {
    throw new Error('同一个数据库连接只能装配一次应用（buildApp），请为每个实例创建独立的 DatabaseSync。');
  }
  usedDatabases.add(db);

  const app = fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
    bodyLimit: BODY_LIMIT,
    disableRequestLogging: config.logLevel === 'silent',
  });

  app.decorate('db', db);
  app.decorate('config', config);

  await app.register(cookie);
  registerErrorHandler(app);
  registerSessionPlugin(app);

  // 统一前置钩子：安全响应头 + 写操作的 JSON/同源校验
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    void reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');

    if (WRITE_METHODS.has(request.method) && isApiPath(request.url)) {
      requireJsonBody(request);
      assertSameOrigin(request);
    }
  });

  registerRoutes(app);

  // API 的未匹配请求一律 JSON 404（绝不被 SPA 回退吞掉）
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    url: '/api/*',
    handler: async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(404).type('application/json; charset=utf-8').send(jsonNotFound()),
  });

  const hasWebDist = existsSync(config.webDist) && existsSync(join(config.webDist, 'index.html'));
  if (hasWebDist) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      // 注意：`index: false` 会让 @fastify/static 对 `/` 直接返回 403（而非走 notFound），
      // 因此这里保留 index.html，`/` 直接由静态插件返回首页，其它未匹配路径再走 SPA 回退。
      index: ['index.html'],
      wildcard: true,
    });
  }

  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (isApiPath(request.url)) {
      return await reply.status(404).type('application/json; charset=utf-8').send(jsonNotFound());
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return await reply.status(404).type('application/json; charset=utf-8').send(jsonNotFound());
    }
    if (!hasWebDist) {
      return await reply.status(200).type('text/html; charset=utf-8').send(WEB_DIST_MISSING_HTML);
    }
    return await reply.type('text/html; charset=utf-8').sendFile('index.html');
  });

  return app;
}
