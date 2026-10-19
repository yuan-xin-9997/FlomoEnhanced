#!/usr/bin/env node
/**
 * iOS 端验收数据播种脚本（PM 用）。
 *
 * 对已部署服务创建专用的验收账号（iosaccept）、一个包含 12 种字段类型的模板，
 * 以及跨越最近 45 天的若干条记录；随后抓取洞察/概览/列表等响应样本，
 * 用于核对 iOS Swift 模型的类型假设（docs/IOS.md §3.2）。
 *
 * 用法：
 *   node scripts/ios-seed.mjs [baseUrl] [outDir]
 * 默认：baseUrl = http://192.168.0.111:35080，outDir = %TEMP%
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://192.168.0.111:35080').replace(/\/$/, '');
const outDir = process.argv[3] ?? process.env.TEMP ?? '.';

const USERNAME = 'iosaccept';
const PASSWORD = 'iosaccept123';
const TEMPLATE_NAME = 'iOS 验收模板';

let cookie = '';

async function req(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie !== '') headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length > 0) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, text };
}

const pad = (n) => String(n).padStart(2, '0');
const toDayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 相对今天偏移 n 天的本地时间 ISO（hour:minute 设定当天时间） */
function isoAt(dayOffset, hour, minute, second = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, second, 0);
  return d.toISOString();
}

function dayKeyOffset(dayOffset) {
  const now = new Date();
  return toDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset));
}

const FIELDS = [
  { key: 'title', label: '标题', type: 'text', required: true, maxLength: 60 },
  { key: 'note', label: '详情', type: 'longtext', maxLength: 2000 },
  { key: 'weight', label: '体重(kg)', type: 'number', min: 20, max: 200, precision: 1 },
  { key: 'amount', label: '金额', type: 'currency', currency: 'CNY', precision: 2 },
  { key: 'progress', label: '完成度', type: 'percent', precision: 1 },
  { key: 'mood', label: '心情', type: 'rating', scale: 5 },
  { key: 'day', label: '日期', type: 'date' },
  { key: 'at', label: '时间点', type: 'datetime' },
  {
    key: 'meal',
    label: '餐次',
    type: 'select',
    options: [
      { value: 'breakfast', label: '早餐' },
      { value: 'lunch', label: '午餐' },
      { value: 'dinner', label: '晚餐' },
      { value: 'night', label: '夜宵' },
    ],
  },
  {
    key: 'sports',
    label: '运动',
    type: 'multiselect',
    options: [
      { value: 'run', label: '跑步', color: '#30cf79' },
      { value: 'swim', label: '游泳', color: '#2f6fed' },
      { value: 'bike', label: '骑行', color: '#f59e0b' },
    ],
  },
  { key: 'done', label: '已完成', type: 'boolean' },
  { key: 'link', label: '参考链接', type: 'url' },
];

const MEMO_PLAN = [
  { offset: 0, hour: 8, values: { title: '晨跑 5 公里', weight: 61.2, mood: 5, meal: 'breakfast', sports: ['run'], done: true, progress: 100, amount: 0 } },
  { offset: 0, hour: 12, values: { title: '午餐：牛肉面', amount: 32.5, meal: 'lunch', mood: 4, note: '味道不错，下次少放辣', done: true, progress: 100 } },
  { offset: 1, hour: 7, values: { title: '游泳 1500m', weight: 61.5, mood: 4, sports: ['swim'], meal: 'breakfast', amount: 45, done: true, progress: 90, link: 'https://example.com/swim-plan' } },
  { offset: 1, hour: 20, values: { title: '读书笔记：《认知觉醒》', mood: 5, note: '专注力是可以训练的，关键是减少内耗。', done: true, progress: 80, sports: ['bike'] } },
  { offset: 3, hour: 9, values: { title: '骑行 20 公里', weight: 61.8, mood: 4, sports: ['bike'], amount: 12, meal: 'breakfast', progress: 100, done: true } },
  { offset: 5, hour: 13, values: { title: '外卖：沙拉', amount: 28, meal: 'lunch', mood: 3, done: false, progress: 50, note: '分量偏少' } },
  { offset: 7, hour: 22, values: { title: '夜宵：小笼包', amount: 18.5, meal: 'night', mood: 3, done: true, progress: 100, weight: 62.1 } },
  { offset: 10, hour: 8, values: { title: '晨跑 8 公里', weight: 61.0, mood: 5, sports: ['run'], amount: 0, done: true, progress: 100, mood_note: '状态很好' } },
  { offset: 14, hour: 19, values: { title: '游泳 1000m', weight: 61.4, mood: 4, sports: ['swim', 'bike'], amount: 40, done: true, progress: 100 } },
  { offset: 20, hour: 21, values: { title: '电影《星际穿越》重看', mood: 5, note: '爱是唯一可以超越时间与空间的事物。', done: true, progress: 100, link: 'https://movie.example.com/interstellar' } },
  { offset: 25, hour: 12, values: { title: '午餐：日料', amount: 88, meal: 'lunch', mood: 5, done: true, progress: 100, weight: 61.9 } },
  { offset: 30, hour: 6, values: { title: '半马训练 15 公里', weight: 60.8, mood: 5, sports: ['run'], amount: 5, done: true, progress: 100, link: 'https://example.com/half-marathon' } },
  { offset: 35, hour: 18, values: { title: '骑行 35 公里', weight: 60.9, mood: 4, sports: ['bike'], amount: 0, done: true, progress: 100 } },
  { offset: 40, hour: 23, values: { title: '深夜 emo', mood: 2, note: '有点焦虑，但要相信明天。', done: false, progress: 20, meal: 'night' } },
];

