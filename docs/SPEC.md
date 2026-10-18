# FlomoEnhanced — 系统规格与接口契约（冻结版 v1）

> 本文件是**唯一契约**。所有子智能体必须严格按此实现；如需变更契约，必须由项目经理（主智能体）修改本文件后同步给相关实现者。
> 契约版本：`2026-10-18 / v1`。任何实现与本文冲突之处，以本文为准。

## 1. 系统概述

- 中文名：**浮墨增强版**；英文名：**FlomoEnhanced**。
- 定位：以 flomo（https://flomoapp.com/）的「快速记录想法」体验为基础，增加
  1. **模板功能**（自定义字段类型、创建/选择/导入/导出模板）
  2. **洞察分析功能**（按模板 + 时间段统计所有使用该模板的想法）
- 多用户：注册、登录、数据严格按用户隔离。

## 2. 技术栈（已定，不得更改）

| 层 | 选型 |
|---|---|
| 运行时 | Node.js **24.13.0**（本地即 v24.13.0；服务器由部署脚本自带该版本运行时） |
| 包管理 | **npm workspaces**（不用 pnpm；`package-lock.json` 必须提交） |
| 后端 | TypeScript + **Fastify 5** + `@fastify/cookie` + `@fastify/static` |
| 数据库 | **`node:sqlite`（`DatabaseSync`）**，WAL 模式，单文件。⚠️ 启动脚本必须加 `--no-warnings=ExperimentalWarning` 或用 `NODE_NO_WARNINGS=1`，避免实验性告警刷屏 |
| 前端 | React 18 + TypeScript + Vite 5 + react-router-dom 6 + **Apache ECharts 5** |
| 测试 | 后端 `node:test` + `tsx`；前端 `vitest` + `@testing-library/react`（仅纯函数/逻辑测试必须） |
| 语言 | 所有代码注释、文档、UI 文案使用**简体中文**；标识符用英文 |

**禁止引入的依赖**：任何需要本地编译的原生模块（better-sqlite3、bcrypt、argon2、canvas 等）、任何需要运行期联网的库。密码哈希用 Node 内置 `node:crypto` 的 `scrypt`。

## 3. 目录结构与文件归属（ownership）

```
FlomoEnhanced/
├── package.json                       # [F] npm workspaces 根
├── package-lock.json                  # [F] 提交到 git
├── tsconfig.base.json                 # [F]
├── .gitignore                         # [F]
├── .npmrc                             # [F]
├── README.md                          # [A5] 项目总说明
├── docs/
│   ├── SPEC.md                        # [PM] 本文件（只读）
│   ├── ANALYTICS.md                   # [PM] 统计口径（只读）
│   └── DEPLOY.md                      # [A5]
├── JenkinsConfig/                     # [A5] 全部
│   ├── Jenkinsfile
│   ├── deploy.sh
│   ├── health.mjs
│   ├── flomoenhanced.service
│   ├── job-config.xml
│   └── README.md
├── packages/shared/                   # [F] 全部
│   └── src/{index,types,fieldTypes,template,stats,analytics}.ts
├── apps/api/
│   ├── package.json                   # [F]
│   ├── tsconfig.json                  # [F]
│   ├── src/
│   │   ├── config.ts                  # [F] 完整实现，勿改
│   │   ├── types.ts                   # [F] Fastify 类型增强（app.db / app.config）
│   │   ├── db/{index.ts,migrations.ts}# [F] 完整实现，勿改
│   │   ├── lib/errors.ts              # [F] 完整实现，勿改
│   │   ├── lib/{ids,time,validate}.ts # [F] 完整实现，勿改
│   │   ├── routes/health.ts           # [F] 完整实现（只读健康检查）
│   │   ├── routes/index.ts            # [F] registerRoutes() 汇总注册（勿改导出名）
│   │   ├── index.ts                   # [A1] 入口：开库、监听 0.0.0.0:35080
│   │   ├── app.ts                     # [F] buildApp()（完整实现，A1 不改）
│   │   ├── lib/password.ts            # [A1] 签名由 [F] 冻结
│   │   ├── lib/session.ts             # [A1] 签名由 [F] 冻结
│   │   ├── lib/ratelimit.ts           # [A1] 签名由 [F] 冻结
│   │   ├── domain/users.ts            # [A1]
│   │   ├── domain/templates.ts        # [A2]
│   │   ├── domain/memos.ts            # [A2]
│   │   ├── domain/analytics.ts        # [A3]
│   │   ├── routes/auth.ts             # [A1]
│   │   ├── routes/templates.ts        # [A2]
│   │   ├── routes/memos.ts            # [A2]
│   │   └── routes/analytics.ts        # [A3]
│   └── test/                          # 各实现者写自己的 test/*.test.ts；helpers.ts 归 [A1]
└── apps/web/                          # [A4] 全部
```

