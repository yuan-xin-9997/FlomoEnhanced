/**
 * 洞察分析测试（A3）—— `node:test` + `app.inject`，确定性夹具 + 手算期望值。
 *
 * 覆盖 docs/ANALYTICS.md 的逐字段口径：区间归一化、summary、timeline、heatmap、
 * weekday、hourOfDay、tags、各字段类型（数值/选择/布尔/日期/文本/链接）、fieldFillRate、
 * 跨用户隔离、overview、CSV、性能基线与时区边界。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { FieldDefinition, FieldValue } from '@flomo/shared';
import {
  buildContentDisposition,
  computeOverview,
  computeTemplateInsights,
  type OverviewInsights,
  type TemplateInsights,
} from '../src/domain/analytics.js';
import { weekdayOf } from '../src/lib/time.js';
import { createTestContext, jsonHeaders, registerAndLogin, type TestContext } from './helpers.js';

const PASSWORD = 'S3cure-Passw0rd!';
const TZ = 'Asia/Shanghai';

/* -------------------------------------------------------------------------- */
/* 夹具工具                                                                    */
/* -------------------------------------------------------------------------- */

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json(): unknown;
}

function uid(): string {
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 直接落库一个用户（域层测试无需走 scrypt 注册） */
function insertUser(db: DatabaseSync, id: string, username: string): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, password_algo, created_at, updated_at)
     VALUES (?, ?, 'stub-hash', 'stub-salt', 'scrypt', ?, ?)`,
  ).run(id, username, now, now);
}

interface TemplateSeed {
  name: string;
  icon?: string;
  color?: string;
  fields: FieldDefinition[];
}

/** 直接落库一个模板，返回模板 id */
function insertTemplate(db: DatabaseSync, userId: string, seed: TemplateSeed): string {
  const id = uid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO templates (id, user_id, name, description, icon, color, fields_json, version, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, '', ?, ?, ?, 1, ?, ?, NULL)`,
  ).run(id, userId, seed.name, seed.icon ?? '', seed.color ?? '', JSON.stringify(seed.fields), now, now);
  return id;
}

interface MemoSeed {
  templateId?: string | null;
  content?: string;
  values?: Record<string, FieldValue>;
  tags?: string[];
  createdAt: string;
  deletedAt?: string | null;
}

