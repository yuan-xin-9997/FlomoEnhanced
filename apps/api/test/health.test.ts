import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { HealthResponse } from '@flomo/shared';
import { WEB_DIST_MISSING_HTML } from '../src/app.js';
import { createTestContext, jsonHeaders, type TestContext } from './helpers.js';

describe('健康检查与静态托管', () => {
  let context: TestContext;
  const missingWebDist = () => join(join(process.cwd(), 'test-nonexistent'), 'dist');

  before(async () => {
    context = await createTestContext({ FLOMO_WEB_DIST: missingWebDist() });
  });

  after(async () => {
    await context.close();
  });

  it('GET /api/health 返回 200 且 db.ok 为 true、计数为数字', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const body = response.json() as HealthResponse;
    assert.equal(body.status, 'ok');
    assert.equal(body.db.ok, true);
    assert.equal(typeof body.db.users, 'number');
    assert.equal(typeof body.db.memos, 'number');
    assert.equal(typeof body.db.templates, 'number');
    assert.equal(typeof body.uptimeSec, 'number');
    assert.equal(typeof body.version, 'string');
    assert.ok(Number.isFinite(Date.parse(body.time)));
  });

  it('健康检查是只读的：连续调用不改变任何计数', async () => {
    const first = (await context.app.inject({ method: 'GET', url: '/api/health' })).json() as HealthResponse;
    await context.app.inject({ method: 'GET', url: '/api/health' });
    const second = (await context.app.inject({ method: 'GET', url: '/api/health' })).json() as HealthResponse;
    assert.deepEqual(second.db, first.db);
  });

  it('迁移已建好四张表与索引', async () => {
    const rows = context.db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")
      .all() as Array<{ name: string; type: string }>;
    const names = rows.map((row) => row.name);
    for (const table of ['users', 'sessions', 'templates', 'memos']) {
      assert.ok(names.includes(table), `缺少表 ${table}`);
    }
    for (const index of ['idx_sessions_user', 'idx_templates_user', 'idx_memos_user_created', 'idx_memos_user_template']) {
      assert.ok(names.includes(index), `缺少索引 ${index}`);
    }
    const userVersion = context.db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(Number(userVersion.user_version), 1);
  });

  it('WAL 模式已开启', async () => {
    const row = context.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    assert.equal(String(row.journal_mode).toLowerCase(), 'wal');
  });

  it('外键约束已开启', async () => {
    const row = context.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    assert.equal(Number(row.foreign_keys), 1);
  });

  it('GET /api/nope 返回 JSON 404（不被 SPA 回退吞掉）', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(response.statusCode, 404);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const body = response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.message.length > 0);
  });

  it('POST /api/nope 同样返回 JSON 404', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/nope',
      headers: jsonHeaders(),
      payload: {},
    });
    assert.equal(response.statusCode, 404);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
  });

  it('未实现的认证路由返回 JSON 401（会话桩）或 404，但绝不能是 HTML', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.ok([401, 404].includes(response.statusCode), `意外状态码 ${response.statusCode}`);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const body = response.json() as { error: { code: string } };
    assert.ok(['UNAUTHENTICATED', 'NOT_FOUND'].includes(body.error.code));
  });

  it('前端目录缺失时 GET / 返回中文提示 HTML 而不是崩溃', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/html/);
    assert.equal(response.body, WEB_DIST_MISSING_HTML);
    assert.ok(response.body.includes('浮墨增强版'));
  });

  it('前端目录缺失时任意前端路由也返回提示 HTML', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/templates/abc' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/html/);
  });

  it('所有响应都带安全头', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-frame-options'], 'DENY');
  });

  it('写操作缺少 JSON Content-Type 时返回 422', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/anything',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    assert.equal(response.statusCode, 422);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'VALIDATION_FAILED');
  });

  it('跨站写操作返回 403', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/anything',
      headers: { ...jsonHeaders(), origin: 'http://evil.example.com' },
      payload: {},
    });
    assert.equal(response.statusCode, 403);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  it('同源写操作放行（落到 404 而不是 403）', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/anything',
      headers: { ...jsonHeaders(), origin: 'http://127.0.0.1:35080', host: '127.0.0.1:35080' },
      payload: {},
    });
    assert.equal(response.statusCode, 404);
  });
});

describe('静态资源与 SPA 回退（前端目录存在时）', () => {
  const INDEX_HTML = '<!doctype html><html lang="zh-CN"><title>浮墨增强版</title><div id="root"></div></html>';
  let webDir: string;
  let context: TestContext;

  before(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'flomo-web-dist-'));
    writeFileSync(join(webDir, 'index.html'), INDEX_HTML, 'utf8');
    mkdirSync(join(webDir, 'assets'), { recursive: true });
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("flomo");', 'utf8');
    context = await createTestContext({ FLOMO_WEB_DIST: webDir });
  });

  after(async () => {
    await context.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('GET / 返回前端首页', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/html/);
    assert.equal(response.body, INDEX_HTML);
  });

  it('GET /assets/app.js 返回静态文件', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/assets/app.js' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /javascript/);
    assert.ok(response.body.includes('flomo'));
  });

  it('GET /memos/123 回退到 index.html（SPA 深链接）', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/memos/123' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/html/);
    assert.equal(response.body, INDEX_HTML);
  });

  it('前端目录存在时 /api 未知路径仍是 JSON 404', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/unknown-route' });
    assert.equal(response.statusCode, 404);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
  });

  it('不存在的静态文件回退到首页而不是 404', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/assets/missing.js' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, INDEX_HTML);
  });
});
