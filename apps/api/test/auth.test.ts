/**
 * 认证与会话核心测试（SPEC §8.1、§9）—— 归 A1。
 * 覆盖：注册/登录/登出/me/改密、统一错误体、限流、密码哈希与会话令牌的存储形态。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorBody, User } from '@flomo/shared';
import { createRateLimiter } from '../src/lib/ratelimit.js';
import { createTestContext, extractSessionCookie, jsonHeaders, registerAndLogin, type TestContext } from './helpers.js';

/** 合规密码（不在弱口令表中，也不等于任何用户名） */
const PASSWORD = 'S3cure-Passw0rd!';
const NEW_PASSWORD = 'An0ther-Passw0rd!';
const WRONG_PASSWORD = 'Definitely-Wrong-99!';

interface MeBody {
  user: User;
}

type InjectResult = Awaited<ReturnType<FastifyInstance['inject']>>;

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

/** `flomo_session=<token>` → `<token>` */
function tokenOf(cookie: string): string {
  const index = cookie.indexOf('=');
  assert.ok(index > 0, `Cookie 格式异常：${cookie}`);
  return cookie.slice(index + 1);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function register(app: FastifyInstance, username: string, password: string): Promise<InjectResult> {
  return await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: jsonHeaders(),
    payload: { username, password },
  });
}

async function login(app: FastifyInstance, username: string, password: string): Promise<InjectResult> {
  return await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: jsonHeaders(),
    payload: { username, password },
  });
}

async function me(app: FastifyInstance, cookie?: string): Promise<InjectResult> {
  return await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

/** 登录并返回 Cookie（断言成功） */
async function loginCookie(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await login(app, username, password);
  assert.equal(response.statusCode, 200, `登录失败（HTTP ${response.statusCode}）：${response.body}`);
  const cookie = extractSessionCookie(response.headers['set-cookie']);
  assert.ok(cookie !== null, '登录成功但响应没有 flomo_session Cookie');
  return cookie;
}

function sessionRowOf(ctx: TestContext, token: string): SessionRow | undefined {
  return ctx.db
    .prepare('SELECT id, user_id, token_hash, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?')
    .get(sha256(token)) as unknown as SessionRow | undefined;
}

function countSessionsOf(ctx: TestContext, userId: string): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?').get(userId) as unknown as {
    c: number | bigint;
  };
  return Number(row.c);
}