/** 直接落库一条 memo，返回 memo id */
function insertMemo(db: DatabaseSync, userId: string, seed: MemoSeed): string {
  const id = uid();
  db.prepare(
    `INSERT INTO memos (id, user_id, template_id, content, values_json, tags_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    seed.templateId ?? null,
    seed.content ?? '',
    JSON.stringify(seed.values ?? {}),
    JSON.stringify(seed.tags ?? []),
    seed.createdAt,
    seed.createdAt,
    seed.deletedAt ?? null,
  );
  return id;
}

/** JSON 往返深等（验证无 NaN / undefined / BigInt / Date） */
function assertJsonRoundTrip(value: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

/** 按断言查找数组条目 */
function pick<T>(items: readonly T[], predicate: (item: T) => boolean, message: string): T {
  const found = items.find(predicate);
  assert.ok(found !== undefined, message);
  return found as T;
}

interface InsightsRequest {
  app: FastifyInstance;
  templateId: string;
  cookie?: string;
  from?: string;
  to?: string;
  granularity?: string;
}

/** 调用核心洞察端点 */
async function getInsights(request: InsightsRequest): Promise<InjectResult> {
  const params = new URLSearchParams();
  if (request.from !== undefined) params.set('from', request.from);
  if (request.to !== undefined) params.set('to', request.to);
  if (request.granularity !== undefined) params.set('granularity', request.granularity);
  const query = params.toString();
  const url = `/api/analytics/templates/${request.templateId}/insights${query === '' ? '' : `?${query}`}`;
  return await request.app.inject({
    method: 'GET',
    url,
    ...(request.cookie === undefined ? {} : { headers: { cookie: request.cookie } }),
  }) as unknown as InjectResult;
}

/* -------------------------------------------------------------------------- */
/* 1. HTTP 行为：认证 / 隔离 / 区间归一化 / 空数据 / 显式粒度 / CSV            */
/* -------------------------------------------------------------------------- */

describe('洞察分析 HTTP：认证、隔离、区间归一化、空数据、CSV', () => {
  let ctx: TestContext;
  let cookieA = '';
  let cookieB = '';
  let userA = '';
  let templateA = '';

  const TEMPLATE_A_FIELDS: FieldDefinition[] = [
    { key: 'amount', label: '金额', type: 'number' },
    { key: 'note', label: '备注', type: 'text' },
    {
      key: 'ms',
      label: '多选',
      type: 'multiselect',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
      ],
    },
    { key: 'flag', label: '标记', type: 'boolean' },
  ];

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    const a = await registerAndLogin(ctx.app, 'a3-http-a', PASSWORD);
    const b = await registerAndLogin(ctx.app, 'a3-http-b', PASSWORD);
    cookieA = a.cookie;
    cookieB = b.cookie;
    userA = a.user.id;
    templateA = insertTemplate(ctx.db, userA, { name: '测试模板', icon: '🧪', color: '#3b82f6', fields: TEMPLATE_A_FIELDS });

    insertMemo(ctx.db, userA, {
      templateId: templateA,
      content: 'a,b"c',
      tags: ['t1'],
      createdAt: '2026-03-01T01:00:00.000Z',
      values: { amount: 10, note: '备注1', ms: ['x', 'y'], flag: true },
    });
    insertMemo(ctx.db, userA, {
      templateId: templateA,
      content: 'line1\nline2',
      createdAt: '2026-03-02T01:00:00.000Z',
      values: { amount: 20, note: '备注,含逗号', ms: [], flag: false },
    });
    insertMemo(ctx.db, userA, {
      templateId: templateA,
      content: '',
      createdAt: '2026-03-03T01:00:00.000Z',
      values: { amount: null, ms: ['x'] },
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('1.1 未登录：insights / overview / export.csv 全部 401 JSON', async () => {
    const insights = await getInsights({ app: ctx.app, templateId: templateA });
    assert.equal(insights.statusCode, 401);
    assert.match(String(insights.headers['content-type']), /application\/json/);
    assert.equal((insights.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED');

    const overview = await ctx.app.inject({ method: 'GET', url: '/api/analytics/overview' });
    assert.equal(overview.statusCode, 401);
    assert.equal((overview.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED');

    const csv = await ctx.app.inject({ method: 'GET', url: `/api/analytics/templates/${templateA}/export.csv` });
    assert.equal(csv.statusCode, 401);
    assert.equal((csv.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
  });

  it('1.2 跨用户隔离：B 查询 A 的模板 → 404（不泄露存在性）；不存在的 id 也 404', async () => {
    const foreign = await getInsights({ app: ctx.app, templateId: templateA, cookie: cookieB });
    assert.equal(foreign.statusCode, 404);
    assert.equal((foreign.json() as { error: { code: string } }).error.code, 'NOT_FOUND');

    const foreignCsv = await ctx.app.inject({
      method: 'GET',
      url: `/api/analytics/templates/${templateA}/export.csv`,
      headers: { cookie: cookieB },
    });
    assert.equal(foreignCsv.statusCode, 404);

    const missing = await getInsights({ app: ctx.app, templateId: uid(), cookie: cookieA });
    assert.equal(missing.statusCode, 404);

    // A 自己可以访问
    const own = await getInsights({ app: ctx.app, templateId: templateA, cookie: cookieA });
    assert.equal(own.statusCode, 200);
  });

  it('1.3 不传 from/to → 默认最近 30 天（闭区间）', async () => {
    const response = await getInsights({ app: ctx.app, templateId: templateA, cookie: cookieA });
    assert.equal(response.statusCode, 200);
    const body = response.json() as TemplateInsights;
    assert.equal(body.range.days, 30);
    assert.equal(body.range.label, '最近 30 天');
    assert.equal(body.range.timezone, TZ);
    assert.equal(body.range.granularity, 'day');
    assert.ok(Number.isFinite(body.tookMs));
    assert.ok(Number.isFinite(Date.parse(body.generatedAt)));
    assert.ok(!('csvRows' in body), '内部字段 csvRows 不得出现在 HTTP 响应中');
  });

  it('1.4 from > to → 422；跨度 > 3660 天 → 422；非法 granularity → 422', async () => {
    const reversed = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      from: '2026-05-02',
      to: '2026-05-01',
    });
    assert.equal(reversed.statusCode, 422);
    assert.equal((reversed.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const tooLong = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      from: '2010-01-01',
      to: '2026-05-01',
    });
    assert.equal(tooLong.statusCode, 422);

    const badGranularity = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      granularity: 'quarter',
    });
    assert.equal(badGranularity.statusCode, 422);

    const badFrom = await getInsights({ app: ctx.app, templateId: templateA, cookie: cookieA, from: 'not-a-date' });
    assert.equal(badFrom.statusCode, 422);
  });

  it('1.5 区间归一化：Asia/Shanghai 下 from 为当日 00:00:00.000 +08:00、to 为 23:59:59.999', async () => {
    const response = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      from: '2026-05-01',
      to: '2026-05-01',
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as TemplateInsights;
    assert.equal(body.range.from, '2026-05-01T00:00:00.000+08:00');
    assert.equal(body.range.to, '2026-05-01T23:59:59.999+08:00');
    assert.equal(body.range.days, 1);
    assert.equal(body.range.label, '2026-05-01 ~ 2026-05-01');
  });

  it('1.6 显式 granularity=week 生效；heatmap.days 与 timeline.points 补齐整个区间', async () => {
    const response = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      from: '2026-03-01',
      to: '2026-03-10',
      granularity: 'week',
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as TemplateInsights;
    assert.equal(body.range.granularity, 'week');
    assert.equal(body.range.days, 10);
    assert.equal(body.timeline.granularity, 'week');
    // 2026-03-01 是周日 → 本周周一为 2026-02-23；2026-03-10 是周二 → 本周周一 2026-03-09
    assert.deepEqual(
      body.timeline.points.map((point) => point.bucket),
      ['2026-02-23', '2026-03-02', '2026-03-09'],
    );
    assert.equal(body.heatmap.days.length, 10);
    assert.equal(body.heatmap.days[0]?.date, '2026-03-01');
    assert.equal(body.heatmap.days[9]?.date, '2026-03-10');
  });

  it('1.7 完全空数据（区间内无 memo）→ 结构完整、无 NaN、JSON 往返深等', async () => {
    const response = await getInsights({
      app: ctx.app,
      templateId: templateA,
      cookie: cookieA,
      from: '2020-01-01',
      to: '2020-01-31',
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as TemplateInsights;

    assert.equal(body.range.days, 31);
    assert.equal(body.range.granularity, 'day');

    assert.equal(body.summary.memoCount, 0);
    assert.equal(body.summary.allMemoCount, 0);
    assert.equal(body.summary.shareOfAllMemos, 0);
    assert.equal(body.summary.totalChars, 0);
    assert.equal(body.summary.avgChars, 0);
    assert.equal(body.summary.memosWithContent, 0);
    assert.equal(body.summary.activeDays, 0);
    assert.equal(body.summary.dayCoverage, 0);
    assert.equal(body.summary.longestStreak, 0);
    assert.equal(body.summary.currentStreak, 0);
    assert.equal(body.summary.busiestDay, null);
    assert.equal(body.summary.firstMemoAt, null);
    assert.equal(body.summary.lastMemoAt, null);
    assert.equal(body.summary.fieldFillRate.length, 4);
    for (const rate of body.summary.fieldFillRate) {
      assert.equal(rate.filled, 0);
      assert.equal(rate.missing, 0);
      assert.equal(rate.ratio, 0);
    }

    assert.equal(body.timeline.points.length, 31);
    assert.ok(body.timeline.points.every((point) => point.count === 0 && point.chars === 0));
    assert.equal(body.heatmap.max, 0);
    assert.equal(body.heatmap.days.length, 31);
    assert.ok(body.heatmap.days.every((day) => day.count === 0));
    assert.equal(body.weekday.buckets.length, 7);
    assert.ok(body.weekday.buckets.every((bucket) => bucket.count === 0));
    assert.equal(body.hourOfDay.buckets.length, 24);
    assert.ok(body.hourOfDay.buckets.every((bucket) => bucket.count === 0));
    assert.deepEqual(body.tags, []);
    assert.equal(body.fields.length, 4);

    const amount = pick(body.fields, (field) => field.key === 'amount', 'amount 字段缺失');
    assert.equal(amount.type, 'number');
    assert.equal(amount.filled, 0);
    assert.equal(amount.missing, 0);
    assert.equal(amount.fillRatio, 0);
    assert.equal(amount.valueUnion, null);
    assert.equal(amount.numeric, null);
    assert.equal(amount.trend, null);

    const note = pick(body.fields, (field) => field.key === 'note', 'note 字段缺失');
    assert.deepEqual(note.text, {
      totalChars: 0,
      avgChars: 0,
      minChars: 0,
      maxChars: 0,
      medianChars: 0,
      histogram: { binCount: 0, binWidth: 0, bins: [] },
      topWords: [],
      topWordsNote: '中文按 2-gram、英文/数字按词切分；过滤停用词与单字符',
    });

    const ms = pick(body.fields, (field) => field.key === 'ms', 'ms 字段缺失');
    assert.deepEqual(ms.distribution, []);
    assert.deepEqual(ms.valueUnion, []);

    const flag = pick(body.fields, (field) => field.key === 'flag', 'flag 字段缺失');
    assert.deepEqual(flag.boolean, { trueCount: 0, falseCount: 0, trueRatio: 0 });

    assertJsonRoundTrip(body);

    // export.csv 在空区间也应 200，仅表头
    const csv = await ctx.app.inject({
      method: 'GET',
      url: `/api/analytics/templates/${templateA}/export.csv?from=2020-01-01&to=2020-01-31`,
      headers: { cookie: cookieA },
    });
    assert.equal(csv.statusCode, 200);
  });

  it('1.8 CSV：BOM + CRLF + 列顺序 + 转义 + 多选 `|` + 布尔 是/否 + 空值空串 + Content-Disposition', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/analytics/templates/${templateA}/export.csv?from=2026-03-01&to=2026-03-31`,
      headers: { cookie: cookieA },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^text\/csv; charset=utf-8/);

    const disposition = String(response.headers['content-disposition']);
    assert.match(disposition, /^attachment; filename="/);
    assert.ok(disposition.includes("filename*=UTF-8''"), `缺少 RFC 5987 filename*：${disposition}`);

    const body = response.body;
    assert.equal(body.charCodeAt(0), 0xfeff, 'CSV 必须以 UTF-8 BOM 开头');
    assert.ok(body.includes('\r\n'), 'CSV 必须使用 CRLF 换行');

    const rows = body.slice(1).split('\r\n');
    assert.equal(rows[0], '记录时间(本地),记录时间(UTC),内容,标签,金额,备注,多选,标记');
    assert.equal(rows[1], '2026-03-01 09:00:00,2026-03-01T01:00:00.000Z,"a,b""c",t1,10,备注1,X|Y,是');
    assert.equal(rows[2], '2026-03-02 09:00:00,2026-03-02T01:00:00.000Z,"line1\nline2",,20,"备注,含逗号",,否');
    assert.equal(rows[3], '2026-03-03 09:00:00,2026-03-03T01:00:00.000Z,,,,,X,');
    assert.equal(rows[4], '', 'CRLF 结尾应产生一个空尾行');
  });

  it('1.9 buildContentDisposition 提供 ASCII 安全名与 UTF-8 名', () => {
    const header = buildContentDisposition('每日开销-20261018.csv');
    assert.match(header, /^attachment; filename="[^"]+\.csv"; filename\*=UTF-8''/);
    assert.ok(header.includes(encodeURIComponent('每日开销-20261018.csv').slice(0, 6)));
  });
});
/* -------------------------------------------------------------------------- */
/* 2. summary / timeline / heatmap / weekday / hourOfDay / tags（手算期望值）   */
/* -------------------------------------------------------------------------- */