- `[PM]` 主智能体（项目经理）｜`[F]` 基础脚手架子智能体｜`[A1..A5]` 并行实现子智能体。
- **严禁越权修改他人文件**。需要他人文件变更时，用 `docs/` 之外的临时说明写清需求并报告给 PM，不要直接改。

## 4. 运行与构建约定（根 package.json 脚本名固定）

| 脚本 | 语义 |
|---|---|
| `npm run build` | 构建全部 workspace：`packages/shared`（tsc）、`apps/web`（vite build → `apps/web/dist`）、`apps/api`（tsc → `apps/api/dist`） |
| `npm run typecheck` | 全部 workspace 的 tsc `--noEmit` |
| `npm test` | 后端 `node:test`（tsx）+ 前端 vitest；**必须全绿** |
| `npm start` | 生产启动：`node apps/api/dist/index.js` |
| `npm run dev:api` | 开发启动（tsx watch） |
| `npm run dev:web` | 开发前端（vite dev，代理 /api → 127.0.0.1:35080） |

环境变量（前缀 `FLOMO_`，均有默认值，见 `apps/api/src/config.ts`，以该文件实现为准）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FLOMO_HOST` | `0.0.0.0` | **硬性要求：监听网卡 0.0.0.0** |
| `FLOMO_PORT` | `35080` | **硬性要求：监听端口 35080** |
| `FLOMO_DATA_DIR` | `<repo>/.data` | SQLite 文件目录 |
| `FLOMO_DB_FILE` | `flomoenhanced.db` | 数据库文件名 |
| `FLOMO_TZ` | `Asia/Shanghai` | 统计分日依据的时区 |
| `FLOMO_SESSION_TTL_DAYS` | `30` | 会话有效期 |
| `FLOMO_SESSION_SECRET` | 开发态自动生成 | 保留给未来的签名扩展；**当前会话令牌是随机值 + 数据库哈希，不依赖该密钥** |
| `FLOMO_ALLOW_REGISTRATION` | `1` | `0` 关闭注册 |
| `FLOMO_WEB_DIST` | 自动推导 | 前端静态目录（绝对路径） |
| `FLOMO_LOG_LEVEL` | `info` | fastify logger 级别；测试设 `silent` |

## 5. 数据模型（SQLite，`node:sqlite`）

所有时间戳为 **ISO-8601 UTC 字符串**（`YYYY-MM-DDTHH:mm:ss.sssZ`）。所有 id 为 `crypto.randomUUID()`。
迁移用 `PRAGMA user_version` 管理（`apps/api/src/db/migrations.ts` 中 `MIGRATIONS` 数组，索引即版本号）。

```sql
-- v1（由 [F] 落地在 migrations.ts）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'scrypt',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,          -- sha256(token) 的 hex
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,                -- JSON: FieldDefinition[]
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (user_id, name)
);
CREATE INDEX idx_templates_user ON templates(user_id, archived_at);

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,   -- NULL = 未使用模板
  content TEXT NOT NULL DEFAULT '',          -- 自由文本（含 #标签）
  values_json TEXT NOT NULL DEFAULT '{}',    -- JSON: { [fieldKey]: FieldValue }
  tags_json TEXT NOT NULL DEFAULT '[]',      -- JSON: string[]，由 content 中的 #tag 提取 + 有值的选择类字段 label
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_memos_user_created ON memos(user_id, deleted_at, created_at DESC);
CREATE INDEX idx_memos_user_template ON memos(user_id, template_id, created_at DESC);
```

**约定**
- 软删除：`memos.deleted_at` 非空即删除；所有查询必须带 `deleted_at IS NULL`。
- `memos.template_id` 可为 NULL：**用户可以不用模板记录想法**（需求硬性要求）。
- 模板删除：`DELETE /api/templates/:id` 为**软删除**（写 `archived_at`），已有 memo 保留其 `template_id` 以便查看历史。`?hard=1` 时改为硬删除并把相关 memo 的 `template_id` 置 NULL。

## 6. 字段类型（`packages/shared/src/fieldTypes.ts` 为准）

```ts
export type FieldType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'percent'
  | 'date' | 'datetime' | 'select' | 'multiselect'
  | 'boolean' | 'rating' | 'url';

