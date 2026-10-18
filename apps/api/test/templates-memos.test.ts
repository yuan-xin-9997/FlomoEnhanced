/**
 * 模板与想法后端测试（SPEC §7、§8.2、§8.3、§9）—— 归 A2。
 *
 * 覆盖：认证前置、模板 CRUD、多用户隔离（一律 404）、归档/恢复/硬删除、复制命名、
 * 导入导出（三种冲突模式 + 部分条目非法 + formatVersion 错误）、想法 CRUD、
 * 标签提取、游标分页与过滤、摘要统计、删除语义。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type {
  ApiErrorBody,
  FieldDefinition,
  Memo,
  MemoListResponse,
  MemoSummary,
  Template,
  TemplateImportResult,
  TemplateListResponse,
  User,
} from '@flomo/shared';
import {
  addDaysToDayKey,
  localDayKeyOf,
  localDayStartUtcIso,
} from '../src/lib/time.js';
import { createTestContext, jsonHeaders, registerAndLogin, type TestContext } from './helpers.js';

const PASSWORD = 'S3cure-Passw0rd!';

type InjectResult = Awaited<ReturnType<FastifyInstance['inject']>>;

let ctx: TestContext;
/** 用户名 → { user, cookie } 缓存（避免重复 scrypt 注册耗时） */
const accountCache = new Map<string, { user: User; cookie: string }>();

async function account(name: string): Promise<{ user: User; cookie: string }> {
  const cached = accountCache.get(name);
  if (cached !== undefined) return cached;
  const created = await registerAndLogin(ctx.app, name, PASSWORD);
  accountCache.set(name, created);
  return created;
}

before(async () => {
  ctx = await createTestContext();
});