describe('模板洞察：summary / timeline / heatmap / weekday / hourOfDay / tags', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';
  let insights: TemplateInsights;

  const FIELDS: FieldDefinition[] = [
    { key: 'amount', label: '金额', type: 'number' },
    { key: 'note', label: '备注', type: 'text' },
  ];

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-summary');
    templateId = insertTemplate(ctx.db, userId, { name: '记录', fields: FIELDS });

    // 8 条目标模板 memo（跨日、含双记录日），content 按 code point 计
    const rows: Array<{ at: string; content: string; tags: string[]; values: Record<string, FieldValue> }> = [
      { at: '2026-01-01T01:00:00.000Z', content: '早饭', tags: ['早饭', '工作日'], values: { amount: 1, note: 'x' } },
      { at: '2026-01-01T03:00:00.000Z', content: '午饭', tags: ['午饭'], values: { amount: 2, note: 'y' } },
      { at: '2026-01-02T02:00:00.000Z', content: '晚饭', tags: ['午饭', '工作日'], values: { amount: 3 } },
      { at: '2026-01-03T02:00:00.000Z', content: '打车', tags: [], values: { amount: 4 } },
      { at: '2026-01-05T02:00:00.000Z', content: '咖啡😀', tags: [], values: {} },
      { at: '2026-01-06T02:00:00.000Z', content: '电影', tags: [], values: {} },
      { at: '2026-01-07T02:00:00.000Z', content: '书', tags: [], values: {} },
      { at: '2026-02-10T02:00:00.000Z', content: '房租', tags: [], values: {} },
    ];
    for (const row of rows) {
      insertMemo(ctx.db, userId, {
        templateId,
        content: row.content,
        tags: row.tags,
        values: row.values,
        createdAt: row.at,
      });
    }

    // 干扰项：软删除、区间外、其它模板、无模板 —— 均不得进入该模板的统计
    insertMemo(ctx.db, userId, {
      templateId,
      content: '已删除',
      createdAt: '2026-01-04T02:00:00.000Z',
      deletedAt: '2026-01-05T02:00:00.000Z',
    });
    insertMemo(ctx.db, userId, { templateId, content: '区间外', createdAt: '2026-03-05T02:00:00.000Z' });

    const otherTemplate = insertTemplate(ctx.db, userId, { name: '其它', fields: [] });
    insertMemo(ctx.db, userId, { templateId: otherTemplate, content: '别家', createdAt: '2026-01-15T02:00:00.000Z' });

    for (const day of ['10', '11', '12']) {
      insertMemo(ctx.db, userId, { content: '随手记', createdAt: `2026-01-${day}T02:00:00.000Z` });
    }

    insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-01-01',
      to: '2026-02-28',
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('2.1 summary 全部字段等于手算值', () => {
    assert.equal(insights.range.days, 59, '2026-01-01 ~ 2026-02-28（跨月）');
    assert.equal(insights.range.granularity, 'day');

    const summary = insights.summary;
    assert.equal(summary.memoCount, 8, '只统计该模板 + 区间内 + 未删除');
    assert.equal(summary.allMemoCount, 12, '无模板/其它模板/函数内全部计入分母');
    assert.equal(summary.shareOfAllMemos, 0.666667);
    assert.equal(summary.totalChars, 16, '2+2+2+2+3+2+1+2（emoji 按 code point 计 1）');
    assert.equal(summary.avgChars, 2);
    assert.equal(summary.memosWithContent, 8);
    assert.equal(summary.activeDays, 7);
    assert.equal(summary.dayCoverage, 0.118644);
    assert.equal(summary.longestStreak, 3);
    assert.equal(summary.currentStreak, 0, '区间末日 02-28 无记录');
    assert.deepEqual(summary.busiestDay, { date: '2026-01-01', count: 2 });
    assert.equal(summary.firstMemoAt, '2026-01-01T01:00:00.000Z');
    assert.equal(summary.lastMemoAt, '2026-02-10T02:00:00.000Z');

    assert.deepEqual(summary.fieldFillRate, [
      { key: 'amount', label: '金额', filled: 4, missing: 4, ratio: 0.5 },
      { key: 'note', label: '备注', filled: 2, missing: 6, ratio: 0.25 },
    ]);
  });

  it('2.2 timeline 补齐空桶（含 0 值桶与 chars 汇总）', () => {
    const points = insights.timeline.points;
    assert.equal(insights.timeline.granularity, 'day');
    assert.equal(points.length, 59);
    assert.equal(points[0]?.bucket, '2026-01-01');
    assert.equal(points[0]?.label, '01-01');
    assert.equal(points[0]?.count, 2);
    assert.equal(points[0]?.chars, 4);
    assert.equal(points[1]?.count, 1);
    assert.equal(points[2]?.count, 1);
    assert.equal(points[3]?.count, 0, '01-04 的记录已软删除 → 空桶');
    assert.equal(points[3]?.chars, 0);
    assert.equal(points[4]?.count, 1);
    assert.equal(points[30]?.bucket, '2026-01-31', '1 月末桶存在但计数为 0');
    assert.equal(points[30]?.count, 0);
    assert.equal(points[40]?.bucket, '2026-02-10', '跨月：2 月的记录落在正确桶');
    assert.equal(points[40]?.count, 1);
    assert.equal(points[58]?.bucket, '2026-02-28');
    assert.equal(points[58]?.count, 0);
    assert.equal(
      points.reduce((total, point) => total + point.count, 0),
      8,
    );
  });

  it('2.3 heatmap.max 为单日最大计数，缺失日期补 0', () => {
    assert.equal(insights.heatmap.max, 2);
    assert.equal(insights.heatmap.days.length, 59);
    assert.equal(insights.heatmap.days[0]?.date, '2026-01-01');
    assert.equal(insights.heatmap.days[0]?.count, 2);
    assert.equal(insights.heatmap.days[3]?.date, '2026-01-04');
    assert.equal(insights.heatmap.days[3]?.count, 0);
    assert.equal(pick(insights.heatmap.days, (day) => day.date === '2026-02-10', '缺 02-10').count, 1);
  });

  it('2.4 weekday 恒 7 项（1=周一 … 7=周日），hourOfDay 恒 24 项且按本地小时', () => {
    const weekday = insights.weekday.buckets;
    assert.equal(weekday.length, 7);
    assert.deepEqual(
      weekday.map((bucket) => bucket.weekday),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.equal(weekday[0]?.label, '周一');
    assert.equal(weekday[6]?.label, '周日');
    // 2026-01-01 是周四 → weekday 4
    assert.equal(weekday[3]?.count, 2);
    assert.equal(weekday[4]?.count, 1);
    assert.equal(weekday[5]?.count, 1, '01-03 是周六');
    assert.equal(weekday[6]?.count, 0, '01-04 的记录已软删除');
    assert.equal(weekday[1]?.count, 2, '01-06 与 02-10 都是周二');
    assert.equal(
      weekday.reduce((total, bucket) => total + bucket.count, 0),
      8,
    );

    const hours = insights.hourOfDay.buckets;
    assert.equal(hours.length, 24);
    assert.deepEqual(
      hours.map((bucket) => bucket.hour),
      Array.from({ length: 24 }, (_unused, index) => index),
    );
    // 01:00Z → 本地 09:00；03:00Z → 11:00；其余 02:00Z → 10:00
    assert.equal(hours[9]?.count, 1);
    assert.equal(hours[10]?.count, 6);
    assert.equal(hours[11]?.count, 1);
    assert.equal(
      hours.reduce((total, bucket) => total + bucket.count, 0),
      8,
    );
  });

  it('2.5 tags 按 count 降序、share 分母为 memoCount', () => {
    const tags = insights.tags;
    assert.equal(tags.length, 3);
    const lunch = pick(tags, (tag) => tag.tag === '午饭', '缺 午饭');
    const work = pick(tags, (tag) => tag.tag === '工作日', '缺 工作日');
    const breakfast = pick(tags, (tag) => tag.tag === '早饭', '缺 早饭');
    assert.equal(lunch.count, 2);
    assert.equal(lunch.share, 0.25);
    assert.equal(work.count, 2);
    assert.equal(work.share, 0.25);
    assert.equal(breakfast.count, 1);
    assert.equal(breakfast.share, 0.125);
    assert.ok(tags[0]!.count >= tags[2]!.count, '必须按 count 降序');
  });

  it('2.6 整个响应 JSON 往返深等（无 NaN/undefined/BigInt/Date）', () => {
    assertJsonRoundTrip(insights);
  });
});
/* -------------------------------------------------------------------------- */
/* 3. granularity 自动选择与周/月桶键                                          */
/* -------------------------------------------------------------------------- */

