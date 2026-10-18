/**
 * 路由汇总注册（SPEC §3）—— **导出名不得修改**。
 * A1/A2/A3 各自实现对应文件，本文件保持不变。
 */
import type { FastifyInstance } from 'fastify';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerAuthRoutes } from './auth.js';
import { registerHealthRoutes } from './health.js';
import { registerMemoRoutes } from './memos.js';
import { registerTemplateRoutes } from './templates.js';

/** 依次注册全部路由 */
export function registerRoutes(app: FastifyInstance): void {
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerTemplateRoutes(app);
  registerMemoRoutes(app);
  registerAnalyticsRoutes(app);
}