async function main() {
  // 1. 登录 / 注册
  let auth = await req('/api/auth/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } });
  if (auth.status === 401 || auth.status === 404 || auth.status === 422) {
    auth = await req('/api/auth/register', { method: 'POST', body: { username: USERNAME, password: PASSWORD } });
  }
  if (auth.status !== 200 && auth.status !== 201) {
    throw new Error(`认证失败：HTTP ${auth.status} ${auth.text}`);
  }
  console.log(`✅ 账号就绪：${USERNAME}（${auth.status}）`);

  // 2. 模板
  const templates = await req('/api/templates');
  let template = (templates.json?.items ?? []).find((t) => t.name === TEMPLATE_NAME);
  if (template === undefined) {
    const created = await req('/api/templates', {
      method: 'POST',
      body: {
        name: TEMPLATE_NAME,
        description: '包含全部 12 种字段类型，供 iOS 端验收使用',
        icon: '🧪',
        color: '#30cf79',
        fields: FIELDS,
      },
    });
    if (created.status !== 201) throw new Error(`模板创建失败：HTTP ${created.status} ${created.text}`);
    template = created.json;
  } else {
    await req(`/api/templates/${template.id}`, {
      method: 'PATCH',
      body: { name: TEMPLATE_NAME, description: template.description, icon: template.icon, color: template.color, fields: FIELDS },
    });
  }
  console.log(`✅ 模板就绪：${template.name}（${template.fields.length} 字段）`);

  // 3. 记录（先清掉本账号旧记录，保证可重复执行）
  const existing = await req('/api/memos?limit=200');
  for (const memo of existing.json?.items ?? []) {
    await req(`/api/memos/${memo.id}`, { method: 'DELETE' });
  }
  let created = 0;
  for (const plan of MEMO_PLAN) {
    const values = { day: dayKeyOffset(-plan.offset), at: isoAt(-plan.offset, plan.hour, 15), ...plan.values };
    delete values.mood_note;
    const body = {
      content: `#验收 ${Object.values(plan.values)[0]}`,
      templateId: template.id,
      values,
      createdAt: isoAt(-plan.offset, plan.hour, 0, 0),
    };
    const res = await req('/api/memos', { method: 'POST', body });
    if (res.status !== 201) throw new Error(`记录创建失败：HTTP ${res.status} ${res.text}`);
    created += 1;
  }
  console.log(`✅ 记录就绪：${created} 条`);

  // 4. 抓样本
  const from = isoAt(-45, 0, 0, 0);
  const to = isoAt(0, 23, 59, 59);
  const samples = {
    meta: { base, capturedAt: new Date().toISOString(), templateId: template.id },
    templates,
    memos: await req('/api/memos?limit=3'),
    summary: await req('/api/memos/summary'),
    overview: await req(`/api/analytics/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    insights: await req(
      `/api/analytics/templates/${template.id}/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
    health: await req('/api/health'),
  };

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'ios-api-samples.json');
  writeFileSync(outFile, JSON.stringify(samples, null, 2), 'utf8');
  console.log(`✅ 样本已写入：${outFile}`);

  // 5. 类型审计（用于核对 Swift 模型）
  const insights = samples.insights.json;
  const summary = insights?.summary ?? {};
  const audit = {
    'insights.summary': Object.fromEntries(
      Object.entries(summary).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v]),
    ),
    'overview.summary': Object.fromEntries(
      Object.entries(samples.overview.json?.summary ?? {}).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v]),
    ),
    'insights.range': insights?.range ?? null,
    'insights.tookMs': typeof insights?.tookMs,
    'insights.fields': (insights?.fields ?? []).map((f) => ({
      key: f.key,
      type: f.type,
      blocks: Object.keys(f).filter((k) => f[k] !== undefined && f[k] !== null),
    })),
    'field.currency.mean': insights?.fields?.find((f) => f.type === 'currency')?.numeric?.mean,
    'field.text.avgChars': insights?.fields?.find((f) => f.type === 'text')?.text?.avgChars,
    'field.percent.unit': insights?.fields?.find((f) => f.type === 'percent')?.unit,
    'field.rating.scale': insights?.fields?.find((f) => f.type === 'rating')?.scale,
    'heatmap.max': insights?.heatmap?.max,
    'timeline.granularity': insights?.timeline?.granularity,
    'timeline.points': insights?.timeline?.points?.length,
    'memos.total': samples.memos.json?.total,
    'health.status': samples.health.json?.status,
  };
  console.log('📋 类型审计：');
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((error) => {
  console.error('❌ 播种失败：', error.message);
  process.exit(1);
});