describe('granularity 自动选择与分桶键', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-granularity');
    templateId = insertTemplate(ctx.db, userId, { name: '粒度', fields: [] });
  });

  after(async () => {
    await ctx.close();
  });

  function run(from: string, to: string, granularity?: 'day' | 'week' | 'month'): TemplateInsights {
    return computeTemplateInsights(ctx.db, ctx.config.tz, { userId, templateId, from, to, granularity });
  }

  it('3.1 ≤62 天 → day', () => {
    const insights = run('2024-01-01', '2024-03-01'); // 61 天
    assert.equal(insights.range.days, 61);
    assert.equal(insights.range.granularity, 'day');
    assert.equal(insights.timeline.points.length, 61);
    assert.equal(insights.timeline.points[0]?.bucket, '2024-01-01');
    assert.equal(insights.timeline.points[60]?.bucket, '2024-03-01');
  });

  it('3.2 ≤730 天 → week，桶键为该周周一且步长 7 天', () => {
    const insights = run('2024-01-01', '2024-12-31'); // 366 天
    assert.equal(insights.range.days, 366);
    assert.equal(insights.range.granularity, 'week');
    const buckets = insights.timeline.points.map((point) => point.bucket);
    assert.equal(buckets[0], '2024-01-01', '2024-01-01 是周一');
    assert.equal(buckets[buckets.length - 1], '2024-12-30');
    assert.equal(buckets.length, 53);
    for (const bucket of buckets) assert.equal(weekdayOf(bucket), 1, `周桶 ${bucket} 必须是周一`);
    for (let index = 1; index < buckets.length; index += 1) {
      assert.equal(new Date(`${buckets[index]}T00:00:00Z`).getTime(), new Date(`${buckets[index - 1]}T00:00:00Z`).getTime() + 7 * 86_400_000);
    }
  });

  it('3.3 >730 天 → month，桶键为 YYYY-MM 且连续', () => {
    const insights = run('2024-01-01', '2025-12-31'); // 731 天
    assert.equal(insights.range.days, 731);
    assert.equal(insights.range.granularity, 'month');
    const buckets = insights.timeline.points.map((point) => point.bucket);
    assert.equal(buckets.length, 24);
    assert.equal(buckets[0], '2024-01');
    assert.equal(buckets[1], '2024-02');
    assert.equal(buckets[12], '2025-01');
    assert.equal(buckets[23], '2025-12');
    assert.equal(insights.timeline.points[0]?.label, '2024-01');
  });

  it('3.4 显式 granularity 覆盖自动选择', () => {
    const monthly = run('2024-01-01', '2024-03-01', 'month');
    assert.equal(monthly.range.granularity, 'month');
    assert.deepEqual(
      monthly.timeline.points.map((point) => point.bucket),
      ['2024-01', '2024-02', '2024-03'],
    );
    const weekly = run('2024-01-01', '2024-01-31', 'week');
    assert.equal(weekly.range.granularity, 'week');
    const daily = run('2024-01-01', '2025-12-31', 'day');
    assert.equal(daily.range.granularity, 'day');
    assert.equal(daily.timeline.points.length, 731);
  });

  it('3.5 非法 granularity → 422', () => {
    assert.throws(
      () =>
        computeTemplateInsights(ctx.db, ctx.config.tz, {
          userId,
          templateId,
          from: '2024-01-01',
          to: '2024-02-01',
          granularity: 'quarter' as unknown as 'day',
        }),
      /granularity/,
    );
  });
});
/* -------------------------------------------------------------------------- */
/* 4. 数值型字段：number / currency / percent / rating                        */
/* -------------------------------------------------------------------------- */