describe('认证：注册 / 登录 / 会话 / 改密', () => {
  let ctx: TestContext;
  let registered: { user: User; cookie: string };

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.close();
  });

  it('1. 注册成功：201 + user（无任何密码字段）+ HttpOnly Cookie', async () => {
    const response = await register(ctx.app, 'alice01', PASSWORD);
    assert.equal(response.statusCode, 201);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);

    const body = response.json() as MeBody;
    assert.equal(typeof body.user.id, 'string');
    assert.ok(body.user.id.length > 0);
    assert.equal(body.user.username, 'alice01');
    assert.ok(Number.isFinite(Date.parse(body.user.createdAt)));

    const serialized = JSON.stringify(body);
    assert.ok(!/password/i.test(serialized), `响应体泄露了密码字段：${serialized}`);
    assert.ok(!/salt/i.test(serialized), `响应体泄露了盐：${serialized}`);
    assert.ok(!/algo/i.test(serialized), `响应体泄露了算法字段：${serialized}`);

    const setCookie = response.headers['set-cookie'];
    assert.equal(typeof setCookie, 'string');
    const raw = String(setCookie);
    const attributes = raw.split(';').map((part) => part.trim());
    assert.match(raw, /^flomo_session=/);
    assert.ok(attributes.includes('HttpOnly'), `缺少 HttpOnly：${raw}`);
    assert.ok(attributes.some((attr) => /^SameSite=Lax$/i.test(attr)), `缺少 SameSite=Lax：${raw}`);
    assert.ok(attributes.some((attr) => /^Path=\/$/.test(attr)), `缺少 Path=/：${raw}`);
    // 当前部署是明文 HTTP（http://192.168.0.111:35080），设置 Secure 会导致浏览器不回传 Cookie。
    assert.ok(attributes.every((attr) => !/^Secure(=|$)/i.test(attr)), `不应设置 Secure：${raw}`);

    const cookie = extractSessionCookie(setCookie);
    assert.ok(cookie !== null);
    registered = { user: body.user, cookie };
  });

  it('2. 重复用户名（大小写不同）返回 409 CONFLICT', async () => {
    const response = await register(ctx.app, 'ALICE01', PASSWORD);
    assert.equal(response.statusCode, 409);
    const body = response.json() as ApiErrorBody;
    assert.equal(body.error.code, 'CONFLICT');
    assert.ok(body.error.message.includes('用户名'));
  });

  it('3. 非法用户名 / 弱口令 / 过短密码 → 422 统一错误体', async () => {
    const before = ctx.db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number | bigint };

    const cases: Array<{ username: string; password: string; withDetails: boolean; label: string }> = [
      { username: 'ab', password: PASSWORD, withDetails: false, label: '用户名过短' },
      { username: 'bad name', password: PASSWORD, withDetails: false, label: '用户名含空格' },
      { username: 'has.dot', password: PASSWORD, withDetails: false, label: '用户名含非法字符' },
      { username: 'bob0001', password: '12345678', withDetails: true, label: '弱口令' },
      { username: 'bob0002', password: 'Ab1', withDetails: true, label: '密码过短' },
      { username: 'bobbobbob', password: 'bobbobbob', withDetails: true, label: '密码与用户名相同' },
    ];

    for (const item of cases) {
      const response = await register(ctx.app, item.username, item.password);
      assert.equal(response.statusCode, 422, `${item.label} 应为 422，实际 ${response.statusCode}`);
      assert.match(response.headers['content-type'] ?? '', /application\/json/);
      const body = response.json() as ApiErrorBody;
      assert.equal(body.error.code, 'VALIDATION_FAILED', item.label);
      assert.ok(body.error.message.length > 0, `${item.label} 缺少中文消息`);
      if (item.withDetails) {
        assert.ok(Array.isArray(body.error.details), `${item.label} 应带 details 数组`);
        assert.ok((body.error.details as unknown[]).length > 0, `${item.label} details 不应为空`);
        assert.ok(
          !JSON.stringify(body.error.details).includes(item.password),
          `${item.label} 的 details 不应回显密码明文`,
        );
      }
    }

    const after = ctx.db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number | bigint };
    assert.equal(Number(after.c), Number(before.c), '非法注册不应写入任何用户');
  });

  it('4. 登录成功返回 200 + Cookie；失败文案不区分用户是否存在', async () => {
    const response = await login(ctx.app, 'alice01', PASSWORD);
    assert.equal(response.statusCode, 200);
    const body = response.json() as MeBody;
    assert.equal(body.user.username, 'alice01');
    assert.ok(extractSessionCookie(response.headers['set-cookie']) !== null);

    const wrongPassword = await login(ctx.app, 'alice01', WRONG_PASSWORD);
    assert.equal(wrongPassword.statusCode, 401);
    const missingUser = await login(ctx.app, 'ghost-user-404', WRONG_PASSWORD);
    assert.equal(missingUser.statusCode, 401);

    // 两种失败必须完全一致（状态码 + 错误体），否则可枚举用户名
    assert.equal(wrongPassword.body, missingUser.body);
    const error = wrongPassword.json() as ApiErrorBody;
    assert.equal(error.error.code, 'UNAUTHENTICATED');
    assert.equal(error.error.message, '用户名或密码不正确');
    assert.ok(extractSessionCookie(wrongPassword.headers['set-cookie']) === null, '登录失败不应下发 Cookie');
  });

  it('5. GET /api/auth/me：带 Cookie → 200 {user}；不带 → 401 JSON', async () => {
    const authed = await me(ctx.app, registered.cookie);
    assert.equal(authed.statusCode, 200);
    const body = authed.json() as MeBody;
    assert.deepEqual(body.user, registered.user);

    const anonymous = await me(ctx.app);
    assert.equal(anonymous.statusCode, 401);
    assert.match(anonymous.headers['content-type'] ?? '', /application\/json/);
    const error = anonymous.json() as ApiErrorBody;
    assert.equal(error.error.code, 'UNAUTHENTICATED');
  });

  it('6. last_seen_at 节流：短时间内多次访问不写库（<60 秒不更新）', async () => {
    const token = tokenOf(registered.cookie);
    const first = sessionRowOf(ctx, token);
    assert.ok(first !== undefined, '会话行应存在');

    await me(ctx.app, registered.cookie);
    await me(ctx.app, registered.cookie);

    const second = sessionRowOf(ctx, token);
    assert.ok(second !== undefined);
    assert.equal(second.last_seen_at, first.last_seen_at, '60 秒内的重复访问不应更新 last_seen_at');

    // 人工把 last_seen_at 拨回 2 分钟前，下一次访问应触发写库
    ctx.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 120_000).toISOString(), sha256(token));
    await me(ctx.app, registered.cookie);
    const third = sessionRowOf(ctx, token);
    assert.ok(third !== undefined);
    assert.notEqual(third.last_seen_at, second.last_seen_at, '超过节流窗口后应更新 last_seen_at');
  });

  it('7. logout 后原 Cookie 失效（再访问 me → 401），且登出是幂等的', async () => {
    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: jsonHeaders(registered.cookie),
    });
    assert.equal(logout.statusCode, 204);
    const cleared = String(logout.headers['set-cookie'] ?? '');
    assert.match(cleared, /flomo_session=;?/);

    const afterLogout = await me(ctx.app, registered.cookie);
    assert.equal(afterLogout.statusCode, 401);
    assert.equal((afterLogout.json() as ApiErrorBody).error.code, 'UNAUTHENTICATED');
    assert.equal(sessionRowOf(ctx, tokenOf(registered.cookie)), undefined, '会话行应被删除');

    // 未登录再次登出仍返回 204（幂等）
    const again = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: jsonHeaders() });
    assert.equal(again.statusCode, 204);
  });

  it('8. 改密码：当前密码错误 → 422；成功后其它会话失效、当前会话仍有效、新旧密码生效情况正确', async () => {
    const username = 'dave-pw';
    const created = await register(ctx.app, username, PASSWORD);
    assert.equal(created.statusCode, 201);
    const userId = (created.json() as MeBody).user.id;

    const sessionAValue = await loginCookie(ctx.app, username, PASSWORD);
    const sessionBValue = await loginCookie(ctx.app, username, PASSWORD);
    assert.notEqual(sessionAValue, sessionBValue, '两次登录应得到不同的会话令牌');
    assert.equal(countSessionsOf(ctx, userId), 3, '注册 + 两次登录共 3 个会话');

    // 8.1 当前密码错误 → 422「当前密码不正确」
    const wrongCurrent = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: jsonHeaders(sessionAValue),
      payload: { currentPassword: WRONG_PASSWORD, newPassword: NEW_PASSWORD },
    });
    assert.equal(wrongCurrent.statusCode, 422);
    const wrongBody = wrongCurrent.json() as ApiErrorBody;
    assert.equal(wrongBody.error.code, 'VALIDATION_FAILED');
    assert.equal(wrongBody.error.message, '当前密码不正确');

    // 8.2 未登录 → 401
    const anonymous = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: jsonHeaders(),
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    assert.equal(anonymous.statusCode, 401);
    assert.equal((anonymous.json() as ApiErrorBody).error.code, 'UNAUTHENTICATED');

    // 8.3 正确改密 → 204
    const changed = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: jsonHeaders(sessionAValue),
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    assert.equal(changed.statusCode, 204);

    // 当前会话（A）仍有效，其它会话（B）被吊销
    const stillAuthed = await me(ctx.app, sessionAValue);
    assert.equal(stillAuthed.statusCode, 200, '当前会话应保持有效');
    const revoked = await me(ctx.app, sessionBValue);
    assert.equal(revoked.statusCode, 401, '其它会话应被吊销');
    assert.equal(sessionRowOf(ctx, tokenOf(sessionBValue)), undefined, '被吊销的会话行应被删除');
    assert.ok(sessionRowOf(ctx, tokenOf(sessionAValue)) !== undefined, '当前会话行应保留');

    // 旧密码登录失败、新密码登录成功
    const oldPassword = await login(ctx.app, username, PASSWORD);
    assert.equal(oldPassword.statusCode, 401);
    const newPassword = await login(ctx.app, username, NEW_PASSWORD);
    assert.equal(newPassword.statusCode, 200);

    // 数据库中只剩「当前会话 + 新登录会话」
    assert.equal(countSessionsOf(ctx, userId), 2);

    // 数据库里哈希已更新为新的 scrypt 值
    const row = ctx.db
      .prepare('SELECT password_algo, password_hash, password_salt FROM users WHERE username = ?')
      .get(username) as unknown as { password_algo: string; password_hash: string; password_salt: string };
    assert.equal(row.password_algo, 'scrypt');
    assert.equal(row.password_hash.length, 128);
    assert.equal(row.password_salt.length, 32);
  });

  it('9. 数据库只存 scrypt 哈希（不含明文，盐非空，算法为 scrypt）', async () => {
    const row = ctx.db
      .prepare('SELECT password_hash, password_salt, password_algo FROM users WHERE username = ?')
      .get('alice01') as unknown as { password_hash: string; password_salt: string; password_algo: string };

    assert.equal(row.password_algo, 'scrypt');
    assert.equal(row.password_salt.length, 32, '16 字节盐的十六进制应为 32 个字符');
    assert.match(row.password_salt, /^[0-9a-f]{32}$/);
    assert.equal(row.password_hash.length, 128, 'scrypt keylen=64 的十六进制应为 128 个字符');
    assert.match(row.password_hash, /^[0-9a-f]{128}$/);
    assert.notEqual(row.password_hash, PASSWORD);
    assert.ok(!row.password_hash.includes(PASSWORD), '哈希中不应包含明文密码');
    assert.ok(!row.password_salt.includes(PASSWORD), '盐中不应包含明文密码');
  });

  it('10. 会话表只存 sha256(token)：token_hash !== token', async () => {
    const cookie = await loginCookie(ctx.app, 'alice01', PASSWORD);
    const token = tokenOf(cookie);
    assert.ok(token.length >= 32, '令牌应有足够熵');

    const row = sessionRowOf(ctx, token);
    assert.ok(row !== undefined, '会话行应存在');
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash, sha256(token));
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);

    // 全表都不应出现明文令牌
    const all = ctx.db.prepare('SELECT token_hash FROM sessions').all() as unknown as Array<{ token_hash: string }>;
    for (const entry of all) {
      assert.ok(!entry.token_hash.includes(token), '会话表存在明文令牌');
    }
    assert.ok(sessionRowOf(ctx, 'not-a-real-token-aaaa') === undefined, '伪造令牌不应有对应会话');
  });

  it('11. 会话钩子对 health / 静态资源 / 伪造 Cookie 安全，不抛错', async () => {
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);

    const spa = await ctx.app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: 'flomo_session=not-a-real-token' },
    });
    assert.equal(spa.statusCode, 200, '带伪造 Cookie 的静态请求不应报错');

    const faked = await me(ctx.app, 'flomo_session=not-a-real-token');
    assert.equal(faked.statusCode, 401);
    assert.match(faked.headers['content-type'] ?? '', /application\/json/);
  });

  it('12. 过期会话：访问 /me 返回 401 且过期行被清理', async () => {
    const cookie = await loginCookie(ctx.app, 'alice01', PASSWORD);
    const token = tokenOf(cookie);
    ctx.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), sha256(token));

    const response = await me(ctx.app, cookie);
    assert.equal(response.statusCode, 401);
    assert.equal(sessionRowOf(ctx, token), undefined, '过期会话行应被删除');
  });
  it('13. helpers.registerAndLogin（A2/A3 依赖的注册+登录入口）可直接使用', async () => {
    const { user, cookie } = await registerAndLogin(ctx.app, 'helper-user', PASSWORD);
    assert.equal(typeof user.id, 'string');
    assert.equal(user.username, 'helper-user');
    assert.ok(cookie.startsWith('flomo_session='));

    const authed = await me(ctx.app, cookie);
    assert.equal(authed.statusCode, 200);
    assert.equal((authed.json() as MeBody).user.id, user.id);
  });

  it('14. 非法 JSON 请求体返回 422 统一错误体（不是 500）', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":',
    });
    assert.equal(response.statusCode, 422);
    const body = response.json() as ApiErrorBody;
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    assert.ok(body.error.message.length > 0);

    // 空请求体（带 JSON Content-Type）→ 422，而不是 400/500
    const emptyBody = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(emptyBody.statusCode, 422);
    assert.equal((emptyBody.json() as ApiErrorBody).error.code, 'VALIDATION_FAILED');
  });
});

