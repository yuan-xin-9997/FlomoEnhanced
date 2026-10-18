# FlomoEnhanced（浮墨增强版）

以 flomo 的「快速记录想法」体验为基础，加上**自定义模板**与**洞察分析**的自托管笔记系统。多用户，数据按用户严格隔离。

- 中文名：**浮墨增强版**
- 英文名：**FlomoEnhanced**
- 线上访问地址：<http://192.168.0.111:35080>
- 接口与数据契约（冻结版）：[`docs/SPEC.md`](docs/SPEC.md)｜统计口径：[`docs/ANALYTICS.md`](docs/ANALYTICS.md)

## 功能

**模板**
- 新建 / 编辑 / 删除（软删除，可恢复）/ 复制模板，字段可增删、拖动排序
- 记录想法时可以选择模板、切换模板，也可以**不选模板**直接写自由文本
- 模板导入 / 导出（`.flomo-template.json`，支持 `skip` / `rename` / `overwrite` 三种同名处理模式）
- 字段类型：`text`、`longtext`、`number`、`currency`、`percent`、`date`、`datetime`、`select`、`multiselect`、`boolean`、`rating`、`url`

**想法（memo）**
- 自由文本 + `#标签`，或按模板填结构化字段；模板字段变更后历史数据仍可查看
- 列表查询：按模板、时间段、标签、关键字过滤，游标分页
- 首页概览：总条数、按模板统计、热力图、活跃天数、最长/当前连续记录天数

**洞察分析**
- 按**模板 + 时间段**统计该模板下所有想法：数值字段的合计/均值/极值/分位等、选择类字段的分布、日期字段趋势、填写率等
- 粒度 `day` / `week` / `month`，前端用 Apache ECharts 渲染
- 全局概览（含「无模板」想法的汇总），以及该模板时间段的 CSV 导出（UTF-8 BOM，Excel 可直接打开）
- 快捷区间：最近 7 天 / 30 天 / 6 个月 / 自定义（默认最近 30 天，最大跨度约 10 年）

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js **24.13.0**（服务器由部署脚本自带该版本运行时，不依赖系统 Node） |
| 包管理 | **npm workspaces**（`package-lock.json` 提交到仓库；不使用 pnpm/corepack） |
| 后端 | TypeScript + Fastify 5 + `@fastify/cookie` + `@fastify/static` |
| 数据库 | `node:sqlite`（`DatabaseSync`，WAL，单文件），迁移用 `PRAGMA user_version` |
| 前端 | React 18 + TypeScript + Vite 5 + react-router-dom 6 + Apache ECharts 5 |
| 测试 | 后端 `node:test` + `tsx`；前端 `vitest` + `@testing-library/react` |
| 部署 | Jenkins 流水线 + systemd（见下方「部署」） |

不使用任何需要本地编译的原生模块，不使用需要运行期联网的库；密码哈希用 Node 内置 `node:crypto` 的 `scrypt`。

## 目录结构

```
FlomoEnhanced/
├── package.json / package-lock.json   # npm workspaces 根（脚本名见下）
├── tsconfig.base.json / .npmrc / .gitignore
├── README.md                          # 本文件
├── docs/
│   ├── SPEC.md                        # 技术契约（冻结）
│   ├── ANALYTICS.md                   # 洞察分析的统计口径（冻结）
│   └── DEPLOY.md                      # 部署 Runbook（服务器初始化 + Jenkins 任务 + 验收 + 回滚）
├── JenkinsConfig/                     # 部署交付物
│   ├── Jenkinsfile                    # 声明式流水线
│   ├── deploy.sh                      # prepare / stop / update / start
│   ├── health.mjs                     # 只读健康检查
│   ├── flomoenhanced.service          # systemd 单元
│   ├── job-config.xml                 # Jenkins 任务配置模板
│   ├── sudoers.d-flomoenhanced-deploy # sudoers 片段
│   └── README.md                      # Jenkins 配置说明与排障
├── packages/shared/                   # 前后端共用的类型、字段归一化、模板校验、统计口径
├── apps/api/                          # Fastify 后端（src/index.ts 为入口，构建到 dist/）
├── apps/api/test/                     # 后端测试（node:test）
└── apps/web/                          # React + Vite 前端（构建到 dist/）
```

## 本地开发与测试

需要 Node.js **24.13.0**（npm 随 Node 自带）。

```bash
npm ci                 # 安装所有 workspace 依赖（使用仓库根 package-lock.json）
npm run typecheck      # 全部 workspace 的 tsc --noEmit
npm test               # 后端 node:test + 前端 vitest，必须全绿
npm run build          # 构建 packages/shared、apps/web、apps/api
npm start              # 生产启动：node apps/api/dist/index.js（监听 0.0.0.0:35080）
npm run dev:api        # 开发后端（tsx watch）
npm run dev:web        # 开发前端（vite dev，代理 /api 到 127.0.0.1:35080）
```

## 环境变量