describe('数值型字段统计（ANALYTICS §4.1）', () => {
  let ctx: TestContext;
  let userId = '';
  let numericTemplate = '';
  let outlierTemplate = '';
  let insights: TemplateInsights;
  let outlierInsights: TemplateInsights;

  const FIELDS: FieldDefinition[] = [
    { key: 'amount', label: '金额', type: 'number' },
    { key: 'price', label: '花费', type: 'currency' },
    { key: 'pct', label: '占比', type: 'percent' },
    { key: 'score', label: '评分', type: 'rating', scale: 5 },
  ];

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-numeric');
    numericTemplate = insertTemplate(ctx.db, userId, { name: '数值', fields: FIELDS });
    outlierTemplate = insertTemplate(ctx.db, userId, {
      name: '离群',
      fields: [{ key: 'v', label: '值', type: 'number' }],
    });

    for (let i = 1; i <= 10; i += 1) {
      insertMemo(ctx.db, userId, {
        templateId: numericTemplate,
        content: `第${i}条`,
        createdAt: `2026-03-${String(i).padStart(2, '0')}T02:00:00.000Z`,
        values: { amount: i, price: i, pct: i * 10, score: ((i - 1) % 5) + 1 },
      });
    }

    for (let i = 1; i <= 9; i += 1) {
      insertMemo(ctx.db, userId, {
        templateId: outlierTemplate,
        content: `o${i}`,
        createdAt: `2026-03-${String(i).padStart(2, '0')}T02:00:00.000Z`,
        values: { v: i },
      });
    }
    insertMemo(ctx.db, userId, {
      templateId: outlierTemplate,
      content: 'o10',
      createdAt: '2026-03-10T02:00:00.000Z',
      values: { v: 1000 },
    });

    insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId: numericTemplate,
      from: '2026-03-01',
      to: '2026-03-31',
    });
    outlierInsights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId: outlierTemplate,
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('4.1 number：sum/mean/median/min/max/p25/p75/p90/p95/stddev/range 全等于手算值', () => {
    const numeric = pick(insights.fields, (field) => field.key === 'amount', '缺 amount').numeric;
    assert.ok(numeric !== null);
    assert.equal(numeric!.count, 10);
    assert.equal(numeric!.sum, 55);
    assert.equal(numeric!.mean, 5.5);
    assert.equal(numeric!.median, 5.5);
    assert.equal(numeric!.min, 1);
    assert.equal(numeric!.max, 10);
    assert.equal(numeric!.p25, 3.25);
    assert.equal(numeric!.p75, 7.75);
    assert.equal(numeric!.p90, 9.1);
    assert.equal(numeric!.p95, 9.55);
    assert.equal(numeric!.stddev, 3.02765, 'ddof=1 的样本标准差');
    assert.equal(numeric!.range, 9);
  });

  it('4.2 histogram：binCount∈[5,20]、binWidth、桶自洽（count 之和 = n、末桶 cumulativeRatio = 1）', () => {
    const numeric = pick(insights.fields, (field) => field.key === 'amount', '缺 amount').numeric;
    assert.ok(numeric !== null);
    const histogram = numeric!.histogram;
    assert.ok(histogram.binCount >= 5 && histogram.binCount <= 20, `binCount=${histogram.binCount}`);
    assert.equal(histogram.binCount, 5);
    assert.equal(histogram.binWidth, 1.8);
    assert.equal(histogram.bins.length, 5);
    assert.deepEqual(
      histogram.bins.map((bin) => bin.count),
      [2, 2, 2, 2, 2],
    );
    assert.equal(histogram.bins[0]!.from, 1);
    assert.equal(histogram.bins[0]!.to, 2.8);
    assert.equal(histogram.bins[4]!.from, 8.2);
    assert.equal(histogram.bins[4]!.to, 10, '末桶 to 必须精确等于最大值');
    for (const bin of histogram.bins) {
      assert.equal(bin.ratio, 0.2);
      assert.ok(bin.cumulativeRatio >= 0 && bin.cumulativeRatio <= 1);
    }
    assert.equal(
      histogram.bins.reduce((total, bin) => total + bin.count, 0),
      10,
    );
    assert.ok(Math.abs(histogram.bins[4]!.cumulativeRatio - 1) < 1e-9);
    assert.deepEqual(numeric!.outliers, { method: 'iqr', lower: -3.5, upper: 14.5, count: 0 });
  });

  it('4.3 outliers：1.5×IQR（Tukey）识别明显离群点', () => {
    const numeric = pick(outlierInsights.fields, (field) => field.key === 'v', '缺 v').numeric;
    assert.ok(numeric !== null);
    assert.equal(numeric!.count, 10);
    assert.equal(numeric!.sum, 1045);
    assert.equal(numeric!.mean, 104.5);
    assert.equal(numeric!.median, 5.5);
    assert.equal(numeric!.max, 1000);
    assert.equal(numeric!.min, 1);
    assert.deepEqual(numeric!.outliers, { method: 'iqr', lower: -3.5, upper: 14.5, count: 1 });
  });

  it('4.4 trend：按粒度聚合 sum/mean/min/max（空桶补 0）', () => {
    const trend = pick(insights.fields, (field) => field.key === 'amount', '缺 amount').trend;
    assert.ok(trend !== null);
    assert.equal(trend!.granularity, 'day');
    assert.equal(trend!.points.length, 31);
    assert.equal(
      trend!.points.reduce((total, point) => total + point.count, 0),
      10,
    );
    assert.equal(
      trend!.points.reduce((total, point) => total + point.sum, 0),
      55,
    );
    const first = trend!.points[0];
    assert.equal(first?.bucket, '2026-03-01');
    assert.deepEqual(first, { bucket: '2026-03-01', label: '03-01', count: 1, sum: 1, mean: 1, min: 1, max: 1 });
    const emptyBucket = trend!.points[20];
    assert.equal(emptyBucket?.count, 0);
    assert.equal(emptyBucket?.sum, 0);
  });

  it('4.5 currency 附 currency，percent 附 unit，其余数值指标一致', () => {
    const price = pick(insights.fields, (field) => field.key === 'price', '缺 price');
    assert.equal(price.type, 'currency');
    assert.equal(price.currency, 'CNY');
    assert.equal(price.numeric?.sum, 55);

    const pct = pick(insights.fields, (field) => field.key === 'pct', '缺 pct');
    assert.equal(pct.type, 'percent');
    assert.equal(pct.unit, '%');
    assert.equal(pct.numeric?.sum, 550);
    assert.equal(pct.numeric?.min, 10);
    assert.equal(pct.numeric?.max, 100);
  });

  it('4.6 rating：distribution 覆盖 0..scale 全量桶，share 分母为有值条数', () => {
    const score = pick(insights.fields, (field) => field.key === 'score', '缺 score');
    assert.equal(score.type, 'rating');
    assert.equal(score.scale, 5);
    assert.deepEqual(
      score.distribution?.map((entry) => entry.value),
      [0, 1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      score.distribution?.map((entry) => entry.count),
      [0, 2, 2, 2, 2, 2],
    );
    assert.equal(score.distribution?.[0]?.share, 0);
    assert.equal(score.distribution?.[1]?.share, 0.2);
    assert.equal(score.numeric?.sum, 30);
    assert.equal(score.filled, 10);
  });
});
/* -------------------------------------------------------------------------- */
/* 5. 选择型 / 布尔型字段与 fieldFillRate                                      */
/* -------------------------------------------------------------------------- */