describe('登录限流（同一 IP / 用户名 15 分钟内失败 ≥10 次）', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.close();
  });

  it('连续 10 次失败后第 11 次返回 429 RATE_LIMITED（含正确密码也被拦）', async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await login(ctx.app, 'rate-limited-user', WRONG_PASSWORD);
      assert.equal(response.statusCode, 401, `第 ${attempt} 次失败应为 401，实际 ${response.statusCode}`);
    }

    const blocked = await login(ctx.app, 'rate-limited-user', WRONG_PASSWORD);
    assert.equal(blocked.statusCode, 429);
    const body = blocked.json() as ApiErrorBody;
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.equal(body.error.message, '登录尝试过于频繁，请稍后再试');

    // 同一 IP 下换用户名同样被拦（ip key 也超额）
    const otherUser = await login(ctx.app, 'another-user', WRONG_PASSWORD);
    assert.equal(otherUser.statusCode, 429);

    // 即使密码正确也被拦截
    const correct = await login(ctx.app, 'rate-limited-user', PASSWORD);
    assert.equal(correct.statusCode, 429);
  });

  it('成功登录会清零失败计数（reset）', async () => {
    const fresh = await createTestContext();
    try {
      const created = await register(fresh.app, 'reset-user', PASSWORD);
      assert.equal(created.statusCode, 201);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const failed = await login(fresh.app, 'reset-user', WRONG_PASSWORD);
        assert.equal(failed.statusCode, 401);
      }
      const ok = await login(fresh.app, 'reset-user', PASSWORD);
      assert.equal(ok.statusCode, 200);

      // reset 后重新累计，9 次失败仍未触发限流
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const failed = await login(fresh.app, 'reset-user', WRONG_PASSWORD);
        assert.equal(failed.statusCode, 401, `reset 后第 ${attempt + 1} 次失败仍应为 401`);
      }
      const stillOk = await login(fresh.app, 'reset-user', PASSWORD);
      assert.equal(stillOk.statusCode, 200, '9 次失败 < 10，且成功登录会清零');
    } finally {
      await fresh.close();
    }
  });

  it('限流器单元：滑动窗口过期后重新允许，且支持惰性清理', () => {
    let nowMs = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 1_000, maxFailures: 2, now: () => nowMs });

    assert.equal(limiter.allow('ip:1.2.3.4'), true);
    limiter.recordFailure('ip:1.2.3.4');
    assert.equal(limiter.allow('ip:1.2.3.4'), true);
    limiter.recordFailure('ip:1.2.3.4');
    assert.equal(limiter.allow('ip:1.2.3.4'), false);

    // 窗口滑过后旧失败记录失效
    nowMs += 1_001;
    assert.equal(limiter.allow('ip:1.2.3.4'), true);
    limiter.recordFailure('ip:1.2.3.4');
    assert.equal(limiter.allow('ip:1.2.3.4'), true);
    limiter.recordFailure('ip:1.2.3.4');
    assert.equal(limiter.allow('ip:1.2.3.4'), false);

    limiter.reset('ip:1.2.3.4');
    assert.equal(limiter.allow('ip:1.2.3.4'), true);

    // 不同 key 互不影响
    limiter.recordFailure('user:alice');
    limiter.recordFailure('user:alice');
    assert.equal(limiter.allow('user:alice'), false);
    assert.equal(limiter.allow('user:bob'), true);
  });
});

describe('FLOMO_ALLOW_REGISTRATION=0 时关闭注册', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext({ FLOMO_ALLOW_REGISTRATION: '0' });
  });

  after(async () => {
    await ctx.close();
  });

  it('注册 → 403 FORBIDDEN「当前已关闭注册」，且不创建用户', async () => {
    const response = await register(ctx.app, 'nobody01', PASSWORD);
    assert.equal(response.statusCode, 403);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const body = response.json() as ApiErrorBody;
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.message, '当前已关闭注册');
    assert.ok(extractSessionCookie(response.headers['set-cookie']) === null);

    const count = ctx.db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number | bigint };
    assert.equal(Number(count.c), 0);

    // 关闭的只是注册：登录仍正常工作（此处用户不存在，故为 401 而不是 403）
    const loginAttempt = await login(ctx.app, 'nobody01', PASSWORD);
    assert.equal(loginAttempt.statusCode, 401);
  });
});
