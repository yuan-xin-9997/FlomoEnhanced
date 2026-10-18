/**
 * Fastify 类型增强（SPEC §3）：`app.db` / `app.config` / `req.currentUser`。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { User } from '@flomo/shared';
import type { Config } from './config.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 全局唯一的 SQLite 同步连接 */
    db: DatabaseSync;
    /** 运行配置 */
    config: Config;
  }

  interface FastifyRequest {
    /** 由会话中间件（A1）注入的当前用户 */
    currentUser?: User;
  }
}

export {};