describe('选择型/布尔型字段统计（ANALYTICS §4.2 / §4.3）与 fieldFillRate', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';
  let insights: TemplateInsights;

  const FIELDS: FieldDefinition[] = [
    {
      key: 's',
      label: '单选',
      type: 'select',
      options: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
        { value: 'c', label: '丙' },
        { value: 'd', label: '丁' },
      ],
    },
    {
      key: 'm',
      label: '多选',
      type: 'multiselect',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
      ],
    },
    { key: 'b', label: '标记', type: 'boolean' },
  ];

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-choice');
    templateId = insertTemplate(ctx.db, userId, { name: '选项', fields: FIELDS });

    const rows: Array<Record<string, FieldValue>> = [
      { s: 'a', m: ['x', 'y'], b: true },
      { s: 'a', m: ['x'], b: true },
      { s: 'b', m: ['x', 'z'], b: false },
      { s: 'a', m: ['y'], b: false },
      {},
      { s: 'c', m: ['z'], b: true },
    ];
    rows.forEach((values, index) => {
      insertMemo(ctx.db, userId, {
        templateId,
        content: `c${index + 1}`,
        values,
        createdAt: `2026-04-0${index + 1}T02:00:00.000Z`,
      });
    });

    insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-04-01',
      to: '2026-04-30',
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('5.1 select：distribution 按 count 降序、share 分母为有值条数、未使用选项不在其中', () => {
    const field = pick(insights.fields, (item) => item.key === 's', '缺 s');
    assert.equal(field.filled, 5);
    assert.equal(field.missing, 1);
    assert.equal(field.fillRatio, 0.833333);
    assert.deepEqual(
      field.distribution?.map((entry) => [entry.value, entry.label, entry.count, entry.share]),
      [
        ['a', '甲', 3, 0.6],
        ['b', '乙', 1, 0.2],
        ['c', '丙', 1, 0.2],
      ],
    );
    assert.ok(!field.distribution?.some((entry) => entry.value === 'd'), '未使用的选项不应出现在 distribution');
    assert.deepEqual(field.valueUnion, ['a', 'b', 'c'], 'valueUnion 只含实际出现的 value，按模板定义顺序');
  });

  it('5.2 multiselect：share 分母为「该字段被引用的总次数」', () => {
    const field = pick(insights.fields, (item) => item.key === 'm', '缺 m');
    assert.equal(field.filled, 5, '空数组视为缺失');
    assert.equal(field.missing, 1);
    assert.deepEqual(
      field.distribution?.map((entry) => [entry.value, entry.count, entry.share]),
      [
        ['x', 3, 0.428571],
        ['y', 2, 0.285714],
        ['z', 2, 0.285714],
      ],
    );
    const totalShare = (field.distribution ?? []).reduce((total, entry) => total + entry.count, 0);
    assert.equal(totalShare, 7, '总引用次数 = 2+1+2+1+1');
    assert.deepEqual(field.valueUnion, ['x', 'y', 'z']);
  });

  it('5.3 boolean：trueCount / falseCount / trueRatio', () => {
    const field = pick(insights.fields, (item) => item.key === 'b', '缺 b');
    assert.equal(field.filled, 5);
    assert.equal(field.missing, 1);
    assert.deepEqual(field.boolean, { trueCount: 3, falseCount: 2, trueRatio: 0.6 });
  });

  it('5.4 fieldFillRate：部分缺失时 filled / missing / ratio 正确', () => {
    assert.deepEqual(insights.summary.fieldFillRate, [
      { key: 's', label: '单选', filled: 5, missing: 1, ratio: 0.833333 },
      { key: 'm', label: '多选', filled: 5, missing: 1, ratio: 0.833333 },
      { key: 'b', label: '标记', filled: 5, missing: 1, ratio: 0.833333 },
    ]);
    assert.equal(insights.summary.memoCount, 6);
  });
});
/* -------------------------------------------------------------------------- */
/* 6. 日期 / 文本 / 链接字段统计                                               */
/* -------------------------------------------------------------------------- */

describe('date / datetime / text / longtext / url 字段统计（ANALYTICS §4.4-§4.6）', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';
  let insights: TemplateInsights;
  let monthly: TemplateInsights;

  const FIELDS: FieldDefinition[] = [
    { key: 'd', label: '日期', type: 'date' },
    { key: 'dt', label: '时间', type: 'datetime' },
    { key: 't', label: '短文本', type: 'text' },
    { key: 'l', label: '长文本', type: 'longtext' },
    { key: 'u', label: '链接', type: 'url' },
  ];

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-misc');
    templateId = insertTemplate(ctx.db, userId, { name: '杂项', fields: FIELDS });

    const rows: Array<Record<string, FieldValue>> = [
      {
        d: '2026-02-01',
        dt: '2026-02-01T10:15:00.000Z',
        t: '复盘 复盘 复盘',
        l: 'the the the 复盘',
        u: 'https://github.com/a',
      },
      { d: '2026-02-10', dt: '2026-02-10T22:00:00.000Z', t: '复盘', l: '中文内容', u: 'http://example.com/b' },
      { d: '2026-02-20', dt: '2026-02-20T08:00:00.000Z', t: 'hello world hello', u: 'https://github.com/c' },
      { u: 'https://github.com/d' },
    ];
    rows.forEach((values, index) => {
      insertMemo(ctx.db, userId, {
        templateId,
        content: `m${index + 1}`,
        values,
        createdAt: `2026-02-${String(index + 1).padStart(2, '0')}T05:00:00.000Z`,
      });
    });

    insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-02-01',
      to: '2026-02-28',
    });
    monthly = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-02-01',
      to: '2026-02-28',
      granularity: 'month',
    });
  });

  after(async () => {
    await ctx.close();
  });

  it('6.1 date：min/max/spanDays/byMonth/byWeekday（无 byHour）', () => {
    const field = pick(insights.fields, (item) => item.key === 'd', '缺 d');
    assert.equal(field.filled, 3);
    assert.equal(field.missing, 1);
    assert.equal(field.date?.min, '2026-02-01');
    assert.equal(field.date?.max, '2026-02-20');
    assert.equal(field.date?.spanDays, 19);
    assert.deepEqual(field.date?.byMonth, [
      { bucket: '2026-02-01', count: 1 },
      { bucket: '2026-02-10', count: 1 },
      { bucket: '2026-02-20', count: 1 },
    ]);
    assert.equal(field.date?.byWeekday.length, 7);
    assert.deepEqual(
      field.date?.byWeekday,
      [
        { weekday: 1, count: 0 },
        { weekday: 2, count: 1 },
        { weekday: 3, count: 0 },
        { weekday: 4, count: 0 },
        { weekday: 5, count: 1 },
        { weekday: 6, count: 0 },
        { weekday: 7, count: 1 },
      ],
    );
    assert.equal(field.date?.byHour, undefined, 'date 不带 byHour');
  });

  it('6.2 date.byMonth 跟随 range.granularity（显式 month → YYYY-MM）', () => {
    const field = pick(monthly.fields, (item) => item.key === 'd', '缺 d');
    assert.equal(monthly.range.granularity, 'month');
    assert.deepEqual(field.date?.byMonth, [{ bucket: '2026-02', count: 3 }]);
  });

  it('6.3 datetime：min/max/spanDays/byMonth/byWeekday/byHour（本地时区）', () => {
    const field = pick(insights.fields, (item) => item.key === 'dt', '缺 dt');
    assert.equal(field.filled, 3);
    assert.equal(field.missing, 1);
    assert.equal(field.date?.min, '2026-02-01T10:15:00.000Z');
    assert.equal(field.date?.max, '2026-02-20T08:00:00.000Z');
    assert.equal(field.date?.spanDays, 19);
    assert.deepEqual(field.date?.byMonth, [
      { bucket: '2026-02-01', count: 1 },
      { bucket: '2026-02-11', count: 1 },
      { bucket: '2026-02-20', count: 1 },
    ]);
    const byWeekday = field.date?.byWeekday ?? [];
    assert.equal(byWeekday.find((bucket) => bucket.weekday === 7)?.count, 1);
    assert.equal(byWeekday.find((bucket) => bucket.weekday === 3)?.count, 1);
    assert.equal(byWeekday.find((bucket) => bucket.weekday === 5)?.count, 1);

    const byHour = field.date?.byHour ?? [];
    assert.equal(byHour.length, 24, 'datetime 恒 24 项');
    assert.equal(byHour[6]?.count, 1, '10:15Z → 本地 18:15');
    assert.equal(byHour[16]?.count, 1);
    assert.equal(byHour[18]?.count, 1);
    assert.equal(
      byHour.reduce((total, bucket) => total + bucket.count, 0),
      3,
    );
  });

  it('6.4 text：totalChars/avg/min/max/median + histogram + topWords（2-gram + 停用词）', () => {
    const field = pick(insights.fields, (item) => item.key === 't', '缺 t');
    assert.equal(field.filled, 3);
    assert.equal(field.missing, 1);
    assert.equal(field.text?.totalChars, 27);
    assert.equal(field.text?.avgChars, 9);
    assert.equal(field.text?.minChars, 2);
    assert.equal(field.text?.maxChars, 17);
    assert.equal(field.text?.medianChars, 8);
    assert.equal(field.text?.topWordsNote, '中文按 2-gram、英文/数字按词切分；过滤停用词与单字符');

    const words = field.text?.topWords ?? [];
    assert.deepEqual(words[0], { word: '复盘', count: 4 });
    assert.equal(words.find((word) => word.word === 'hello')?.count, 2);
    assert.equal(words.find((word) => word.word === 'world')?.count, 1);

    const histogram = field.text?.histogram;
    assert.ok(histogram !== undefined);
    assert.ok(histogram!.binCount >= 5 && histogram!.binCount <= 20);
    assert.equal(histogram!.bins[0]?.from, 2);
    assert.equal(histogram!.bins[histogram!.bins.length - 1]?.to, 17);
    assert.equal(
      histogram!.bins.reduce((total, bin) => total + bin.count, 0),
      3,
    );
  });

  it('6.5 longtext：停用词被过滤，中文按 2-gram 切分', () => {
    const field = pick(insights.fields, (item) => item.key === 'l', '缺 l');
    assert.equal(field.filled, 2);
    assert.equal(field.text?.totalChars, 18);
    assert.equal(field.text?.minChars, 4);
    assert.equal(field.text?.maxChars, 14);
    assert.equal(field.text?.medianChars, 9);
    const words = field.text?.topWords ?? [];
    assert.ok(!words.some((word) => word.word === 'the'), '停用词 the 必须被过滤');
    assert.equal(words.find((word) => word.word === '复盘')?.count, 1);
    for (const word of ['中文', '文内', '内容']) {
      assert.equal(words.find((item) => item.word === word)?.count, 1, `缺 2-gram ${word}`);
    }
  });

  it('6.6 url：distinctDomains 降序、distinctCount、httpsRatio', () => {
    const field = pick(insights.fields, (item) => item.key === 'u', '缺 u');
    assert.equal(field.filled, 4);
    assert.equal(field.missing, 0);
    assert.equal(field.url?.distinctCount, 4);
    assert.deepEqual(field.url?.distinctDomains, [
      { domain: 'github.com', count: 3 },
      { domain: 'example.com', count: 1 },
    ]);
    assert.equal(field.url?.httpsRatio, 0.75);
  });

  it('6.7 响应 JSON 往返深等', () => {
    assertJsonRoundTrip(insights);
    assertJsonRoundTrip(monthly);
  });
});
/* -------------------------------------------------------------------------- */
/* 7. 全局概览与跨用户隔离（ANALYTICS §5）                                     */
/* -------------------------------------------------------------------------- */

