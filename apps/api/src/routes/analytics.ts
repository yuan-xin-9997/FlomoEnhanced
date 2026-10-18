/**
 * 洞察分析路由（SPEC §8.4、docs/ANALYTICS.md）—— **归 A3 实现**。
 * ⚠️ 导出名 `registerAnalyticsRoutes` 不得修改。
 *
 * - `GET /api/analytics/overview`                       → 全局概览（所有模板 + 无模板）
 * - `GET /api/analytics/templates/:id/insights`          → 模板洞察（核心端点）
 * - `GET /api/analytics/templates/:id/export.csv`        → CSV 导出（UTF-8 BOM）
 *
 * 三个端点均要求登录（未登录 401）；模板不属于当前用户 → 404；
 * `from > to` 或跨度 > 3660 天 → 422（由 `normalizeRange` 抛出，统一错误体转换）。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  buildContentDisposition,
  buildInsightsCsv,
  computeOverview,
  computeTemplateInsights,
  type Granularity,
} from '../domain/analytics.js';
import { notFound, validationError } from '../lib/errors.js';
import { requireUser, requireUserPreHandler } from '../lib/session.js';

interface RangeQueryParams {
  from: string | null;
  to: string | null;
  granularity: Granularity | null;
}

function readOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  throw validationError(`「${field}」必须是字符串`);
}

/** 解析 from / to / granularity 查询参数（格式校验交给 `normalizeRange`） */
function readRangeQuery(request: FastifyRequest): RangeQueryParams {
  const raw = (request.query ?? {}) as Record<string, unknown>;
  const from = readOptionalString(raw.from, 'from');
  const to = readOptionalString(raw.to, 'to');
  const granularityRaw = readOptionalString(raw.granularity, 'granularity');

  let granularity: Granularity | null = null;
  if (granularityRaw !== null) {
    if (granularityRaw !== 'day' && granularityRaw !== 'week' && granularityRaw !== 'month') {
      throw validationError(`granularity 只能是 day/week/month，当前值："${granularityRaw}"`);
    }
    granularity = granularityRaw;
  }
  return { from, to, granularity };
}

/** 读取并校验路径参数模板 id */
function readTemplateId(request: FastifyRequest): string {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const id = params.id;
  if (typeof id !== 'string' || id === '') throw notFound('模板不存在');
  return id;
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const preHandler = requireUserPreHandler(app);

  /** GET /api/analytics/overview?from=&to= */
  app.get('/api/analytics/overview', { preHandler: [preHandler] }, async (request, reply) => {
    const user = requireUser(app, request);
    const { from, to, granularity } = readRangeQuery(request);

    const startedAt = Date.now();
    const result = computeOverview(app.db, app.config.tz, {
      userId: user.id,
      from,
      to,
      granularity,
    });
    result.tookMs = Date.now() - startedAt;

    return await reply.status(200).send(result);
  });

  /** GET /api/analytics/templates/:id/insights?from=&to=&granularity= */
  app.get('/api/analytics/templates/:id/insights', { preHandler: [preHandler] }, async (request, reply) => {
    const user = requireUser(app, request);
    const templateId = readTemplateId(request);
    const { from, to, granularity } = readRangeQuery(request);

    const startedAt = Date.now();
    const insights = computeTemplateInsights(app.db, app.config.tz, {
      userId: user.id,
      templateId,
      from,
      to,
      granularity,
    });
    const tookMs = Date.now() - startedAt;

    // `csvRows` 是 CSV 导出用的内部字段，HTTP 响应必须剔除。
    const { csvRows: _csvRows, ...payload } = insights;
    void _csvRows;

    return await reply.status(200).send({ ...payload, tookMs });
  });

  /** GET /api/analytics/templates/:id/export.csv?from=&to= */
  app.get('/api/analytics/templates/:id/export.csv', { preHandler: [preHandler] }, async (request, reply) => {
    const user = requireUser(app, request);
    const templateId = readTemplateId(request);
    const { from, to } = readRangeQuery(request);

    const insights = computeTemplateInsights(app.db, app.config.tz, {
      userId: user.id,
      templateId,
      from,
      to,
    });
    const { filename, body } = buildInsightsCsv(insights, app.config.tz);

    return await reply
      .status(200)
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', buildContentDisposition(filename))
      .send(body);
  });
}
