/**
 * 健康检查（SPEC §8.5）—— **只读**：绝不写库、不创建记录。
 * Jenkins 部署后的健康检查依赖此性质。
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@flomo/shared';
import { getSchemaVersion } from '../db/index.js';

const COUNT_TABLES = ['users', 'memos', 'templates'] as const;

function countRows(app: FastifyInstance, table: (typeof COUNT_TABLES)[number]): number {
  const row = app.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number | bigint } | undefined;
  const value = row?.c ?? 0;
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

/** 注册 `GET /api/health` */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async (request, reply) => {
    const base = {
      version: app.config.appVersion,
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    };

    try {
      const payload: HealthResponse = {
        status: 'ok',
        ...base,
        db: {
          ok: true,
          users: countRows(app, 'users'),
          memos: countRows(app, 'memos'),
          templates: countRows(app, 'templates'),
          schemaVersion: getSchemaVersion(app.db),
        },
      };
      return await reply.status(200).type('application/json; charset=utf-8').send(payload);
    } catch (error) {
      request.log.error({ err: error }, '健康检查数据库查询失败');
      const payload: HealthResponse = {
        status: 'degraded',
        ...base,
        db: { ok: false, users: 0, memos: 0, templates: 0 },
      };
      return await reply.status(503).type('application/json; charset=utf-8').send(payload);
    }
  });
}