describe('overview：byTemplate / tags / numericFields 汇总与跨用户隔离', () => {
  let ctx: TestContext;
  let userA = '';
  let userB = '';
  let t1 = '';
  let t2 = '';
  let overviewA: OverviewInsights;
  let overviewB: OverviewInsights;

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userA = uid();
    userB = uid();
    insertUser(ctx.db, userA, 'a3-overview-a');
    insertUser(ctx.db, userB, 'a3-overview-b');

    t1 = insertTemplate(ctx.db, userA, {
      name: '日记',
      icon: '📔',
      fields: [
        { key: 'amount', label: '金额', type: 'currency' },
        {
          key: 'mood',
          label: '心情',
          type: 'select',
          options: [
            { value: 'happy', label: '开心' },
            { value: 'sad', label: '难过' },
          ],
        },
      ],
    });
    t2 = insertTemplate(ctx.db, userA, {
      name: '开销',
      icon: '💰',
      fields: [{ key: 'amount', label: '金额', type: 'number' }],
    });

    insertMemo(ctx.db, userA, {
      templateId: t1,
      content: '日记一',
      tags: ['p', 'q'],
      values: { amount: 100, mood: 'happy' },
      createdAt: '2026-01-01T02:00:00.000Z',
    });
    insertMemo(ctx.db, userA, {
      templateId: t1,
      content: '日记二',
      tags: ['p'],
      values: { amount: 200, mood: 'happy' },
      createdAt: '2026-01-02T02:00:00.000Z',
    });
    [10, 20, 30].forEach((amount, index) => {
      insertMemo(ctx.db, userA, {
        templateId: t2,
        content: '开销',
        tags: index === 0 ? ['p'] : [],
        values: { amount },
        createdAt: `2026-01-0${index + 3}T02:00:00.000Z`,
      });
    });
    insertMemo(ctx.db, userA, { content: '随手', createdAt: '2026-01-06T02:00:00.000Z' });
    insertMemo(ctx.db, userA, { content: '随手', createdAt: '2026-01-07T02:00:00.000Z' });

    // B 的数据（用于隔离断言）
    const tB = insertTemplate(ctx.db, userB, { name: 'B的模板', fields: [{ key: 'amount', label: '金额', type: 'currency' }] });
    insertMemo(ctx.db, userB, { templateId: tB, content: 'B1', values: { amount: 9 }, createdAt: '2026-01-01T02:00:00.000Z' });
    insertMemo(ctx.db, userB, { content: 'B2', createdAt: '2026-01-02T02:00:00.000Z' });
    insertMemo(ctx.db, userB, { content: 'B3', createdAt: '2026-01-03T02:00:00.000Z' });

    overviewA = computeOverview(ctx.db, ctx.config.tz, { userId: userA, from: '2026-01-01', to: '2026-01-31' });
    overviewB = computeOverview(ctx.db, ctx.config.tz, { userId: userB, from: '2026-01-01', to: '2026-01-31' });
  });

  after(async () => {
    await ctx.close();
  });

  it('7.1 summary：memoCount / templateCount / totalChars / avgChars / streak', () => {
    const summary = overviewA.summary;
    assert.equal(summary.memoCount, 7);
    assert.equal(summary.templateCount, 2, '只统计区间内实际被引用的模板');
    assert.equal(summary.totalChars, 16);
    assert.equal(summary.avgChars, 2.285714);
    assert.equal(summary.activeDays, 7);
    assert.equal(summary.dayCoverage, 0.225806);
    assert.equal(summary.longestStreak, 7);
    assert.equal(summary.currentStreak, 0, '区间末日 01-31 无记录');
  });

  it('7.2 byTemplate：非空模板按 count 降序 + 末尾「无模板」项 + share', () => {
    assert.deepEqual(
      overviewA.summary.byTemplate.map((entry) => [entry.templateId, entry.templateName, entry.icon, entry.count, entry.share]),
      [
        [t2, '开销', '💰', 3, 0.428571],
        [t1, '日记', '📔', 2, 0.285714],
        [null, '无模板', '', 2, 0.285714],
      ],
    );
  });

  it('7.3 tags：share 分母为 overview 的 memoCount', () => {
    const p = pick(overviewA.tags, (tag) => tag.tag === 'p', '缺 p');
    const q = pick(overviewA.tags, (tag) => tag.tag === 'q', '缺 q');
    assert.equal(p.count, 3);
    assert.equal(p.share, 0.428571);
    assert.equal(q.count, 1);
    assert.equal(q.share, 0.142857);
  });

  it('7.4 numericFields：跨模板汇总，key 冲突时以 templateName 前缀区分', () => {
    assert.equal(overviewA.numericFields.length, 2);
    const spend = pick(overviewA.numericFields, (entry) => entry.templateId === t2, '缺 t2 数值字段');
    assert.deepEqual(
      { key: spend.key, type: spend.type, count: spend.count, sum: spend.sum, mean: spend.mean, median: spend.median, max: spend.max },
      { key: '开销.amount', type: 'number', count: 3, sum: 60, mean: 20, median: 20, max: 30 },
    );
    const diary = pick(overviewA.numericFields, (entry) => entry.templateId === t1, '缺 t1 数值字段');
    assert.equal(diary.key, '日记.amount');
    assert.equal(diary.type, 'currency');
    assert.equal(diary.currency, 'CNY');
    assert.equal(diary.count, 2);
    assert.equal(diary.sum, 300);
    assert.equal(diary.mean, 150);
    assert.equal(diary.max, 200);
  });

  it('7.5 timeline / heatmap / weekday / hourOfDay 结构完整', () => {
    assert.equal(overviewA.timeline.points.length, 31);
    assert.equal(
      overviewA.timeline.points.reduce((total, point) => total + point.count, 0),
      7,
    );
    assert.equal(overviewA.heatmap.days.length, 31);
    assert.equal(overviewA.heatmap.max, 1);
    assert.equal(overviewA.weekday.buckets.length, 7);
    assert.equal(overviewA.hourOfDay.buckets.length, 24);
    assert.equal(
      overviewA.weekday.buckets.reduce((total, bucket) => total + bucket.count, 0),
      7,
    );
    assert.equal(
      overviewA.hourOfDay.buckets.reduce((total, bucket) => total + bucket.count, 0),
      7,
    );
  });

  it('7.6 跨用户隔离：B 的 overview 只统计 B 的数据', () => {
    assert.equal(overviewB.summary.memoCount, 3);
    assert.equal(overviewB.summary.templateCount, 1);
    assert.equal(overviewB.summary.totalChars, 6);
    assert.deepEqual(
      overviewB.summary.byTemplate.map((entry) => [entry.templateName, entry.count]),
      [
        ['B的模板', 1],
        ['无模板', 2],
      ],
    );
    assert.ok(
      !overviewB.numericFields.some((entry) => entry.templateId === t1 || entry.templateId === t2),
      'B 的概览不得包含 A 的模板',
    );
    assertJsonRoundTrip(overviewA);
    assertJsonRoundTrip(overviewB);
  });
});
/* -------------------------------------------------------------------------- */
/* 8. 性能基线与时区边界                                                       */
/* -------------------------------------------------------------------------- */