export interface FieldDefinition {
  key: string;             // 机器名：/^[a-z][a-z0-9_]{0,39}$/，存 values_json 的键，模板内唯一、不可变
  label: string;           // 显示名：1..40 字符
  type: FieldType;
  required?: boolean;      // 默认 false
  help?: string;           // ≤120
  placeholder?: string;    // ≤60
  defaultValue?: FieldValue;
  // number / currency / percent / rating
  min?: number;
  max?: number;
  step?: number;
  precision?: number;      // 小数位 0..6，默认 number/percent 2、currency 2、rating 0
  currency?: string;       // 仅 currency：ISO-4217 三字母大写，默认 'CNY'
  // rating
  scale?: number;          // 仅 rating：满分，默认 5
  // text / longtext / url
  maxLength?: number;      // text 默认 200，longtext 默认 5000
  // select / multiselect
  options?: { value: string; label: string; color?: string }[];   // value 1..40 字符且模板内唯一；select 1..50 项
}

export type FieldValue = string | number | boolean | string[] | null;
```

**取值归一化规则（`normalizeFieldValue(type, raw)`，实现于 shared，前后端共用）**

| 类型 | 归一化后的值 | 校验失败 |
|---|---|---|
| `text` / `longtext` | `string`（trim 后；超长截断到 maxLength） | 超过 maxLength → 报错 |
| `url` | `string`（http/https 绝对地址，否则报错） | 非法 URL → 报错 |
| `number` | `number` 或 `null`（`''`/`null` → null） | 非有限数、越界 → 报错 |
| `percent` | `number`，取值区间 `[0,100]`（UI 显示 `%`） | 越界 → 报错 |
| `currency` | `number`（最小币种单位前的十进制值，币种取自字段定义的 `currency`） | 越界 → 报错 |
| `rating` | `number`，取值区间 `[0, scale]` 的整数 | 越界/非整数 → 报错 |
| `date` | `string` `YYYY-MM-DD` | 格式非法 → 报错 |
| `datetime` | `string` ISO-8601（带时区或 `Z`） | 非法 → 报错 |
| `select` | `string`（必须命中 `options[].value`） | 未命中 → 报错 |
| `multiselect` | `string[]`（去重、排序稳定、每项命中 options） | 未命中 → 报错 |
| `boolean` | `boolean` | — |

- `required: true` 的字段：值为 `null` / `''` / `[]` 时视为缺失 → `422`。
- 空值统一以 `null`（`multiselect` 为 `[]`）存入 `values_json` 的对应键；**未填写的键可以不存在**。

## 7. 模板导入/导出文件格式（`.flomo-template.json`）

```jsonc
{
  "format": "flomo-enhanced-template",
  "formatVersion": 1,
  "exportedAt": "2026-10-18T04:00:00.000Z",
  "app": { "name": "FlomoEnhanced", "version": "1.0.0" },
  "templates": [
    {
      "name": "每日开销",
      "description": "记录每天的花费",
      "icon": "💰",
      "color": "#3b82f6",
      "fields": [ /* FieldDefinition[] */ ],
      "templateVersion": 3,
      "exportedId": "原模板 id（导入时忽略，仅作追溯）"
    }
  ]
}
```

- **导出**：`GET /api/templates/export` 返回上述 JSON（`Content-Disposition: attachment; filename="flomo-templates-YYYYMMDD.json"`）；`?ids=a,b` 导出指定模板。
- **导入**：`POST /api/templates/import`，请求体为该 JSON + 可选 `mode`（query 或 body 字段，默认 `rename`）：
  - `skip`：同名模板已存在 → 跳过；
  - `rename`：同名 → 自动加后缀 ` 2`、` 3`…（**默认**）；
  - `overwrite`：同名 → 覆盖其字段定义与描述（保留 id 与已有关联 memo）。
- 响应：`{ "imported": Template[], "skipped": [{name, reason}], "overwritten": Template[], "errors": [{index, name, message}] }`。
- **校验**：`format`/`formatVersion` 必须匹配；`fields` 必须通过 `validateTemplate()`（key 唯一、类型合法、select 有 options…）。整体失败返回 `400`，部分条目非法则进入 `errors` 且其余条目照常导入。

## 8. HTTP API 契约（前缀 `/api`，JSON，UTF-8）

统一响应包：
- 成功：直接返回资源对象/数组（不包裹 `data`）。
- 失败：`{ "error": { "code": "SOME_CODE", "message": "人类可读中文消息", "details"?: any } }`，HTTP 状态见下。
- 错误码：`VALIDATION_FAILED`(422)、`UNAUTHENTICATED`(401)、`FORBIDDEN`(403)、`NOT_FOUND`(404)、`CONFLICT`(409)、`RATE_LIMITED`(429)、`PAYLOAD_TOO_LARGE`(413)、`INTERNAL`(500)。
- 会话：Cookie `flomo_session`（`HttpOnly`、`SameSite=Lax`、`Path=/`、有效期 `FLOMO_SESSION_TTL_DAYS`）。所有写操作要求请求头 `Content-Type: application/json` 且（存在 `Origin`/`Referer` 时）同源，否则 `403 FORBIDDEN`。

### 8.1 认证
| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | `201 {user}` + Set-Cookie |
| POST | `/api/auth/login` | `{username, password}` | `200 {user}` + Set-Cookie |
| POST | `/api/auth/logout` | — | `204` |
| GET | `/api/auth/me` | — | `200 {user}` / `401` |
| PATCH | `/api/auth/password` | `{currentPassword, newPassword}` | `204`（**吊销该用户其它会话**） |

- `username`：`/^[A-Za-z0-9_-]{3,32}$/`，大小写不敏感唯一。
- `password`：8..128 字符；注册时用 scrypt（`N=16384,r=8,p=1,keylen=64`，16 字节随机盐，`salt:hash` 十六进制分开存）。
- 登录失败统一文案「用户名或密码不正确」，不区分用户是否存在。
- 登录限流：同一 `IP` 或同一 `username` 15 分钟内失败 ≥10 次 → `429`。

`User` DTO（**永不返回任何密码字段**）：`{ id, username, createdAt }`。

### 8.2 模板
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/templates` | 列表；`?includeArchived=1` 可含归档；默认按 `updated_at DESC` |
| POST | `/api/templates` | 创建：`{name, description?, icon?, color?, fields}` |
| GET | `/api/templates/:id` | 详情（含 `memoCount`） |
| PATCH | `/api/templates/:id` | 局部更新：`{name?, description?, icon?, color?, fields?}`（`fields` 整体替换，`version+1`） |
| DELETE | `/api/templates/:id` | 软删除（归档）；`?hard=1` 硬删除 |
| POST | `/api/templates/:id/restore` | 取消归档 |
| POST | `/api/templates/:id/duplicate` | 复制为「<原名> 副本」，返回新模板 |
| GET | `/api/templates/export` | 见 §7 |
| POST | `/api/templates/import` | 见 §7 |