前缀 `FLOMO_`，均有默认值（实现见 `apps/api/src/config.ts`）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FLOMO_HOST` | `0.0.0.0` | 监听网卡 |
| `FLOMO_PORT` | `35080` | 监听端口 |
| `FLOMO_DATA_DIR` | `<repo>/.data` | SQLite 文件目录 |
| `FLOMO_DB_FILE` | `flomoenhanced.db` | 数据库文件名 |
| `FLOMO_TZ` | `Asia/Shanghai` | 统计分日依据时区 |
| `FLOMO_SESSION_TTL_DAYS` | `30` | 会话有效期（天） |
| `FLOMO_SESSION_SECRET` | 开发态自动生成 | 保留给未来的签名扩展（当前会话令牌为随机值 + 数据库哈希，不依赖该密钥） |
| `FLOMO_ALLOW_REGISTRATION` | `1` | 设为 `0` 关闭注册 |
| `FLOMO_WEB_DIST` | 自动推导 | 前端静态目录（绝对路径） |
| `FLOMO_LOG_LEVEL` | `info` | fastify 日志级别（测试用 `silent`） |

服务器上这些值位于 `/opt/FlomoEnhanced/.env`（权限 `600`），由部署脚本首次启动时生成，之后不会覆盖。

## 部署

- 服务器：`192.168.0.111`（Ubuntu 24.04），Jenkins 任务 `FlomoEnhanced`，systemd 服务 `flomoenhanced.service`，部署目录 `/opt/FlomoEnhanced`。
- 触发方式：Jenkins SCM 轮询 GitHub `main` 分支（`H/30 * * * *`），有新提交时执行
  `Checkout GitHub → Build and test → Stop service → Update → Start and verify`；构建或测试失败**不会**停止现有服务。
- 完整步骤（服务器初始化、Jenkins 任务创建、首次构建、验收、回滚）：**[`docs/DEPLOY.md`](docs/DEPLOY.md)**。
- 配置说明与排障（任务/凭据/端口/日志/常见问题）：**[`JenkinsConfig/README.md`](JenkinsConfig/README.md)**。
- 运维常用命令：

  ```bash
  sudo systemctl status flomoenhanced.service --no-pager
  sudo journalctl -u flomoenhanced.service -n 200 --no-pager
  cat /opt/FlomoEnhanced/DEPLOYED_COMMIT
  ```

## 测试与验收

- 本地门槛：`npm ci` → `npm run typecheck` → `npm test` → `npm run build` 全部通过。
- **端到端验收脚本**：`npm run verify:e2e`（`scripts/acceptance-e2e.mjs`）。
  它在临时目录用真实 SQLite 启动一个真实服务实例，再用真实 HTTP 请求走完
  注册 → 登录 → 建模板（含 12 种字段类型）→ 记录想法（有/无模板）→ 模板导入导出（三种冲突模式）
  → 洞察分析（逐字段统计、手算数值比对）→ CSV 导出 → 多用户隔离 → 改密/注销 → 安全与健壮性，
  逐条打印中文结果，失败时以非 0 退出。可用 `--external http://127.0.0.1:35080` 对已运行的服务做验收。
- 服务器门槛（见 `docs/DEPLOY.md` 第 ⑥ 节）：`systemctl status flomoenhanced.service` 为 `active (running)`；
  `GET http://192.168.0.111:35080/api/health` 返回 `200 {"status":"ok","db":{"ok":true,...}}`；
  首页返回 HTML 且含挂载点 `id="root"`；浏览器走通 注册 → 建模板 → 记录想法 → 查看洞察。
- 健康检查接口 `/api/health` 是**只读**的（不写库、不建记录），部署流水线的健康检查依赖这一性质。

## 当前状态

- **已通过本地验证**：`npm run typecheck` 三个 workspace 零错误；`npm test` 共
  **302** 个用例全绿（`@flomo/shared` 53 + `@flomo/web` 114 + `@flomo/api` 135）；
  `npm run build` 产出 `packages/shared/dist`、`apps/web/dist`、`apps/api/dist`；
  `npm run verify:e2e` **144 项断言全部通过**（含跨用户隔离 404、跨时区日边界、
  SQL 通配符转义、CSV 的 BOM/CRLF/RFC 4180、登录限流 429、超大请求体 413）。
- **性能**：1 万条想法的洞察分析实测中位 ~468ms（要求 p95 < 800ms）；1 千条 ~29ms。
- **已通过静态校验**：`JenkinsConfig/` 全部文件与 `docs/DEPLOY.md`。
  校验记录：`bash -n deploy.sh`（服务器 bash 5.2.21）、`node --check health.mjs`、`node --check scripts/acceptance-e2e.mjs`、Jenkins `pipeline-model-converter/validate`（`Jenkinsfile successfully validated.`）、
  `visudo -cf`（sudoers 片段解析正确）、`systemd-analyze verify`（unit 通过）、`job-config.xml` XML 解析通过。详见 `docs/DEPLOY.md` 末尾表格。
- **已部署并验收（2026-10-18）**：Jenkins 任务 `FlomoEnhanced` 构建 `#2` `SUCCESS`，部署提交 `ae9fd99`；
  `flomoenhanced.service` `active`（`User=jenkins`），监听 `0.0.0.0:35080`，`/api/health` 200；
  `node scripts/acceptance-e2e.mjs --external http://192.168.0.111:35080` **143 项断言全部通过**；
  项目经理浏览器人工验收走通 注册 → 建模板 → 记想法（含/不含模板）→ 洞察分析（概览 + 单模板统计）→ CSV 导出 → 改密码 → 多用户数据隔离。
  完整证据与残留数据说明见 `docs/DEPLOY.md` 第 ⑨ 节。
- 本 README 的功能描述以冻结契约 `docs/SPEC.md`、`docs/ANALYTICS.md`（含末尾的裁决附录）为准。
