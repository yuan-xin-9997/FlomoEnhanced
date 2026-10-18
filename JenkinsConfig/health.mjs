// 浮墨增强版（FlomoEnhanced）部署后的只读健康检查
//
// 由 JenkinsConfig/deploy.sh start 在部署目录下调用：node /opt/FlomoEnhanced/JenkinsConfig/health.mjs
// 校验内容：
//   1. GET /api/health -> HTTP 200 且 { status: 'ok', db: { ok: true } }
//   2. GET /          -> HTTP 200、text/html、且包含前端挂载点 id="root"
// 严格只读：本脚本绝不注册用户、绝不写入任何数据（/api/health 本身也是只读接口）。
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const envFile = '/opt/FlomoEnhanced/.env';
const env = await readFile(envFile, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});

const rawPort = env.match(/^FLOMO_PORT=(\d+)\s*$/m)?.[1] ?? '35080';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`.env 中的 FLOMO_PORT 非法：${rawPort}（应为 1..65535 的整数）`);
}
const base = `http://127.0.0.1:${port}`;

const maxAttempts = 45;
let failure;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error(`/api/health 返回 HTTP ${health.status}`);
    const body = await health.json();
    if (body?.status !== 'ok') throw new Error(`/api/health 的 status 不是 ok：${JSON.stringify(body?.status)}`);
    if (body?.db?.ok !== true) throw new Error(`/api/health 显示数据库不可用：db = ${JSON.stringify(body?.db)}`);

    const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
    if (!page.ok) throw new Error(`首页返回 HTTP ${page.status}`);
    const contentType = page.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) throw new Error(`首页 Content-Type 不是 HTML：${contentType}`);
    const html = await page.text();
    if (!html.includes('id="root"')) throw new Error('首页 HTML 未包含前端挂载点 id="root"');

    console.log(`PASS: 服务在 127.0.0.1:${port} 就绪（/api/health 为 ok、数据库可用；首页含挂载点 id="root"）`);
    console.log(`PASS: 对外地址 http://192.168.0.111:${port}`);
    process.exit(0);
  } catch (error) {
    failure = error;
    if (attempt === maxAttempts) break;
    await delay(1000);
  }
}

throw new Error(`健康检查在 ${maxAttempts} 次尝试后仍失败，最后一次错误：${failure?.message ?? failure}`);