`Template` DTO：`{ id, name, description, icon, color, fields: FieldDefinition[], version, memoCount, createdAt, updatedAt, archivedAt|null }`。

**PATCH 兼容性规则**：`fields` 变更后，历史 memo 的 `values_json` 中已被删除的键**不删除**（历史数据保留，分析时忽略未知键）。

### 8.3 想法（memo）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/memos` | 查询：`?templateId=`、`?from=`、`?to=`（ISO，按 `created_at` 过滤）、`?tag=`、`?q=`（content 模糊）、`?limit=`(默认 50，最大 200)、`?cursor=`；返回 `{items, nextCursor, total}`，按 `created_at DESC` |
| POST | `/api/memos` | `{content?, templateId?, values?, tags?, createdAt?}`；`content` 与 `values` 至少一个有内容，否则 `422` |
| GET | `/api/memos/:id` | 详情 |
| PATCH | `/api/memos/:id` | `{content?, templateId?, values?, tags?}`（`templateId: null` 表示取消模板；`values` 整体替换并重新校验；`templateId` 变更时 `values` 必须同时给出） |
| DELETE | `/api/memos/:id` | `204`，软删除 |
| GET | `/api/memos/summary` | `?from=&to=` → `{total, byTemplate: [{templateId, templateName, count}], heatmap: [{date, count}], activeDays, longestStreak, currentStreak, firstMemoAt, lastMemoAt}`（供首页侧栏） |