describe('性能基线（1000 条 memo）', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-perf');
    templateId = insertTemplate(ctx.db, userId, {
      name: '压测',
      fields: [
        { key: 'amount', label: '金额', type: 'number' },
        {
          key: 'cat',
          label: '类别',
          type: 'select',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
          ],
        },
        { key: 'note', label: '备注', type: 'text' },
      ],
    });

    const insert = ctx.db.prepare(
      `INSERT INTO memos (id, user_id, template_id, content, values_json, tags_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );

    // 1000 条包在一个事务里批量插入
    ctx.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 1000; index += 1) {
        const day = String(1 + (index % 30)).padStart(2, '0');
        // 本地日 = UTC 日（Asia/Shanghai +08:00 下，UTC 00..15 点仍属同一本地日）
        const createdAt = `2026-06-${day}T${String(index % 16).padStart(2, '0')}:00:00.000Z`;
        insert.run(
          uid(),
          userId,
          templateId,
          `第 ${index} 条记录 #标签${index % 10}`,
          JSON.stringify({ amount: index, cat: ['a', 'b', 'c'][index % 3], note: `备注${index}` }),
          JSON.stringify([`标签${index % 10}`]),
          createdAt,
          createdAt,
        );
      }
      ctx.db.exec('COMMIT');
    } catch (error) {
      ctx.db.exec('ROLLBACK');
      throw error;
    }
  });

  after(async () => {
    await ctx.close();
  });

  it('8.1 computeTemplateInsights 在 1000 条 memo 下 < 500ms（回归底线）', () => {
    let worstMs = 0;
    let insights: TemplateInsights | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedAt = performance.now();
      insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
        userId,
        templateId,
        from: '2026-06-01',
        to: '2026-06-30',
      });
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs > worstMs) worstMs = elapsedMs;
    }
    console.log(`[perf] 1000 条 memo 的 computeTemplateInsights 实测耗时（3 次取最慢）：${worstMs.toFixed(1)}ms`);

    assert.ok(insights !== null);
    assert.equal(insights!.summary.memoCount, 1000);
    assert.equal(insights!.summary.allMemoCount, 1000);
    assert.equal(pick(insights!.fields, (field) => field.key === 'amount', '缺 amount').numeric?.count, 1000);
    assert.equal(pick(insights!.fields, (field) => field.key === 'cat', '缺 cat').filled, 1000);
    assert.ok(worstMs < 500, `分析耗时 ${worstMs.toFixed(1)}ms 超过 500ms 回归底线`);
  });
});

describe('时区边界：daily 日边界与时区偏移', () => {
  let ctx: TestContext;
  let userId = '';
  let templateId = '';

  before(async () => {
    ctx = await createTestContext({ FLOMO_TZ: TZ });
    userId = uid();
    insertUser(ctx.db, userId, 'a3-boundary');
    templateId = insertTemplate(ctx.db, userId, { name: '边界', fields: [] });

    // UTC 日边界前后各一条；Asia/Shanghai（+08:00）的本地日边界在 UTC 16:00
    const rows: Array<{ at: string; content: string }> = [
      { at: '2026-04-30T15:59:59.999Z', content: '本地 04-30 23:59:59.999（外）' },
      { at: '2026-04-30T16:00:00.000Z', content: '本地 05-01 00:00:00.000（内）' },
      { at: '2026-04-30T16:30:00.000Z', content: '本地 05-01 00:30:00.000（内）' },
      { at: '2026-05-01T15:59:59.999Z', content: '本地 05-01 23:59:59.999（内）' },
      { at: '2026-05-01T16:00:00.000Z', content: '本地 05-02 00:00:00.000（外）' },
    ];
    for (const row of rows) {
      insertMemo(ctx.db, userId, { templateId, content: row.content, createdAt: row.at });
    }
  });

  after(async () => {
    await ctx.close();
  });

  it('8.2 from/to 落在本地日边界上，闭区间内外各一条', () => {
    const insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-05-01',
      to: '2026-05-01',
    });
    assert.equal(insights.range.from, '2026-05-01T00:00:00.000+08:00');
    assert.equal(insights.range.to, '2026-05-01T23:59:59.999+08:00');
    assert.equal(insights.range.days, 1);
    assert.equal(insights.summary.memoCount, 3, '恰好落在区间内的 3 条');
    assert.equal(insights.heatmap.days.length, 1);
    assert.deepEqual(insights.heatmap.days[0], { date: '2026-05-01', count: 3 });
  });

  it('8.3 UTC 16:30 的记录按本地 00:30 计入 hourOfDay[0]', () => {
    const insights = computeTemplateInsights(ctx.db, ctx.config.tz, {
      userId,
      templateId,
      from: '2026-05-01',
      to: '2026-05-01',
    });
    // 16:00Z → 本地 00:00；16:30Z → 本地 00:30；15:59:59.999Z → 本地 23:59:59.999
    assert.equal(insights.hourOfDay.buckets[0]?.count, 2, '跨时区边界必须落在本地 0 点桶');
    assert.equal(insights.hourOfDay.buckets[23]?.count, 1);
    assert.equal(
      insights.hourOfDay.buckets.reduce((total, bucket) => total + bucket.count, 0),
      3,
    );
  });
});