after(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

async function request(
  method: string,
  url: string,
  options: { cookie?: string; payload?: unknown } = {},
): Promise<InjectResult> {
  return await ctx.app.inject({
    method: method as 'GET',
    url,
    headers: jsonHeaders(options.cookie),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

const get = (url: string, cookie?: string): Promise<InjectResult> => request('GET', url, { cookie });
const post = (url: string, payload?: unknown, cookie?: string): Promise<InjectResult> =>
  request('POST', url, { payload: payload ?? {}, cookie });
const patch = (url: string, payload: unknown, cookie?: string): Promise<InjectResult> =>
  request('PATCH', url, { payload, cookie });
const del = (url: string, cookie?: string): Promise<InjectResult> => request('DELETE', url, { cookie });

async function expectError(res: InjectResult, status: number, code: string): Promise<ApiErrorBody> {
  assert.equal(res.statusCode, status, `期望 HTTP ${status}，实际 ${res.statusCode}：${res.body}`);
  const body = res.json() as ApiErrorBody;
  assert.equal(body.error.code, code, `期望错误码 ${code}，实际 ${body.error.code}`);
  return body;
}

function templateOf(res: InjectResult, expectedStatus = 201): Template {
  assert.equal(res.statusCode, expectedStatus, `期望 HTTP ${expectedStatus}，实际 ${res.statusCode}：${res.body}`);
  return res.json() as Template;
}

function memoOf(res: InjectResult, expectedStatus = 201): Memo {
  assert.equal(res.statusCode, expectedStatus, `期望 HTTP ${expectedStatus}，实际 ${res.statusCode}：${res.body}`);
  return res.json() as Memo;
}

/** 12 种字段类型各一个的合法定义 */
const ALL_TYPE_FIELDS: FieldDefinition[] = [
  { key: 'text_f', label: '单行', type: 'text', maxLength: 20 },
  { key: 'long_f', label: '多行', type: 'longtext' },
  { key: 'num_f', label: '数字', type: 'number', min: 0, max: 100 },
  { key: 'cur_f', label: '金额', type: 'currency', currency: 'CNY' },
  { key: 'pct_f', label: '百分比', type: 'percent' },
  { key: 'date_f', label: '日期', type: 'date' },
  { key: 'dt_f', label: '时间', type: 'datetime' },
  { key: 'sel_f', label: '单选', type: 'select', options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }] },
  { key: 'multi_f', label: '多选', type: 'multiselect', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
  { key: 'bool_f', label: '是否', type: 'boolean' },
  { key: 'rate_f', label: '评分', type: 'rating', scale: 5 },
  { key: 'url_f', label: '链接', type: 'url' },
];

async function createTemplate(
  cookie: string,
  name: string,
  fields: FieldDefinition[] = [{ key: 'title', label: '标题', type: 'text' }],
  extra: Record<string, unknown> = {},
): Promise<Template> {
  const res = await post('/api/templates', { name, fields, ...extra }, cookie);
  return templateOf(res);
}

function importFile(entries: unknown[], formatVersion = 1): Record<string, unknown> {
  return {
    format: 'flomo-enhanced-template',
    formatVersion,
    exportedAt: new Date().toISOString(),
    app: { name: 'FlomoEnhanced', version: '1.0.0' },
    templates: entries,
  };
}

function exportEntry(
  name: string,
  fields: FieldDefinition[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    description: '',
    icon: '',
    color: '',
    fields,
    templateVersion: 1,
    exportedId: '',
    ...extra,
  };
}

function dbCount(sql: string, ...params: Array<string | number>): number {
  const row = ctx.db.prepare(sql).get(...params) as unknown as { c?: number | bigint };
  return Number(row?.c ?? 0);
}

// ---------------------------------------------------------------------------
// 1. 未登录 → 401
// ---------------------------------------------------------------------------

describe('未登录访问', () => {
  it('模板与想法的全部端点都返回 401 UNAUTHENTICATED', async () => {
    const cases: Array<[string, string, unknown?]> = [
      ['GET', '/api/templates'],
      ['POST', '/api/templates', { name: 'x', fields: [] }],
      ['GET', '/api/templates/00000000-0000-0000-0000-000000000000'],
      ['PATCH', '/api/templates/00000000-0000-0000-0000-000000000000', { name: 'y' }],
      ['DELETE', '/api/templates/00000000-0000-0000-0000-000000000000'],
      ['POST', '/api/templates/00000000-0000-0000-0000-000000000000/restore'],
      ['POST', '/api/templates/00000000-0000-0000-0000-000000000000/duplicate'],
      ['GET', '/api/templates/export'],
      ['POST', '/api/templates/import', importFile([])],
      ['GET', '/api/memos'],
      ['POST', '/api/memos', { content: 'x' }],
      ['GET', '/api/memos/summary'],
      ['GET', '/api/memos/00000000-0000-0000-0000-000000000000'],
      ['PATCH', '/api/memos/00000000-0000-0000-0000-000000000000', { content: 'y' }],
      ['DELETE', '/api/memos/00000000-0000-0000-0000-000000000000'],
    ];

    for (const [method, url, payload] of cases) {
      const res = await request(method, url, { payload });
      const body = await expectError(res, 401, 'UNAUTHENTICATED');
      assert.equal(typeof body.error.message, 'string');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. 创建模板 / 非法字段定义
// ---------------------------------------------------------------------------

describe('创建模板', () => {
  it('12 种字段类型全部可用，返回完整 DTO', async () => {
    const { cookie } = await account('alice');
    const res = await post(
      '/api/templates',
      { name: '全字段模板', description: '覆盖 12 种类型', icon: '📝', color: '#3b82f6', fields: ALL_TYPE_FIELDS },
      cookie,
    );
    const template = templateOf(res);
    assert.equal(template.fields.length, 12);
    assert.deepEqual(
      template.fields.map((field) => field.type).sort(),
      [
        'boolean', 'currency', 'date', 'datetime', 'longtext', 'multiselect',
        'number', 'percent', 'rating', 'select', 'text', 'url',
      ].sort(),
    );
    assert.equal(template.version, 1);
    assert.equal(template.memoCount, 0);
    assert.equal(template.archivedAt, null);
    assert.equal(template.description, '覆盖 12 种类型');
    assert.equal(template.icon, '📝');
    assert.equal(template.color, '#3b82f6');
    assert.ok(Number.isFinite(Date.parse(template.createdAt)));
    assert.ok(Number.isFinite(Date.parse(template.updatedAt)));
  });

  it('非法字段定义 → 422 VALIDATION_FAILED（details 为错误数组）', async () => {
    const { cookie } = await account('alice');
    const badCases: Array<[string, FieldDefinition[]]> = [
      ['key 重复', [
        { key: 'dup', label: 'A', type: 'text' },
        { key: 'dup', label: 'B', type: 'text' },
      ]],
      ['select 无 options', [{ key: 'sel', label: '单选', type: 'select' }]],
      ['currency 非三字母', [{ key: 'cur', label: '金额', type: 'currency', currency: 'cny' }]],
      ['label 为空', [{ key: 'lab', label: '', type: 'text' }]],
    ];

    for (const [label, fields] of badCases) {
      const res = await post('/api/templates', { name: `坏模板-${label}`, fields }, cookie);
      const body = await expectError(res, 422, 'VALIDATION_FAILED');
      assert.ok(Array.isArray(body.error.details), `${label}：details 应为数组`);
      assert.ok((body.error.details as unknown[]).length > 0, `${label}：details 不应为空`);
    }
  });

  it('名称/颜色/图标/描述也受约束', async () => {
    const { cookie } = await account('alice');
    await expectError(await post('/api/templates', { name: '', fields: [] }, cookie), 422, 'VALIDATION_FAILED');
    await expectError(await post('/api/templates', { name: 'x'.repeat(61), fields: [] }, cookie), 422, 'VALIDATION_FAILED');
    await expectError(
      await post('/api/templates', { name: '颜色非法', color: 'red', fields: [] }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    await expectError(
      await post('/api/templates', { name: '图标太长', icon: '123456789', fields: [] }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    await expectError(
      await post('/api/templates', { name: '描述太长', description: 'x'.repeat(501), fields: [] }, cookie),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('同名模板 → 409 CONFLICT', async () => {
    const { cookie } = await account('alice');
    await createTemplate(cookie, '重名模板');
    const res = await post('/api/templates', { name: '重名模板', fields: [] }, cookie);
    const body = await expectError(res, 409, 'CONFLICT');
    assert.match(body.error.message, /同名/);
  });
});

// ---------------------------------------------------------------------------
// 3. 多用户隔离（模板）
// ---------------------------------------------------------------------------

describe('多用户隔离（模板）', () => {
  it('B 对 A 的模板做任何操作都是 404，且 B 的列表看不到 A 的模板', async () => {
    const a = await account('iso_a');
    const b = await account('iso_b');
    const template = await createTemplate(a.cookie, 'A 的模板', [{ key: 'title', label: '标题', type: 'text' }], {
      description: '仅 A 可见',
    });

    await expectError(await get(`/api/templates/${template.id}`, b.cookie), 404, 'NOT_FOUND');
    await expectError(await patch(`/api/templates/${template.id}`, { name: '被篡改' }, b.cookie), 404, 'NOT_FOUND');
    await expectError(await del(`/api/templates/${template.id}`, b.cookie), 404, 'NOT_FOUND');
    await expectError(await del(`/api/templates/${template.id}?hard=1`, b.cookie), 404, 'NOT_FOUND');
    await expectError(await post(`/api/templates/${template.id}/duplicate`, {}, b.cookie), 404, 'NOT_FOUND');
    await expectError(await post(`/api/templates/${template.id}/restore`, {}, b.cookie), 404, 'NOT_FOUND');
    await expectError(await get(`/api/templates/export?ids=${template.id}`, b.cookie), 404, 'NOT_FOUND');

    const listRes = await get('/api/templates', b.cookie);
    assert.equal(listRes.statusCode, 200);
    const list = listRes.json() as TemplateListResponse;
    assert.equal(list.items.find((item) => item.id === template.id), undefined);

    // A 的模板仍然完好
    const stillThere = await get(`/api/templates/${template.id}`, a.cookie);
    assert.equal(stillThere.statusCode, 200);
    assert.equal((stillThere.json() as Template).name, 'A 的模板');

    // 不存在的 id 同样是 404（与越权不可区分）
    await expectError(await get('/api/templates/00000000-0000-0000-0000-000000000000', a.cookie), 404, 'NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 4. PATCH：fields 替换 → version+1；历史 memo 保留已删除的 key
// ---------------------------------------------------------------------------

describe('模板局部更新', () => {
  it('fields 整体替换后 version+1，历史想法的已删除字段值仍然保留', async () => {
    const { cookie } = await account('patch_user');
    const template = await createTemplate(cookie, '账单', [
      { key: 'title', label: '标题', type: 'text' },
      { key: 'amount', label: '金额', type: 'currency' },
    ]);

    const memo = memoOf(
      await post('/api/memos', { templateId: template.id, values: { title: '午饭', amount: 25.5 } }, cookie),
    );
    assert.deepEqual(memo.values, { title: '午饭', amount: 25.5 });

    const patched = templateOf(
      await patch(`/api/templates/${template.id}`, { fields: [{ key: 'title', label: '标题', type: 'text' }] }, cookie),
      200,
    );
    assert.equal(patched.version, 2);
    assert.equal(patched.fields.length, 1);
    assert.equal(patched.fields[0]?.key, 'title');

    // 历史 memo 的 amount 键没有被删除
    const reread = memoOf(await get(`/api/memos/${memo.id}`, cookie), 200);
    assert.deepEqual(reread.values, { title: '午饭', amount: 25.5 });
    assert.equal(reread.templateId, template.id);

    // 只改描述不升版本
    const renamed = templateOf(await patch(`/api/templates/${template.id}`, { description: '新的描述' }, cookie), 200);
    assert.equal(renamed.version, 2);
    assert.equal(renamed.description, '新的描述');

    // 改成已存在的名字 → 409
    await createTemplate(cookie, '另一个模板');
    await expectError(await patch(`/api/templates/${template.id}`, { name: '另一个模板' }, cookie), 409, 'CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// 5. 归档 / 恢复 / 硬删除
// ---------------------------------------------------------------------------

describe('归档、恢复与硬删除', () => {
  it('软删除写 archived_at；恢复清空；硬删除后想法仍在但 templateId 为 null', async () => {
    const { cookie } = await account('archive_user');
    const template = await createTemplate(cookie, '归档模板', [
      { key: 'note', label: '备注', type: 'text' },
    ]);
    const memo = memoOf(
      await post('/api/memos', { templateId: template.id, values: { note: '历史值' } }, cookie),
    );

    // 归档
    assert.equal((await del(`/api/templates/${template.id}`, cookie)).statusCode, 204);
    const archived = templateOf(await get(`/api/templates/${template.id}`, cookie), 200);
    assert.ok(archived.archivedAt !== null);
    assert.ok(Number.isFinite(Date.parse(archived.archivedAt ?? '')));

    const activeList = (await get('/api/templates', cookie)).json() as TemplateListResponse;
    assert.equal(activeList.items.find((item) => item.id === template.id), undefined);
    const allList = (await get('/api/templates?includeArchived=1', cookie)).json() as TemplateListResponse;
    assert.ok(allList.items.find((item) => item.id === template.id) !== undefined);

    // 归档后不能再用来记录想法
    await expectError(await post('/api/memos', { templateId: template.id, values: { note: 'x' } }, cookie), 404, 'NOT_FOUND');

    // 恢复
    const restored = templateOf(await post(`/api/templates/${template.id}/restore`, {}, cookie), 200);
    assert.equal(restored.archivedAt, null);

    // 硬删除
    assert.equal((await del(`/api/templates/${template.id}?hard=1`, cookie)).statusCode, 204);
    await expectError(await get(`/api/templates/${template.id}`, cookie), 404, 'NOT_FOUND');

    const keptMemo = memoOf(await get(`/api/memos/${memo.id}`, cookie), 200);
    assert.equal(keptMemo.templateId, null);
    assert.equal(keptMemo.templateName, null);
    assert.deepEqual(keptMemo.values, { note: '历史值' });

    const row = ctx.db
      .prepare('SELECT template_id, values_json FROM memos WHERE id = ?')
      .get(memo.id) as unknown as { template_id: string | null; values_json: string };
    assert.equal(row.template_id, null);
    assert.equal(row.values_json, JSON.stringify({ note: '历史值' }));
  });
});

// ---------------------------------------------------------------------------
// 6. 复制命名
// ---------------------------------------------------------------------------

describe('复制模板', () => {
  it('命名为「<原名> 副本」，冲突时依次加「 2」「 3」', async () => {
    const { cookie } = await account('dup_user');
    const source = await createTemplate(cookie, '周报', [
      { key: 'title', label: '标题', type: 'text' },
      { key: 'sel', label: '单选', type: 'select', options: [{ value: 'a', label: '甲' }] },
    ]);

    const first = templateOf(await post(`/api/templates/${source.id}/duplicate`, {}, cookie));
    assert.equal(first.name, '周报 副本');
    assert.equal(first.version, 1);
    assert.equal(first.archivedAt, null);
    assert.deepEqual(first.fields, source.fields);
    assert.notEqual(first.id, source.id);

    const second = templateOf(await post(`/api/templates/${source.id}/duplicate`, {}, cookie));
    assert.equal(second.name, '周报 副本 2');

    const third = templateOf(await post(`/api/templates/${source.id}/duplicate`, {}, cookie));
    assert.equal(third.name, '周报 副本 3');

    // 复制出的模板 key 不变，历史值可继续使用
    assert.deepEqual(
      third.fields.map((field) => field.key),
      source.fields.map((field) => field.key),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. 导出
// ---------------------------------------------------------------------------

describe('导出模板', () => {
  it('返回标准文件结构，?ids= 只导出指定模板，指定他人模板 → 404', async () => {
    const a = await account('export_a');
    const b = await account('export_b');
    const one = await createTemplate(a.cookie, '导出一');
    const two = await createTemplate(a.cookie, '导出二');
    const other = await createTemplate(b.cookie, '别人的模板');

    const all = await get('/api/templates/export', a.cookie);
    assert.equal(all.statusCode, 200);
    assert.match(String(all.headers['content-type']), /application\/json/);
    assert.match(
      String(all.headers['content-disposition']),
      /^attachment; filename="flomo-templates-\d{8}\.json"$/,
    );
    const allFile = all.json() as {
      format: string;
      formatVersion: number;
      templates: Array<{ name: string; exportedId: string }>;
    };
    assert.equal(allFile.format, 'flomo-enhanced-template');
    assert.equal(allFile.formatVersion, 1);
    const names = allFile.templates.map((entry) => entry.name);
    assert.ok(names.includes('导出一') && names.includes('导出二'));
    assert.ok(!names.includes('别人的模板'));

    const partial = (await get(`/api/templates/export?ids=${one.id}`, a.cookie)).json() as {
      templates: Array<{ exportedId: string }>;
    };
    assert.equal(partial.templates.length, 1);
    assert.equal(partial.templates[0]?.exportedId, one.id);

    const both = (await get(`/api/templates/export?ids=${one.id},${two.id}`, a.cookie)).json() as {
      templates: Array<{ exportedId: string }>;
    };
    assert.equal(both.templates.length, 2);

    await expectError(await get(`/api/templates/export?ids=${other.id}`, a.cookie), 404, 'NOT_FOUND');
    // 归档模板默认不导出
    await del(`/api/templates/${two.id}`, a.cookie);
    const afterArchive = (await get('/api/templates/export', a.cookie)).json() as {
      templates: Array<{ exportedId: string }>;
    };
    assert.ok(!afterArchive.templates.some((entry) => entry.exportedId === two.id));
  });
});

// ---------------------------------------------------------------------------
// 8. 导入
// ---------------------------------------------------------------------------

describe('导入模板', () => {
  it('正常导入（新增）', async () => {
    const { cookie } = await account('import_new');
    const res = await post(
      '/api/templates/import',
      importFile([exportEntry('新模板', [{ key: 'title', label: '标题', type: 'text' }], { description: '来自文件' })]),
      cookie,
    );
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as TemplateImportResult;
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0]?.name, '新模板');
    assert.equal(result.imported[0]?.description, '来自文件');
    assert.equal(result.imported[0]?.memoCount, 0);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.overwritten, []);
    assert.deepEqual(result.errors, []);
  });

  it('rename（默认）：同名自动加「 2」「 3」', async () => {
    const { cookie } = await account('import_rename');
    await createTemplate(cookie, '重名导入');

    const file = importFile([exportEntry('重名导入', [{ key: 'title', label: '标题', type: 'text' }])]);
    const first = (await post('/api/templates/import', file, cookie)).json() as TemplateImportResult;
    assert.equal(first.imported.length, 1);
    assert.equal(first.imported[0]?.name, '重名导入 2');

    const second = (await post('/api/templates/import', file, cookie)).json() as TemplateImportResult;
    assert.equal(second.imported[0]?.name, '重名导入 3');

    // 库里确实有 3 个不同名称的模板
    const list = (await get('/api/templates', cookie)).json() as TemplateListResponse;
    assert.deepEqual(
      list.items.map((item) => item.name).sort(),
      ['重名导入', '重名导入 2', '重名导入 3'].sort(),
    );
  });

  it('skip：同名进 skipped', async () => {
    const { cookie } = await account('import_skip');
    await createTemplate(cookie, '跳过导入');

    const res = await post(
      '/api/templates/import?mode=skip',
      importFile([exportEntry('跳过导入', [{ key: 'title', label: '标题', type: 'text' }])]),
      cookie,
    );
    const result = res.json() as TemplateImportResult;
    assert.deepEqual(result.imported, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.name, '跳过导入');
    assert.ok((result.skipped[0]?.reason ?? '').length > 0);

    // mode 也可以放在请求体里；非法 mode → 422
    const viaBody = importFile([exportEntry('跳过导入', [{ key: 'title', label: '标题', type: 'text' }])]);
    viaBody.mode = 'skip';
    const viaBodyResult = (await post('/api/templates/import', viaBody, cookie)).json() as TemplateImportResult;
    assert.equal(viaBodyResult.skipped.length, 1);

    const badMode = importFile([exportEntry('随便', [{ key: 'title', label: '标题', type: 'text' }])]);
    badMode.mode = 'replace';
    await expectError(await post('/api/templates/import', badMode, cookie), 422, 'VALIDATION_FAILED');
  });

  it('overwrite：保留 id 与已有关联想法，version+1', async () => {
    const { cookie } = await account('import_overwrite');
    const target = await createTemplate(cookie, '覆盖导入', [
      { key: 'old_field', label: '旧字段', type: 'text' },
    ]);
    const memo = memoOf(
      await post('/api/memos', { templateId: target.id, values: { old_field: '旧值' } }, cookie),
    );

    const res = await post(
      '/api/templates/import?mode=overwrite',
      importFile([
        exportEntry('覆盖导入', [{ key: 'new_field', label: '新字段', type: 'number' }], {
          description: '覆盖后的描述',
        }),
      ]),
      cookie,
    );
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as TemplateImportResult;
    assert.equal(result.overwritten.length, 1);
    const overwritten = result.overwritten[0];
    assert.equal(overwritten?.id, target.id);
    assert.equal(overwritten?.name, '覆盖导入');
    assert.equal(overwritten?.description, '覆盖后的描述');
    assert.equal(overwritten?.version, 2);
    assert.deepEqual(overwritten?.fields.map((field) => field.key), ['new_field']);
    assert.equal(overwritten?.memoCount, 1);

    const kept = memoOf(await get(`/api/memos/${memo.id}`, cookie), 200);
    assert.equal(kept.templateId, target.id);
    assert.deepEqual(kept.values, { old_field: '旧值' });
  });

  it('部分条目非法：错误有明细（index/name/message），合法条目照常导入', async () => {
    const { cookie } = await account('import_partial');
    const res = await post(
      '/api/templates/import',
      importFile([
        exportEntry('坏模板', [{ key: 'bad', label: '坏', type: 'select' }]),
        exportEntry('好模板', [{ key: 'ok', label: '好', type: 'text' }]),
      ]),
      cookie,
    );
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as TemplateImportResult;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.index, 0);
    assert.equal(result.errors[0]?.name, '坏模板');
    assert.ok((result.errors[0]?.message ?? '').length > 0);
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0]?.name, '好模板');

    // 缺少名称的条目：name 回退为可读文案
    const missing = await post('/api/templates/import', importFile([{ fields: [] }]), cookie);
    const missingResult = missing.json() as TemplateImportResult;
    assert.equal(missingResult.errors.length, 1);
    assert.equal(missingResult.errors[0]?.name, '第 1 个模板');
  });

  it('formatVersion 错误 → 400；整体失败不入库', async () => {
    const { cookie } = await account('import_bad_version');
    const before = dbCount('SELECT COUNT(*) AS c FROM templates WHERE user_id = ?', (await account('import_bad_version')).user.id);
    const res = await post(
      '/api/templates/import',
      importFile([exportEntry('不该导入', [{ key: 'title', label: '标题', type: 'text' }])], 2),
      cookie,
    );
    await expectError(res, 400, 'VALIDATION_FAILED');
    const after = dbCount('SELECT COUNT(*) AS c FROM templates WHERE user_id = ?', (await account('import_bad_version')).user.id);
    assert.equal(after, before);

    // format 不匹配同样 400
    const wrongFormat = importFile([]);
    wrongFormat.format = 'something-else';
    await expectError(await post('/api/templates/import', wrongFormat, cookie), 400, 'VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// 9. 想法：创建
// ---------------------------------------------------------------------------

describe('创建想法', () => {
  it('不用模板（只有 content）→ templateId 为 null、values 为空对象', async () => {
    const { cookie } = await account('memo_plain');
    const res = await post('/api/memos', { content: '随手记一条 #灵感' }, cookie);
    const memo = memoOf(res);
    assert.equal(memo.templateId, null);
    assert.equal(memo.templateName, null);
    assert.deepEqual(memo.values, {});
    assert.deepEqual(memo.tags, ['灵感']);
    assert.equal(memo.content, '随手记一条 #灵感');
  });

  it('使用模板：字段全部合法，未知 key 被忽略，multiselect 按 options 顺序', async () => {
    const { cookie } = await account('memo_template');
    const template = await createTemplate(cookie, '记账', ALL_TYPE_FIELDS);
    const res = await post(
      '/api/memos',
      {
        content: '今天的记录',
        templateId: template.id,
        values: {
          text_f: 'ok',
          long_f: '多行文本',
          num_f: 12.5,
          cur_f: 99.9,
          pct_f: 50,
          date_f: '2026-10-01',
          dt_f: '2026-10-01T08:00:00+08:00',
          sel_f: 'a',
          multi_f: ['y', 'x'],
          bool_f: true,
          rate_f: 4,
          url_f: 'https://example.com/x',
          unknown_key: '应被忽略',
        },
      },
      cookie,
    );
    const memo = memoOf(res);
    assert.equal(memo.templateId, template.id);
    assert.equal(memo.templateName, '记账');
    assert.equal(memo.values.text_f, 'ok');
    assert.equal(memo.values.num_f, 12.5);
    assert.equal(memo.values.cur_f, 99.9);
    assert.equal(memo.values.pct_f, 50);
    assert.equal(memo.values.date_f, '2026-10-01');
    assert.deepEqual(memo.values.multi_f, ['x', 'y']);
    assert.equal(memo.values.bool_f, true);
    assert.equal(memo.values.rate_f, 4);
    assert.equal(memo.values.unknown_key, undefined);
    assert.equal(Object.keys(memo.values).length, 12);
  });

  it('content 与 values 同时为空 → 422', async () => {
    const { cookie } = await account('memo_empty');
    const body = await expectError(await post('/api/memos', { content: '', values: {} }, cookie), 422, 'VALIDATION_FAILED');
    assert.match(body.error.message, /内容|字段/);
    await expectError(await post('/api/memos', { content: '   ' }, cookie), 422, 'VALIDATION_FAILED');
  });

  it('必填字段缺失 → 422；非法取值 → 422', async () => {
    const { cookie } = await account('memo_required');
    const template = await createTemplate(cookie, '带必填', [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'amount', label: '金额', type: 'number', min: 0, max: 100 },
      { key: 'kind', label: '类型', type: 'select', options: [{ value: 'a', label: '甲' }] },
    ]);

    // 必填缺失
    await expectError(await post('/api/memos', { templateId: template.id, values: {} }, cookie), 422, 'VALIDATION_FAILED');
    // 超出 maxLength（text 默认 200）
    await expectError(
      await post('/api/memos', { templateId: template.id, values: { title: 'x'.repeat(201) } }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    // 数值越界
    await expectError(
      await post('/api/memos', { templateId: template.id, values: { title: 'ok', amount: 1000 } }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    // select 未命中 option
    await expectError(
      await post('/api/memos', { templateId: template.id, values: { title: 'ok', kind: 'zzz' } }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    // values 不是对象
    await expectError(
      await post('/api/memos', { templateId: template.id, values: ['a'] }, cookie),
      422,
      'VALIDATION_FAILED',
    );
    // 无模板却给 values
    await expectError(await post('/api/memos', { content: 'x', values: { title: 'a' } }, cookie), 422, 'VALIDATION_FAILED');

    // required 为 false 时允许缺省；boolean false 视为有值
    const ok = memoOf(
      await post('/api/memos', { templateId: template.id, values: { title: '合法', kind: 'a' } }, cookie),
    );
    assert.equal(ok.values.title, '合法');
    assert.equal(ok.values.amount, undefined);
  });

  it('content 超过 10000 字符 → 422；非法 createdAt → 422；未来时间允许', async () => {
    const { cookie } = await account('memo_limits');
    await expectError(await post('/api/memos', { content: 'x'.repeat(10001) }, cookie), 422, 'VALIDATION_FAILED');
    await expectError(await post('/api/memos', { content: 'x', createdAt: '不是时间' }, cookie), 422, 'VALIDATION_FAILED');

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const memo = memoOf(await post('/api/memos', { content: '未来', createdAt: future }, cookie));
    assert.equal(memo.createdAt, future);

    const past = '2026-01-02T03:04:05+08:00';
    const memo2 = memoOf(await post('/api/memos', { content: '过去', createdAt: past }, cookie));
    assert.equal(memo2.createdAt, '2026-01-01T19:04:05.000Z');
  });
});

// ---------------------------------------------------------------------------
// 10. 想法：列表、分页与过滤
// ---------------------------------------------------------------------------

describe('想法列表与分页', () => {
  it('游标分页：5 条 / limit=2 翻页无重复无遗漏，total 正确', async () => {
    const { cookie } = await account('memo_paging');
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 10, 0, index, 0)).toISOString();
      const memo = memoOf(await post('/api/memos', { content: `分页-${index}`, createdAt }, cookie));
      created.push(memo.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let firstTotal = -1;
    do {
      const url = cursor === null ? '/api/memos?limit=2' : `/api/memos?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(url, cookie);
      assert.equal(res.statusCode, 200, res.body);
      const page = res.json() as MemoListResponse;
      if (firstTotal === -1) firstTotal = page.total;
      else assert.equal(page.total, firstTotal);
      for (const item of page.items) seen.push(item.id);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 10, '分页似乎没有终止');
    } while (cursor !== null);

    assert.equal(pages, 3);
    assert.equal(firstTotal, 5);
    assert.equal(seen.length, 5);
    assert.equal(new Set(seen).size, 5);
    assert.deepEqual([...seen].sort(), [...created].sort());

    // 降序：第一条应是最后创建的
    const firstPage = (await get('/api/memos?limit=2', cookie)).json() as MemoListResponse;
    assert.equal(firstPage.items[0]?.id, created[4]);

    // 非法游标 → 422
    await expectError(await get('/api/memos?cursor=!!!not-a-cursor', cookie), 422, 'VALIDATION_FAILED');
    // limit 越界夹取（0 → 1），非法 → 422
    const clamped = (await get('/api/memos?limit=0', cookie)).json() as MemoListResponse;
    assert.equal(clamped.items.length, 1);
    const maxClamped = (await get('/api/memos?limit=999', cookie)).json() as MemoListResponse;
    assert.equal(maxClamped.items.length, 5);
    await expectError(await get('/api/memos?limit=abc', cookie), 422, 'VALIDATION_FAILED');
  });

  it('templateId / from / to / tag / q 过滤各自生效', async () => {
    const { cookie } = await account('memo_filter');
    const template = await createTemplate(cookie, '过滤模板');
    const tz = ctx.config.tz;
    const todayKey = localDayKeyOf(Date.now(), tz);
    const day = (offset: number): string => addDaysToDayKey(todayKey, offset);
    const at = (offset: number, hour: number): string =>
      new Date(Date.parse(localDayStartUtcIso(day(offset), tz)) + hour * 3_600_000).toISOString();

    const withTemplate = memoOf(
      await post('/api/memos', { content: '带模板 #工作', templateId: template.id, createdAt: at(0, 9) }, cookie),
    );
    const noTemplate = memoOf(
      await post('/api/memos', { content: '无模板 #工作台 needle', createdAt: at(-1, 9) }, cookie),
    );
    // 区间外的想法，用于验证 from/to 过滤
    await post('/api/memos', { content: '很久以前', createdAt: at(-10, 9) }, cookie);

    const byTemplate = (await get(`/api/memos?templateId=${template.id}`, cookie)).json() as MemoListResponse;
    assert.deepEqual(byTemplate.items.map((item) => item.id), [withTemplate.id]);
    assert.equal(byTemplate.total, 1);

    const byNull = (await get('/api/memos?templateId=null', cookie)).json() as MemoListResponse;
    assert.equal(byNull.total, 2);

    const byRange = (await get(`/api/memos?from=${day(-1)}&to=${day(0)}`, cookie)).json() as MemoListResponse;
    assert.equal(byRange.total, 2);
    assert.deepEqual(byRange.items.map((item) => item.id).sort(), [withTemplate.id, noTemplate.id].sort());

    const onlyToday = (await get(`/api/memos?from=${day(0)}&to=${day(0)}`, cookie)).json() as MemoListResponse;
    assert.deepEqual(onlyToday.items.map((item) => item.id), [withTemplate.id]);

    // tag 精确匹配：工作 不应匹配 工作台
    const byTag = (await get('/api/memos?tag=%E5%B7%A5%E4%BD%9C', cookie)).json() as MemoListResponse;
    assert.deepEqual(byTag.items.map((item) => item.id), [withTemplate.id]);
    const byTag2 = (await get('/api/memos?tag=%E5%B7%A5%E4%BD%9C%E5%8F%B0', cookie)).json() as MemoListResponse;
    assert.deepEqual(byTag2.items.map((item) => item.id), [noTemplate.id]);

    // q：content 模糊
    const byQ = (await get('/api/memos?q=needle', cookie)).json() as MemoListResponse;
    assert.deepEqual(byQ.items.map((item) => item.id), [noTemplate.id]);

    // q 的 % 是字面量，不是通配符
    await post('/api/memos', { content: '100% 完成', createdAt: at(0, 10) }, cookie);
    const byPercent = (await get('/api/memos?q=%25', cookie)).json() as MemoListResponse;
    assert.equal(byPercent.total, 1);
    assert.equal(byPercent.items[0]?.content, '100% 完成');

    // from > to → 422
    await expectError(await get(`/api/memos?from=${day(0)}&to=${day(-1)}`, cookie), 422, 'VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// 11. 标签提取
// ---------------------------------------------------------------------------

describe('标签提取', () => {
  it('content 的 #标签、显式 tags、去重、# 不入库、超长截断到 50', async () => {
    const { cookie } = await account('memo_tags');
    const longTag = 'A'.repeat(60);
    const res = await post(
      '/api/memos',
      {
        content: '#工作 今天做了 #复盘 #工作',
        tags: ['#工作', '显式标签', longTag],
      },
      cookie,
    );
    const memo = memoOf(res);
    // 顺序：先 content 中出现的（去重），再显式标签
    assert.deepEqual(memo.tags.slice(0, 2), ['工作', '复盘']);
    assert.ok(memo.tags.includes('显式标签'));
    assert.ok(!memo.tags.some((tag) => tag.startsWith('#')));
    assert.equal(new Set(memo.tags).size, memo.tags.length);
    // shared 的 `normalizeTag` 对超长标签做截断（≤50 字符）而非丢弃
    const truncated = memo.tags.find((tag) => tag.startsWith('AAA'));
    assert.equal(truncated?.length, 50);
  });
});

// ---------------------------------------------------------------------------
// 12. 编辑想法
// ---------------------------------------------------------------------------

describe('编辑想法', () => {
  it('改 templateId 未给 values → 422；templateId: null 取消模板并清空 values；改内容后 tags 重算', async () => {
    const { cookie } = await account('memo_update');
    const first = await createTemplate(cookie, '模板一', [
      { key: 'title', label: '标题', type: 'text' },
    ]);
    const second = await createTemplate(cookie, '模板二', [
      { key: 'note', label: '备注', type: 'text' },
    ]);

    const memo = memoOf(
      await post('/api/memos', { content: '原始 #旧标签', templateId: first.id, values: { title: '原值' } }, cookie),
    );
    assert.deepEqual(memo.tags, ['旧标签']);

    // 切换模板但没给 values → 422
    await expectError(await patch(`/api/memos/${memo.id}`, { templateId: second.id }, cookie), 422, 'VALIDATION_FAILED');
    // 切换比赛：给 values 就可以
    const switched = memoOf(
      await patch(`/api/memos/${memo.id}`, { templateId: second.id, values: { note: '新值' } }, cookie),
      200,
    );
    assert.equal(switched.templateId, second.id);
    assert.equal(switched.templateName, '模板二');
    assert.deepEqual(switched.values, { note: '新值' });

    // 取消模板：必须给 values，随后清空
    await expectError(await patch(`/api/memos/${memo.id}`, { templateId: null }, cookie), 422, 'VALIDATION_FAILED');
    const cancelled = memoOf(await patch(`/api/memos/${memo.id}`, { templateId: null, values: {} }, cookie), 200);
    assert.equal(cancelled.templateId, null);
    assert.equal(cancelled.templateName, null);
    assert.deepEqual(cancelled.values, {});

    // 改内容 → 标签按新内容重算
    const updated = memoOf(await patch(`/api/memos/${memo.id}`, { content: '换了内容 #新标签' }, cookie), 200);
    assert.deepEqual(updated.tags, ['新标签']);
    assert.equal(updated.content, '换了内容 #新标签');
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(updated.createdAt));

    // 显式 tags 合并
    const withExplicit = memoOf(
      await patch(`/api/memos/${memo.id}`, { content: '再换 #甲', tags: ['乙'] }, cookie),
      200,
    );
    assert.deepEqual(withExplicit.tags, ['甲', '乙']);

    // 未使用模板却提交 values → 422
    await expectError(await patch(`/api/memos/${memo.id}`, { values: { title: 'x' } }, cookie), 422, 'VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// 13. 删除想法
// ---------------------------------------------------------------------------

describe('删除想法', () => {
  it('软删除后列表/详情 404，数据库行仍在且 deleted_at 非空', async () => {
    const { cookie } = await account('memo_delete');
    const memo = memoOf(await post('/api/memos', { content: '待删除' }, cookie));

    assert.equal((await del(`/api/memos/${memo.id}`, cookie)).statusCode, 204);
    await expectError(await get(`/api/memos/${memo.id}`, cookie), 404, 'NOT_FOUND');
    await expectError(await patch(`/api/memos/${memo.id}`, { content: '改了' }, cookie), 404, 'NOT_FOUND');
    await expectError(await del(`/api/memos/${memo.id}`, cookie), 404, 'NOT_FOUND');

    const list = (await get('/api/memos', cookie)).json() as MemoListResponse;
    assert.equal(list.items.find((item) => item.id === memo.id), undefined);

    const row = ctx.db
      .prepare('SELECT deleted_at, content FROM memos WHERE id = ?')
      .get(memo.id) as unknown as { deleted_at: string | null; content: string };
    assert.ok(row.deleted_at !== null);
    assert.equal(row.content, '待删除');
  });
});

// ---------------------------------------------------------------------------
// 14. 摘要
// ---------------------------------------------------------------------------

describe('想法摘要', () => {
  it('byTemplate 含「无模板」、heatmap 补齐每一天、连续天数与首末时间正确', async () => {
    const { cookie } = await account('memo_summary');
    const tz = ctx.config.tz;
    const todayKey = localDayKeyOf(Date.now(), tz);
    const day = (offset: number): string => addDaysToDayKey(todayKey, offset);
    const at = (offset: number, hour: number): string =>
      new Date(Date.parse(localDayStartUtcIso(day(offset), tz)) + hour * 3_600_000).toISOString();

    const template = await createTemplate(cookie, '复盘', [
      { key: 'done', label: '完成', type: 'boolean' },
    ]);

    // d-4、d-3 相邻（最长连续 2），d-1、d 相邻（当前连续 2）
    await post('/api/memos', { content: '无模板 1', createdAt: at(-4, 9) }, cookie);
    await post('/api/memos', { content: '带模板 1', templateId: template.id, values: { done: true }, createdAt: at(-3, 10) }, cookie);
    await post('/api/memos', { content: '带模板 2', templateId: template.id, values: { done: false }, createdAt: at(-1, 11) }, cookie);
    await post('/api/memos', { content: '无模板 2', createdAt: at(0, 12) }, cookie);

    const res = await get(`/api/memos/summary?from=${day(-5)}&to=${day(0)}`, cookie);
    assert.equal(res.statusCode, 200, res.body);
    const summary = res.json() as MemoSummary;

    assert.equal(summary.total, 4);
    assert.equal(summary.activeDays, 4);
    assert.equal(summary.longestStreak, 2);
    assert.equal(summary.currentStreak, 2);
    assert.equal(summary.firstMemoAt, at(-4, 9));
    assert.equal(summary.lastMemoAt, at(0, 12));

    // heatmap 补齐区间内每一天（d-5 … d，共 6 天）
    assert.deepEqual(
      summary.heatmap.map((entry) => entry.date),
      [day(-5), day(-4), day(-3), day(-2), day(-1), day(0)],
    );
    assert.deepEqual(
      summary.heatmap.map((entry) => entry.count),
      [0, 1, 1, 0, 1, 1],
    );

    // byTemplate 必定包含「无模板」项
    const none = summary.byTemplate.find((entry) => entry.templateId === null);
    assert.ok(none !== undefined, 'byTemplate 必须包含 templateId: null 的「无模板」项');
    assert.equal(none?.templateName, '无模板');
    assert.equal(none?.count, 2);
    const withTemplate = summary.byTemplate.find((entry) => entry.templateId === template.id);
    assert.equal(withTemplate?.templateName, '复盘');
    assert.equal(withTemplate?.count, 2);

    // 空数据区间：结构完整、计数为 0
    const emptyRes = await get(`/api/memos/summary?from=${day(-40)}&to=${day(-30)}`, cookie);
    const empty = emptyRes.json() as MemoSummary;
    assert.equal(empty.total, 0);
    assert.equal(empty.activeDays, 0);
    assert.equal(empty.longestStreak, 0);
    assert.equal(empty.currentStreak, 0);
    assert.equal(empty.firstMemoAt, null);
    assert.equal(empty.lastMemoAt, null);
    assert.equal(empty.heatmap.length, 11);
    assert.ok(empty.heatmap.every((entry) => entry.count === 0));
    assert.deepEqual(empty.byTemplate, [{ templateId: null, templateName: '无模板', count: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// 15. 多用户隔离（想法）
// ---------------------------------------------------------------------------

describe('多用户隔离（想法）', () => {
  it('B 读/改/删 A 的想法 → 404；B 不能用 A 的模板记录想法', async () => {
    const a = await account('memo_iso_a');
    const b = await account('memo_iso_b');
    const template = await createTemplate(a.cookie, 'A 的记账模板', [
      { key: 'title', label: '标题', type: 'text' },
    ]);
    const memo = memoOf(
      await post('/api/memos', { content: 'A 的想法 #私有', templateId: template.id, values: { title: 'A' } }, a.cookie),
    );

    await expectError(await get(`/api/memos/${memo.id}`, b.cookie), 404, 'NOT_FOUND');
    await expectError(await patch(`/api/memos/${memo.id}`, { content: '篡改' }, b.cookie), 404, 'NOT_FOUND');
    await expectError(await del(`/api/memos/${memo.id}`, b.cookie), 404, 'NOT_FOUND');

    const bList = (await get('/api/memos', b.cookie)).json() as MemoListResponse;
    assert.equal(bList.total, 0);
    const bSummary = (await get('/api/memos/summary', b.cookie)).json() as MemoSummary;
    assert.equal(bSummary.total, 0);

    // B 不能用 A 的模板
    await expectError(
      await post('/api/memos', { templateId: template.id, values: { title: 'x' } }, b.cookie),
      404,
      'NOT_FOUND',
    );

    // A 的想法仍然完好
    assert.equal((await get(`/api/memos/${memo.id}`, a.cookie)).statusCode, 200);
  });
});
