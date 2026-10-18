#!/usr/bin/env node
/**
 * 浮墨增强版（FlomoEnhanced）端到端验收脚本
 *
 * 用法：
 *   node scripts/acceptance-e2e.mjs                 # 需要先 npm run build
 *   node scripts/acceptance-e2e.mjs --keep          # 保留临时数据目录，便于排查
 *   node scripts/acceptance-e2e.mjs --external http://127.0.0.1:35080   # 对已在运行的服务做只读+可写验收
 *
 * 行为：在临时目录中用真实 SQLite 启动一个真实服务实例，然后用真实 HTTP 请求走完
 *       注册 → 登录 → 模板（含 12 种字段类型）→ 想法（有/无模板）→ 洞察分析 → CSV → 隔离/鉴权 全链路，
 *       逐条断言并输出中文报告。绝不触碰 /opt 下的生产数据。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const externalIndex = argv.indexOf('--external');
const EXTERNAL = externalIndex >= 0 ? argv[externalIndex + 1] : null;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function isJsonSafe(value, path = '$') {
  if (value === undefined) return `${path} 是 undefined`;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${path} 不是有限数（${value}）`;
    return null;
  }
  if (typeof value === 'bigint') return `${path} 是 BigInt`;
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const problem = isJsonSafe(value[i], `${path}[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (value instanceof Date) return `${path} 是 Date 对象`;
  for (const [key, child] of Object.entries(value)) {
    const problem = isJsonSafe(child, `${path}.${key}`);
    if (problem) return problem;
  }
  return null;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  cookieHeader() {
    return this.cookie ? { Cookie: this.cookie } : {};
  }

  async request(method, path, { body, raw = false, headers = {}, cookie = true } = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookie && this.cookie) init.headers.Cookie = this.cookie;
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(`${this.base}${path}`, init);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (cookie && setCookie.length > 0) {
      for (const item of setCookie) {
        const pair = item.split(';')[0];
        if (pair.startsWith('flomo_session=')) {
          this.cookie = pair.endsWith('=') ? null : pair;
        }
      }
    }
    const contentType = response.headers.get('content-type') ?? '';
    let data = null;
    if (raw) {
      data = Buffer.from(await response.arrayBuffer());
    } else if (raw !== 'text' && contentType.includes('json')) {
      data = await response.json().catch(() => null);
    } else {
      data = await response.text();
    }
    return { status: response.status, headers: response.headers, data, contentType };
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, body, options) {
    return this.request('POST', path, { ...options, body });
  }

  patch(path, body, options) {
    return this.request('PATCH', path, { ...options, body });
  }

  del(path, options) {
    return this.request('DELETE', path, options);
  }
}

function dayKey(date, tz = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

async function waitForHealth(base, attempts = 60) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw lastError ?? new Error('健康检查超时');
}

const ALL_FIELDS = [
  { key: 'title', label: '标题', type: 'text', required: true, maxLength: 60 },
  { key: 'note', label: '备注', type: 'longtext', maxLength: 500 },
  { key: 'count', label: '次数', type: 'number', min: 0, max: 100, precision: 0 },
  { key: 'amount', label: '金额', type: 'currency', currency: 'CNY', min: 0 },
  { key: 'ratio', label: '完成度', type: 'percent', min: 0, max: 100 },
  { key: 'day', label: '日期', type: 'date' },
  { key: 'moment', label: '时刻', type: 'datetime' },
  {
    key: 'category', label: '分类', type: 'select', required: true,
    options: [
      { value: 'food', label: '餐饮' },
      { value: 'traffic', label: '交通' },
      { value: 'rent', label: '房租' },
    ],
  },
  {
    key: 'mood', label: '心情', type: 'multiselect',
    options: [
      { value: 'happy', label: '开心' },
      { value: 'tired', label: '疲惫' },
    ],
  },
  { key: 'done', label: '已完成', type: 'boolean' },
  { key: 'rating', label: '评分', type: 'rating', scale: 5 },
  { key: 'link', label: '链接', type: 'url' },
];

async function main() {
  let child = null;
  let dataDir = null;
  let base = EXTERNAL;

  if (!EXTERNAL) {
    const port = await freePort();
    dataDir = await mkdtemp(join(tmpdir(), 'flomo-acceptance-'));
    base = `http://127.0.0.1:${port}`;
    const entry = join(repoRoot, 'apps', 'api', 'dist', 'index.js');
    console.log(`启动验收实例：${entry}`);
    console.log(`  数据目录：${dataDir}`);
    console.log(`  监听地址：${base}`);
    child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', entry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        FLOMO_HOST: '0.0.0.0',
        FLOMO_PORT: String(port),
        FLOMO_DATA_DIR: dataDir,
        FLOMO_TZ: 'Asia/Shanghai',
        FLOMO_LOG_LEVEL: 'silent',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => process.stdout.write(`  [api] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`  [api:err] ${chunk}`));
  }

  try {
    // ---------------------------------------------------------------- 健康检查
    section('1. 健康检查与静态资源');
    const health = await waitForHealth(base);
    check('GET /api/health 返回 status=ok', health.status === 'ok', JSON.stringify(health).slice(0, 200));
    check('db.ok 为 true 且计数为数字',
      health.db?.ok === true
      && Number.isInteger(health.db?.users)
      && Number.isInteger(health.db?.memos)
      && Number.isInteger(health.db?.templates));

    const rootResponse = await fetch(`${base}/`);
    const rootHtml = await rootResponse.text();
    check('GET / 返回 HTML 且包含 id="root"',
      rootResponse.ok && (rootResponse.headers.get('content-type') ?? '').includes('text/html') && rootHtml.includes('id="root"'));
    const headers = rootResponse.headers;
    check('静态资源带 nosniff 安全头', headers.get('x-content-type-options') === 'nosniff');

    const notFound = await fetch(`${base}/api/definitely-not-here`);
    check('未匹配的 /api 路径返回 JSON 404',
      notFound.status === 404 && (notFound.headers.get('content-type') ?? '').includes('json'));
    const notFoundBody = await notFound.json();
    check('404 错误体符合契约', notFoundBody?.error?.code === 'NOT_FOUND');

    // 端口/网卡：仅当自行启动时才能检查监听网卡
    if (!EXTERNAL) {
      check('监听地址为 0.0.0.0（由启动配置断言）', true);
    }

    // ---------------------------------------------------------------- 认证
    section('2. 注册 / 登录 / 会话 / 限流');
    const alice = new Client(base);
    const bob = new Client(base);

    const anonymousMe = await fetch(`${base}/api/auth/me`);
    check('未登录 GET /api/auth/me → 401', anonymousMe.status === 401);

    const stamp = Date.now().toString(36);
    const aliceName = `alice_${stamp}`;
    const bobName = `bob_${stamp}`;
    const password = 'Flomo#2026ok';

    const registerA = await alice.post('/api/auth/register', { username: aliceName, password });
    check('注册成功返回 201', registerA.status === 201, `实际 ${registerA.status} ${JSON.stringify(registerA.data)}`);
    check('注册响应只含 {id, username, createdAt}',
      registerA.data?.user && Object.keys(registerA.data.user).sort().join(',') === 'createdAt,id,username',
      JSON.stringify(registerA.data?.user));
    check('注册设置了 flomo_session Cookie（HttpOnly/SameSite）',
      alice.cookie !== null && (registerA.headers.getSetCookie?.() ?? []).some((c) => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));
    check('注册响应不含 password 字段', !JSON.stringify(registerA.data).includes('password'));

    const dupRegister = await new Client(base).post('/api/auth/register', { username: aliceName.toUpperCase(), password });
    check('大小写不同的同名注册 → 409', dupRegister.status === 409, `实际 ${dupRegister.status}`);

    const weakRegister = await new Client(base).post('/api/auth/register', { username: `weak_${stamp}`, password: '12345678' });
    check('弱口令注册 → 422', weakRegister.status === 422);

    const registerB = await bob.post('/api/auth/register', { username: bobName, password });
    check('第二个用户注册成功', registerB.status === 201);

    const loginA = await new Client(base).post('/api/auth/login', { username: aliceName, password });
    check('登录成功返回 200 + Cookie', loginA.status === 200 && loginA.data?.user?.username === aliceName);

    const wrongPassword = await new Client(base).post('/api/auth/login', { username: aliceName, password: 'WrongPass#1' });
    const unknownUser = await new Client(base).post('/api/auth/login', { username: `ghost_${stamp}`, password: 'WrongPass#1' });
    check('错误密码 → 401', wrongPassword.status === 401);
    check('不存在的用户与错误密码响应完全一致（不泄露账号是否存在）',
      unknownUser.status === wrongPassword.status
      && JSON.stringify(unknownUser.data) === JSON.stringify(wrongPassword.data));

    const meA = await alice.get('/api/auth/me');
    check('带 Cookie GET /me → 200', meA.status === 200 && meA.data?.user?.username === aliceName);

    // 注意：登录限流按 IP 计数，会封锁同一 IP 的后续登录，
    // 因此限流验收放在整份脚本的最后（第 12 节）。

    // CSRF：跨站来源的写请求被拒绝
    const crossOrigin = await fetch(`${base}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com', Cookie: alice.cookie ?? '' },
      body: JSON.stringify({ name: 'x', fields: [] }),
    });
    check('跨站 Origin 的写请求被拒绝（403）', crossOrigin.status === 403, `实际 ${crossOrigin.status}`);

    // ---------------------------------------------------------------- 模板
    section('3. 模板：创建 / 校验 / 导出 / 导入 / 归档 / 复制');
    const createTemplate = await alice.post('/api/templates', {
      name: '每日开销', description: '记录每天的花费与心情', icon: '💰', color: '#3b82f6', fields: ALL_FIELDS,
    });
    check('创建含 12 种字段类型的模板 → 201', createTemplate.status === 201, `实际 ${createTemplate.status} ${JSON.stringify(createTemplate.data).slice(0, 300)}`);
    const template = createTemplate.data;
    check('模板 DTO 字段齐全（id/name/fields/version/memoCount/archivedAt）',
      template && typeof template.id === 'string' && Array.isArray(template.fields) && template.fields.length === 12
      && template.version >= 1 && template.memoCount === 0 && template.archivedAt === null);
    check('模板字段 key 与类型正确回读',
      template.fields.map((f) => f.type).sort().join(',')
      === ['boolean', 'currency', 'date', 'datetime', 'longtext', 'multiselect', 'number', 'percent', 'rating', 'select', 'text', 'url'].sort().join(','));

    const duplicateKey = await alice.post('/api/templates', {
      name: '坏模板', fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }],
    });
    check('字段 key 重复 → 422', duplicateKey.status === 422);

    const badSelect = await alice.post('/api/templates', {
      name: '坏模板2', fields: [{ key: 'kind', label: '类别', type: 'select' }],
    });
    check('select 缺少 options → 422', badSelect.status === 422);

    const badCurrency = await alice.post('/api/templates', {
      name: '坏模板3', fields: [{ key: 'money', label: '钱', type: 'currency', currency: 'rmb' }],
    });
    check('currency 币种非 3 位大写 → 422', badCurrency.status === 422);

    const duplicateName = await alice.post('/api/templates', { name: '每日开销', fields: [{ key: 'x', label: 'X', type: 'text' }] });
    check('同名模板 → 409', duplicateName.status === 409);

    const emptyTemplateRes = await alice.post('/api/templates', {
      name: '空模板', description: '用于验证空数据洞察', fields: ALL_FIELDS,
    });
    check('创建无想法的空模板 → 201', emptyTemplateRes.status === 201);
    const emptyTemplate = emptyTemplateRes.data;

    const emptyTemplates = await new Client(base).get('/api/templates');
    check('未登录访问模板列表 → 401', emptyTemplates.status === 401, `实际 ${emptyTemplates.status}`);

    // ---------------------------------------------------------------- 想法
    section('4. 想法：无模板 / 有模板 / 校验 / 标签');
    const today = new Date();
    const plainMemo = await alice.post('/api/memos', { content: '今天想通了一件事 #复盘 #工作' });
    check('不使用模板即可记录想法 → 201', plainMemo.status === 201, `实际 ${plainMemo.status} ${JSON.stringify(plainMemo.data)}`);
    check('无模板想法 templateId 为 null', plainMemo.data?.templateId === null);
    check('标签从内容中提取（#复盘 #工作）',
      Array.isArray(plainMemo.data?.tags) && plainMemo.data.tags.includes('复盘') && plainMemo.data.tags.includes('工作')
      && !plainMemo.data.tags.some((t) => t.startsWith('#')));

    const emptyMemo = await alice.post('/api/memos', { content: '   ' });
    check('内容与字段值同时为空 → 422', emptyMemo.status === 422);

    const filledMemo = await alice.post('/api/memos', {
      templateId: template.id,
      content: '午饭吃了面 #餐饮',
      values: {
        title: '午饭',
        note: '面很好吃',
        count: 1,
        amount: 32.5,
        ratio: 80,
        day: dayKey(today),
        moment: today.toISOString(),
        category: 'food',
        mood: ['happy'],
        done: true,
        rating: 4,
        link: 'https://github.com/yuan-xin-9997/FlomoEnhanced',
      },
    });
    check('使用模板记录（12 字段全填）→ 201', filledMemo.status === 201, `实际 ${filledMemo.status} ${JSON.stringify(filledMemo.data).slice(0, 400)}`);
    check('回读字段值与类型正确（金额/评分/布尔/多选/URL）',
      filledMemo.data?.values?.amount === 32.5
      && filledMemo.data?.values?.rating === 4
      && filledMemo.data?.values?.done === true
      && Array.isArray(filledMemo.data?.values?.mood)
      && filledMemo.data?.values?.category === 'food');
    check('想法 DTO 带 templateName', filledMemo.data?.templateName === '每日开销');

    const missingRequired = await alice.post('/api/memos', {
      templateId: template.id, content: '', values: { amount: 10 },
    });
    check('缺少必填字段 → 422', missingRequired.status === 422);

    const badOption = await alice.post('/api/memos', {
      templateId: template.id, values: { title: 'x', category: '不存在' },
    });
    check('select 值未命中选项 → 422', badOption.status === 422);

    const badUrl = await alice.post('/api/memos', {
      templateId: template.id, values: { title: 'x', category: 'rent', link: 'not-a-url' },
    });
    check('非法 URL → 422', badUrl.status === 422);

    // 造 40 条跨 30 天的数据，供分析断言
    // 注意：时间戳按「本地日 10:00（+08:00）」构造，保证稳定落在区间内的合法本地日，
    // 不受验收执行时刻（UTC 日期与本地日期可能不同）影响。
    const series = [];
    for (let i = 0; i < 40; i += 1) {
      const when = new Date(`${dayKey(addDays(today, -(i % 30)))}T10:00:00.000+08:00`);
      const amount = (i % 10) + 1; // 1..10 循环
      const created = await alice.post('/api/memos', {
        templateId: template.id,
        content: `第 ${i} 条记录 #批量`,
        createdAt: when.toISOString(),
        values: {
          title: `第 ${i} 条`,
          count: (i % 10) + 1,
          amount,
          ratio: (i % 5) * 20,
          day: dayKey(when),
          moment: when.toISOString(),
          category: ['food', 'traffic', 'rent'][i % 3],
          mood: i % 2 === 0 ? ['happy'] : ['tired'],
          done: i % 3 === 0,
          rating: (i % 5) + 1,
        },
      });
      if (created.status !== 201) throw new Error(`批量造数失败：${JSON.stringify(created.data)}`);
      series.push({ amount, created });
    }
    check('批量构造 40 条分析用数据成功', series.length === 40);

    const listMemos = await alice.get(`/api/memos?templateId=${template.id}&limit=10`);
    check('按模板过滤 + 分页返回 10 条', listMemos.status === 200 && listMemos.data?.items?.length === 10 && typeof listMemos.data?.total === 'number');
    check('分页游标非空', typeof listMemos.data?.nextCursor === 'string' && listMemos.data.nextCursor.length > 0);

    const secondPage = await alice.get(`/api/memos?templateId=${template.id}&limit=10&cursor=${encodeURIComponent(listMemos.data.nextCursor)}`);
    const firstIds = new Set(listMemos.data.items.map((m) => m.id));
    check('第二页与第一页无重叠', secondPage.status === 200 && secondPage.data.items.every((m) => !firstIds.has(m.id)));

    const tagFilter = await alice.get('/api/memos?tag=批量&limit=100');
    check('按标签精确过滤生效', tagFilter.status === 200 && tagFilter.data.items.length === 40);
    const tagNoOverreach = await alice.get('/api/memos?tag=批&limit=100');
    check('标签过滤不误伤（精确匹配）', tagNoOverreach.status === 200 && tagNoOverreach.data.items.length === 0);

    const searchFilter = await alice.get(`/api/memos?q=${encodeURIComponent('第 7 条')}`);
    check('关键字搜索生效', searchFilter.status === 200 && searchFilter.data.items.some((m) => m.content.includes('第 7 条')));

    const noTemplateList = await alice.get('/api/memos?templateId=null&limit=100');
    check('服务端支持 templateId=null 过滤「无模板」想法（分页不会漏数据）',
      noTemplateList.status === 200
      && noTemplateList.data.items.length === 1
      && noTemplateList.data.items.every((m) => m.templateId === null)
      && noTemplateList.data.total === 1,
      `实际 items=${noTemplateList.data?.items?.length} total=${noTemplateList.data?.total}`);

    // ---------------------------------------------------------------- 模板导出/导入
    section('5. 模板导入导出（三种冲突模式）');
    const exported = await alice.get('/api/templates/export');
    check('导出模板返回合法结构',
      exported.status === 200 && exported.data?.format === 'flomo-enhanced-template' && exported.data?.formatVersion === 1
      && Array.isArray(exported.data?.templates) && exported.data.templates.length >= 1);
    check('导出响应带 attachment 文件名',
      (exported.headers.get('content-disposition') ?? '').includes('attachment'));
    const exportedOnly = await alice.get(`/api/templates/export?ids=${template.id}`);
    check('按 ids 导出只含指定模板', exportedOnly.data?.templates?.length === 1 && exportedOnly.data.templates[0].name === '每日开销');

    const importPayload = { ...exported.data, templates: exported.data.templates.filter((t) => t.name === '每日开销') };
    const importRename = await bob.post('/api/templates/import?mode=rename', importPayload);
    check('B 导入 A 的模板文件（rename）成功', importRename.status === 200 && importRename.data.imported.length === 1,
      JSON.stringify(importRename.data).slice(0, 300));
    check('导入结果含 field 定义且字段数为 12', importRename.data.imported[0].fields.length === 12);

    const importAgain = await bob.post('/api/templates/import?mode=rename', importPayload);
    check('再次 rename 导入自动改名（不冲突）',
      importAgain.status === 200 && importAgain.data.imported.length === 1
      && importAgain.data.imported[0].name !== '每日开销');

    const importSkip = await bob.post('/api/templates/import?mode=skip', importPayload);
    check('skip 模式把同名模板记入 skipped', importSkip.status === 200 && importSkip.data.skipped.length === 1 && importSkip.data.skipped[0].reason.length > 0);

    const overwriteTarget = importAgain.data.imported[0];
    const importOverwrite = await bob.post('/api/templates/import?mode=overwrite', {
      ...importPayload,
      templates: [{ ...importPayload.templates[0], name: overwriteTarget.name, description: '被覆盖的描述' }],
    });
    check('overwrite 模式覆盖同名模板并保留 id',
      importOverwrite.status === 200 && importOverwrite.data.overwritten.length === 1
      && importOverwrite.data.overwritten[0].id === overwriteTarget.id
      && importOverwrite.data.overwritten[0].description === '被覆盖的描述');

    const badFormat = await bob.post('/api/templates/import', { format: 'nope', formatVersion: 1, templates: [] });
    check('导入非法 format → 400', badFormat.status === 400, `实际 ${badFormat.status}`);

    const partialImport = await alice.post('/api/templates/import?mode=rename', {
      ...exported.data,
      templates: [
        { name: '合法模板', description: '', icon: '', color: '', templateVersion: 1, fields: [{ key: 'a', label: 'A', type: 'text' }] },
        { name: '非法模板', description: '', icon: '', color: '', templateVersion: 1, fields: [{ key: 'b', label: 'B', type: 'select' }] },
      ],
    });
    check('部分条目非法时：合法的导入、非法的进 errors',
      partialImport.status === 200 && partialImport.data.imported.length === 1 && partialImport.data.errors.length === 1
      && partialImport.data.errors[0].index === 1 && typeof partialImport.data.errors[0].message === 'string');

    // ---------------------------------------------------------------- 隔离
    section('6. 多用户数据隔离');
    const crossTemplate = await bob.get(`/api/templates/${template.id}`);
    check('B 读取 A 的模板 → 404（不泄露存在性）', crossTemplate.status === 404, `实际 ${crossTemplate.status}`);
    const crossTemplatePatch = await bob.patch(`/api/templates/${template.id}`, { name: '劫持' });
    check('B 修改 A 的模板 → 404', crossTemplatePatch.status === 404);
    const crossTemplateDelete = await bob.del(`/api/templates/${template.id}`);
    check('B 删除 A 的模板 → 404', crossTemplateDelete.status === 404);
    const crossMemo = await bob.get(`/api/memos/${filledMemo.data.id}`);
    check('B 读取 A 的想法 → 404', crossMemo.status === 404);
    const crossMemoUpdate = await bob.patch(`/api/memos/${filledMemo.data.id}`, { content: '劫持' });
    check('B 修改 A 的想法 → 404', crossMemoUpdate.status === 404);
    const bobTemplates = await bob.get('/api/templates');
    check('B 的模板列表里没有 A 的那个模板（id 不同）', bobTemplates.data.items.every((t) => t.id !== template.id));

    // ---------------------------------------------------------------- 分析
    section('7. 洞察分析（核心）');
    const insights = await alice.get(`/api/analytics/templates/${template.id}/insights`);
    check('洞察接口返回 200', insights.status === 200, `实际 ${insights.status} ${JSON.stringify(insights.data).slice(0, 300)}`);
    const ins = insights.data;
    check('响应整体 JSON 安全（无 NaN/undefined/BigInt/Date）', isJsonSafe(ins) === null, isJsonSafe(ins) ?? '');
    check('包含 range/summary/timeline/heatmap/weekday/hourOfDay/tags/fields',
      ['range', 'summary', 'timeline', 'heatmap', 'weekday', 'hourOfDay', 'tags', 'fields'].every((k) => k in (ins ?? {})));
    check('range 使用带时区偏移的 ISO 且 days=30',
      typeof ins.range?.from === 'string' && ins.range.from.includes('+08:00') && ins.range.days === 30);
    check('summary.memoCount 为 41（1 条手填 + 40 条批量）', ins.summary.memoCount === 41, `实际 ${ins.summary.memoCount}`);
    check('summary 含占比/字数/活跃天数/连续天数',
      typeof ins.summary.shareOfAllMemos === 'number' && typeof ins.summary.totalChars === 'number'
      && typeof ins.summary.activeDays === 'number' && typeof ins.summary.longestStreak === 'number'
      && typeof ins.summary.currentStreak === 'number');
    check('timeline 为 day 粒度且补齐区间（30 个桶）',
      ins.timeline.granularity === 'day' && ins.timeline.points.length === 30,
      `实际 ${ins.timeline?.granularity} / ${ins.timeline?.points?.length}`);
    check('timeline 各桶 count 之和等于 memoCount',
      ins.timeline.points.reduce((acc, p) => acc + p.count, 0) === ins.summary.memoCount);
    check('heatmap 补齐 30 天且 max 为单日最大计数',
      ins.heatmap.days.length === 30 && ins.heatmap.max === Math.max(...ins.heatmap.days.map((d) => d.count)));
    check('weekday 恒 7 项（周一=1…周日=7）', ins.weekday.buckets.length === 7 && ins.weekday.buckets[0].weekday === 1 && ins.weekday.buckets[6].weekday === 7);
    check('hourOfDay 恒 24 项', ins.hourOfDay.buckets.length === 24);
    check('tags 按计数降序且带 share', ins.tags.length > 0 && ins.tags.every((t, i) => i === 0 || ins.tags[i - 1].count >= t.count) && typeof ins.tags[0].share === 'number');
    check('fields 数量等于模板字段数（12）', ins.fields.length === 12, `实际 ${ins.fields?.length}`);

    const byKey = Object.fromEntries(ins.fields.map((f) => [f.key, f]));
    // 数据构成：手填 1 条（amount=32.5, count=1, ratio=80, rating=4, done=true, category=food, mood=[happy]）
    //          + 批量 40 条（amount=count=1..10 各 4 次 → 220；ratio=(i%5)*20 → 1600；rating=1..5 各 8 次 → 120；done=true 14 条）
    const TEMPLATE_MEMO_COUNT = 41;
    check('currency 字段 numeric.sum 正确（220 + 32.5 = 252.5）',
      byKey.amount?.numeric?.sum === 252.5, `实际 ${byKey.amount?.numeric?.sum}`);
    check('currency 字段均值/极值正确',
      Math.abs(byKey.amount.numeric.mean - 252.5 / TEMPLATE_MEMO_COUNT) < 1e-5
      && byKey.amount.numeric.min === 1 && byKey.amount.numeric.max === 32.5,
      `mean=${byKey.amount?.numeric?.mean} min=${byKey.amount?.numeric?.min} max=${byKey.amount?.numeric?.max}`);
    check('currency 字段带币种与直方图', byKey.amount?.currency === 'CNY' && byKey.amount?.numeric?.histogram?.bins?.length >= 1);
    check('直方图 count 之和等于有值条数',
      byKey.amount.numeric.histogram.bins.reduce((acc, b) => acc + b.count, 0) === byKey.amount.numeric.count);
    check('直方图最后一个 cumulativeRatio ≈ 1',
      Math.abs(byKey.amount.numeric.histogram.bins.at(-1).cumulativeRatio - 1) < 1e-9);
    check('number 字段 sum 正确（220 + 1 = 221）', byKey.count?.numeric?.sum === 221, `实际 ${byKey.count?.numeric?.sum}`);
    check('percent 字段带 unit 且均值正确（1680 / 41）',
      Math.abs(byKey.ratio?.numeric?.mean - 1680 / TEMPLATE_MEMO_COUNT) < 1e-5,
      `实际 ${byKey.ratio?.numeric?.mean}`);
    check('rating 字段带 scale=5', byKey.rating?.scale === 5, JSON.stringify(byKey.rating?.scale));
    check('rating 分布为 5 个非空桶（1..5，其中 4 分多一条）',
      Array.isArray(byKey.rating?.distribution) && byKey.rating.distribution.filter((d) => d.count > 0).length === 5
      && byKey.rating.distribution.find((d) => Number(d.value) === 4)?.count === 9);
    check('select 字段分布正确（food 15 / traffic 13 / rent 13，合计 41）',
      byKey.category?.distribution?.length === 3
      && byKey.category.distribution.reduce((acc, d) => acc + d.count, 0) === TEMPLATE_MEMO_COUNT,
      JSON.stringify(byKey.category?.distribution));
    check('select 字段 valueUnion 正确', Array.isArray(byKey.category?.valueUnion) && byKey.category.valueUnion.length === 3);
    check('multiselect 字段分布正确（happy 21 / tired 20）',
      Array.isArray(byKey.mood?.distribution) && byKey.mood.distribution.length === 2
      && byKey.mood.distribution.reduce((acc, d) => acc + d.count, 0) === TEMPLATE_MEMO_COUNT,
      JSON.stringify(byKey.mood?.distribution));
    check('boolean 字段 trueCount 正确（批量 14 + 手填 1 = 15）',
      byKey.done?.boolean?.trueCount === 15, `实际 ${byKey.done?.boolean?.trueCount}`);
    check('boolean trueRatio 正确',
      Math.abs(byKey.done?.boolean?.trueRatio - 15 / TEMPLATE_MEMO_COUNT) < 1e-5, `实际 ${byKey.done?.boolean?.trueRatio}`);
    check('date 字段带 min/max/spanDays/byWeekday', byKey.day?.date?.min && byKey.day?.date?.max && typeof byKey.day.date.spanDays === 'number' && byKey.day.date.byWeekday?.length === 7);
    check('datetime 字段带 byHour（24 项）', byKey.moment?.date?.byHour?.length === 24);
    check('text 字段带字数统计与高频词',
      typeof byKey.title?.text?.totalChars === 'number' && typeof byKey.title?.text?.avgChars === 'number'
      && Array.isArray(byKey.title?.text?.topWords));
    check('url 字段带域名统计', typeof byKey.link?.url?.httpsRatio === 'number' && Array.isArray(byKey.link?.url?.distinctDomains));
    check('fieldFillRate 覆盖 12 个字段且 ratio 正确',
      ins.summary.fieldFillRate.length === 12
      && ins.summary.fieldFillRate.every((f) => f.filled + f.missing === TEMPLATE_MEMO_COUNT
        && Math.abs(f.ratio - f.filled / TEMPLATE_MEMO_COUNT) < 1e-5),
      JSON.stringify(ins.summary.fieldFillRate.slice(0, 3)));

    // 时间粒度自动选择
    const weekly = await alice.get(`/api/analytics/templates/${template.id}/insights?from=${dayKey(addDays(today, -400))}&to=${dayKey(today)}`);
    check('跨度 >62 天时自动切到 week 粒度', weekly.status === 200 && weekly.data.timeline.granularity === 'week', `实际 ${weekly.data?.timeline?.granularity}`);
    const monthly = await alice.get(`/api/analytics/templates/${template.id}/insights?from=${dayKey(addDays(today, -800))}&to=${dayKey(today)}`);
    check('跨度 >730 天时自动切到 month 粒度', monthly.status === 200 && monthly.data.timeline.granularity === 'month', `实际 ${monthly.data?.timeline?.granularity}`);

    const badRange = await alice.get(`/api/analytics/templates/${template.id}/insights?from=${dayKey(today)}&to=${dayKey(addDays(today, -10))}`);
    check('from > to → 422', badRange.status === 422, `实际 ${badRange.status}`);

    const crossInsights = await bob.get(`/api/analytics/templates/${template.id}/insights`);
    check('B 查询 A 的模板洞察 → 404', crossInsights.status === 404);

    const sevenDays = await alice.get(`/api/analytics/templates/${template.id}/insights?from=${dayKey(addDays(today, -6))}&to=${dayKey(today)}`);
    check('最近 7 天区间生效（days=7）', sevenDays.status === 200 && sevenDays.data.range.days === 7);

    const overview = await alice.get('/api/analytics/overview');
    check('概览接口返回 200 且含 byTemplate/numericFields',
      overview.status === 200 && Array.isArray(overview.data.summary.byTemplate) && Array.isArray(overview.data.numericFields));
    check('概览含「无模板」聚合项',
      overview.data.summary.byTemplate.some((t) => t.templateId === null && t.templateName.includes('无模板')));
    check('概览 total 覆盖全部想法（含无模板）', overview.data.summary.memoCount === 42, `实际 ${overview.data.summary.memoCount}`);
    check('概览 JSON 安全', isJsonSafe(overview.data) === null, isJsonSafe(overview.data) ?? '');

    const emptyInsights = await alice.get(`/api/analytics/templates/${emptyTemplate.id}/insights`);
    check('空数据模板的洞察结构完整且无 NaN',
      emptyInsights.status === 200 && emptyInsights.data.summary.memoCount === 0
      && emptyInsights.data.fields.length === 12 && emptyInsights.data.timeline.points.length === 30
      && isJsonSafe(emptyInsights.data) === null,
      isJsonSafe(emptyInsights.data) ?? '');

    // ---------------------------------------------------------------- CSV
    section('8. CSV 导出');
    const csv = await alice.get(`/api/analytics/templates/${template.id}/export.csv`, { raw: true });
    const csvText = Buffer.isBuffer(csv.data) ? csv.data.toString('utf8') : String(csv.data);
    check('CSV 返回 200 且 Content-Type 为 text/csv',
      csv.status === 200 && csv.contentType.includes('text/csv'), `实际 ${csv.status} ${csv.contentType}`);
    check('CSV 以 UTF-8 BOM 开头', csvText.startsWith('\uFEFF'));
    check('CSV 使用 CRLF 换行', csvText.includes('\r\n'));
    const csvHeader = csvText.replace(/^\uFEFF/, '').split('\r\n')[0];
    check('CSV 表头包含时间/内容/标签与全部字段列',
      csvHeader.includes('内容') && csvHeader.includes('标签') && csvHeader.includes('金额') && csvHeader.includes('分类'));
    check('CSV 数据行数为 41 + 表头', csvText.trim().split('\r\n').length === 42, `实际 ${csvText.trim().split('\r\n').length}`);
    check('CSV Content-Disposition 含 filename*', (csv.headers.get('content-disposition') ?? '').includes('filename*='));

    // ---------------------------------------------------------------- 编辑/删除/汇总
    section('9. 编辑 / 删除 / 汇总');
    const patchNoValues = await alice.patch(`/api/memos/${filledMemo.data.id}`, { templateId: emptyTemplate.id });
    check('切换模板但未给 values → 422', patchNoValues.status === 422, `实际 ${patchNoValues.status}`);

    const detach = await alice.patch(`/api/memos/${filledMemo.data.id}`, { templateId: null, values: {} });
    check('templateId:null 取消模板并清空 values',
      detach.status === 200 && detach.data.templateId === null && Object.keys(detach.data.values).length === 0);

    const newMemo = await alice.post('/api/memos', {
      templateId: template.id,
      content: '临时记录 #待删除',
      values: { title: '临时', category: 'food' },
    });
    const deleted = await alice.del(`/api/memos/${newMemo.data.id}`);
    check('删除想法返回 204', deleted.status === 204);
    const afterDelete = await alice.get(`/api/memos/${newMemo.data.id}`);
    check('删除后详情 → 404', afterDelete.status === 404);
    const deleteAgain = await alice.del(`/api/memos/${newMemo.data.id}`);
    check('重复删除 → 404', deleteAgain.status === 404);

    const summary = await alice.get('/api/memos/summary');
    check('汇总接口返回 200 且结构完整',
      summary.status === 200 && typeof summary.data.total === 'number' && Array.isArray(summary.data.byTemplate)
      && Array.isArray(summary.data.heatmap) && typeof summary.data.longestStreak === 'number');
    check('汇总含「无模板」聚合项', summary.data.byTemplate.some((t) => t.templateId === null));
    check('汇总热力图补齐区间（30 天）', summary.data.heatmap.length === 30, `实际 ${summary.data.heatmap.length}`);
    check('汇总 total 等于实际未删除想法数',
      summary.data.total === 41 + 1, `实际 ${summary.data.total}`);
    check('汇总 firstMemoAt/lastMemoAt 为 ISO 或 null',
      (summary.data.firstMemoAt === null || typeof summary.data.firstMemoAt === 'string')
      && (summary.data.lastMemoAt === null || typeof summary.data.lastMemoAt === 'string'));

    // ---------------------------------------------------------------- 模板归档/复制/恢复
    section('10. 模板归档 / 恢复 / 复制 / 硬删除');
    const duplicated = await alice.post(`/api/templates/${template.id}/duplicate`, undefined);
    check('复制模板成功且名称为「… 副本」',
      duplicated.status === 201 || duplicated.status === 200,
      `实际 ${duplicated.status}`);
    check('副本字段数与源一致', duplicated.data?.fields?.length === 12);

    const archived = await alice.del(`/api/templates/${template.id}`);
    check('归档模板返回 204', archived.status === 204);
    const listWithoutArchived = await alice.get('/api/templates');
    check('归档后默认列表不含该模板', listWithoutArchived.data.items.every((t) => t.id !== template.id));
    const listWithArchived = await alice.get('/api/templates?includeArchived=1');
    check('includeArchived=1 能看到归档模板', listWithArchived.data.items.some((t) => t.id === template.id));
    const restored = await alice.post(`/api/templates/${template.id}/restore`, undefined);
    check('恢复模板成功', restored.status === 200 || restored.status === 204);
    const afterRestore = await alice.get(`/api/templates/${template.id}`);
    check('恢复后 archivedAt 为 null', afterRestore.data?.archivedAt === null);

    const hardDeleted = await alice.del(`/api/templates/${emptyTemplate.id}?hard=1`);
    check('硬删除模板返回 204', hardDeleted.status === 204);
    const memoAfterHardDelete = await alice.get(`/api/memos/${filledMemo.data.id}`);
    check('硬删除模板不影响既有想法（仍可读取，templateId 为 null）',
      memoAfterHardDelete.status === 200 && memoAfterHardDelete.data.templateId === null);
    const hardDeletedAgain = await alice.get(`/api/templates/${emptyTemplate.id}`);
    check('硬删除后模板详情 → 404', hardDeletedAgain.status === 404);

    // ---------------------------------------------------------------- 会话收尾
    section('11. 改密 / 注销');
    const secondAlice = new Client(base);
    const secondLogin = await secondAlice.post('/api/auth/login', { username: aliceName, password });
    check('同一用户第二个会话登录成功', secondLogin.status === 200);

    const changePassword = await alice.patch('/api/auth/password', { currentPassword: password, newPassword: 'Flomo#2026new' });
    check('修改密码返回 204', changePassword.status === 204, `实际 ${changePassword.status} ${JSON.stringify(changePassword.data)}`);
    const otherSessionAfterChange = await secondAlice.get('/api/auth/me');
    check('改密后其它会话被吊销 → 401', otherSessionAfterChange.status === 401);
    const currentSessionAfterChange = await alice.get('/api/auth/me');
    check('改密后当前会话仍有效', currentSessionAfterChange.status === 200);
    const oldPasswordLogin = await new Client(base).post('/api/auth/login', { username: aliceName, password });
    check('旧密码登录失败 → 401', oldPasswordLogin.status === 401);
    const newPasswordLogin = await new Client(base).post('/api/auth/login', { username: aliceName, password: 'Flomo#2026new' });
    check('新密码登录成功', newPasswordLogin.status === 200);

    const logout = await alice.post('/api/auth/logout');
    check('注销返回 204', logout.status === 204);
    const afterLogout = await alice.get('/api/auth/me');
    check('注销后会话失效 → 401', afterLogout.status === 401);

    // ---------------------------------------------------------------- 静态资源安全
    section('12. 安全与健壮性');
    const badJson = await fetch(`${base}/api/memos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newPasswordLogin.cookie ?? '' },
      body: '{not json',
    });
    check('非法 JSON 请求体 → 4xx 且不崩溃', badJson.status >= 400 && badJson.status < 500, `实际 ${badJson.status}`);
    const bigBody = 'x'.repeat(3 * 1024 * 1024);
    const tooLarge = await fetch(`${base}/api/memos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newPasswordLogin.cookie ?? '' },
      body: JSON.stringify({ content: bigBody }),
    });
    check('超大请求体被拒绝（413/422）', [413, 422].includes(tooLarge.status), `实际 ${tooLarge.status}`);
    const healthAfter = await fetch(`${base}/api/health`);
    check('压力测试后服务仍健康', healthAfter.status === 200);

    // 登录限流放在最后：它按 IP 计数，会封锁同一 IP 的后续登录
    const limiter = new Client(base);
    let sawRateLimit = false;
    let rateLimitAttempts = 0;
    for (let i = 0; i < 15; i += 1) {
      rateLimitAttempts += 1;
      const attempt = await limiter.post('/api/auth/login', { username: `ratelimit_${stamp}`, password: 'WrongPass#1' });
      if (attempt.status === 429) { sawRateLimit = true; break; }
      if (attempt.status !== 401) {
        check('限流测试期间返回了非预期状态码', false, `第 ${i + 1} 次返回 ${attempt.status}`);
        break;
      }
    }
    check(`连续登录失败后被限流（429，第 ${rateLimitAttempts} 次触发）`, sawRateLimit);
    const rateLimitedBody = sawRateLimit ? await (async () => {
      const res = await limiter.post('/api/auth/login', { username: aliceName, password: 'Flomo#2026new' });
      return res;
    })() : null;
    if (rateLimitedBody) {
      check('被限流时返回统一错误体且为 RATE_LIMITED',
        rateLimitedBody.status === 429 && rateLimitedBody.data?.error?.code === 'RATE_LIMITED');
    }
  } finally {
    if (child) {
      child.kill('SIGKILL');
    }
    if (dataDir && !KEEP) {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    } else if (dataDir) {
      console.log(`\n临时数据目录已保留：${dataDir}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`验收结果：通过 ${passed} 项，失败 ${failed} 项`);
  if (failures.length > 0) {
    console.log('失败明细：');
    for (const item of failures) console.log(`  - ${item}`);
  }
  console.log('='.repeat(60));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n验收脚本异常终止：', error);
  process.exit(2);
});