`Memo` DTO：`{ id, templateId, templateName|null, content, values, tags, createdAt, updatedAt }`。

**标签提取**（前后端一致，实现于 `packages/shared`）：从 `content` 中用 `/#([^\s#,，。；;：:!！?？()（）\[\]【】{}<>《》"'’“”]+)/g` 提取；合并请求里显式传入的 `tags`；去重；`#` 前缀不入库（存裸标签）；单标签 ≤50 字符；每条 memo 最多 50 个标签。选择类字段（`select`/`multiselect`）的 option `label` **不**自动成为标签（避免污染）。

### 8.4 洞察分析
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/analytics/overview` | `?from=&to=` → 全局概览（所有模板 + 无模板想法汇总） |
| GET | `/api/analytics/templates/:id/insights` | `?from=&to=&granularity=day\|week\|month` → **核心**：该模板在时间段内所有想法的统计 |
| GET | `/api/analytics/templates/:id/export.csv` | `?from=&to=` → CSV（UTF-8 BOM，Excel 可直接打开） |

**时间段参数**：`from` / `to` 均可省略（默认：`to` = 今天本地 23:59:59.999，`from` = `to - 29 天`）；`from > to` → `422`；最大跨度 3660 天（约 10 年）→ 超出 `422`。
前端提供快捷区间：最近 7 天 / 30 天 / 6 个月（按自然月回推）/ 自定义。
响应结构见 **`docs/ANALYTICS.md`**（该文件是统计口径的正式定义，实现必须逐字段对齐）。

### 8.5 健康检查
| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/api/health` | `200 {status:'ok', version, uptimeSec, time, db:{ok:true, users, memos, templates}}`；DB 异常 → `503 {status:'degraded', ...}` |

`/api/health` **只读**，绝不写库、不创建记录（Jenkins 健康检查依赖此性质）。

### 8.6 静态资源
- `@fastify/static` 挂载 `FLOMO_WEB_DIST`；`/` 及任何未匹配的非 `/api` GET 请求回退 `index.html`（SPA）。
- 注意：API 的 404 必须返回 JSON，**不能**被 SPA fallback 吞掉。

## 9. 非功能要求（验收项）

1. **多用户隔离**：任何跨用户读写必须 `404`（不泄露存在性），并写进测试。
2. **安全**：密码仅存 scrypt 哈希；会话表只存 token 的 sha256；日志中**不得**出现密码/token；`.env` 与 `.data/` 不进 git。
3. **端口/网卡**：`0.0.0.0:35080`，可由 `FLOMO_HOST`/`FLOMO_PORT` 覆盖。
4. **健壮性**：所有输入走校验；SQL 全参数化；单进程 `DatabaseSync`（同步 API）避免并发写竞争；写操作包在事务里。
5. **测试**：后端每个模块 ≥ 覆盖主要成功与失败路径；`npm test` 全绿是交付门槛。测试使用**临时目录**中的 SQLite 文件，测完删除；不得污染 `.data/`。
6. **前端**：中文界面；无模板也能记录；模板编辑器可增删字段、拖动排序、按类型显示不同配置项；洞察页可切换模板/区间并渲染 ECharts 图表；错误有可读提示；移动端可用（≤768px 单列）。
7. **性能**：分析接口在 1 万条 memo 下 p95 < 800ms（在生产 Node 上实测；实现用 SQL 聚合 + 单次查询拿数据）。

## 10. 验收方式（PM 执行）

1. 本地：`npm ci` → `npm run typecheck` → `npm test` → `npm run build` → 启动服务并跑 HTTP 端到端脚本（注册/登录/模板 CRUD/导入导出/无模板与有模板记录/洞察分析各字段/CSV/权限隔离/404/限流/health）。
2. 服务器：Jenkins 任务 `FlomoEnhanced` 创建成功；触发构建；`systemctl status flomoenhanced.service` 正常；`http://192.168.0.111:35080/api/health` 返回 ok；用真实浏览器（browser 工具）走通注册→建模板→记录→看洞察。
3. 失败项打回对应子智能体修复，不达标不接收。
