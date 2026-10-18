/**
 * 测试公共工具（归 [F]，A1/A2/A3 只能新增，不得修改已有导出签名）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { User } from '@flomo/shared';
import { buildApp } from '../src/app.js';
import { loadConfig, resolveDbPath, type Config } from '../src/config.js';
import { closeDatabase, openDatabase } from '../src/db/index.js';

export interface TestContext {
  app: FastifyInstance;
  db: DatabaseSync;
  config: Config;
  /** 本次测试的临时数据目录 */
  dataDir: string;
  /** 关闭应用与数据库并删除临时目录 */
  close(): Promise<void>;
}

/**
 * 创建隔离的测试上下文：临时目录 + 独立 SQLite 文件 + silent 日志。
 * @param overrides 追加的环境变量（如 `FLOMO_TZ`、`FLOMO_WEB_DIST`）
 */
export async function createTestContext(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<TestContext> {
  const dataDir = mkdtempSync(join(tmpdir(), 'flomo-api-test-'));
  const env: NodeJS.ProcessEnv = {
    ...overrides,
    FLOMO_DATA_DIR: dataDir,
    FLOMO_LOG_LEVEL: overrides.FLOMO_LOG_LEVEL ?? 'silent',
    NODE_ENV: overrides.NODE_ENV ?? 'test',
  };
  const config = loadConfig(env);
  const db = openDatabase({ file: resolveDbPath(config) });
  const app = await buildApp({ config, db });

  return {
    app,
    db,
    config,
    dataDir,
    close: async (): Promise<void> => {
      await app.close();
      closeDatabase(db);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** 生成 JSON 请求头（可选带会话 Cookie） */
export function jsonHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie !== undefined && cookie !== '') headers.cookie = cookie;
  return headers;
}

/** 从 `set-cookie` 响应头中提取 `flomo_session=...` 片段 */
export function extractSessionCookie(setCookie: string | string[] | undefined): string | null {
  if (setCookie === undefined) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const entry of list) {
    for (const part of entry.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('flomo_session=')) return trimmed;
    }
  }
  return null;
}

/**
 * 注册并登录一个用户（依赖 A1 的认证路由）。
 * 认证路由尚未实现时会抛出明确的中文错误。
 */
export async function registerAndLogin(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<{ user: User; cookie: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: jsonHeaders(),
    payload: { username, password },
  });

  if (response.statusCode === 404) {
    throw new Error('注册失败：认证路由尚未实现（POST /api/auth/register 返回 404，等待 A1 实现）。');
  }
  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`注册失败（HTTP ${response.statusCode}）：${response.body}`);
  }
  const cookie = extractSessionCookie(response.headers['set-cookie']);
  if (cookie === null) {
    throw new Error('注册成功但响应中没有 flomo_session Cookie，请检查 A1 的会话实现。');
  }
  const body = response.json() as { user?: User };
  if (body.user === undefined) {
    throw new Error('注册响应缺少 user 字段，请检查 A1 的实现（应为 { user }）。');
  }
  return { user: body.user, cookie };
}
