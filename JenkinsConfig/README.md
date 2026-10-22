# FlomoEnhanced（浮墨增强版）Jenkins 部署配置

本目录是本项目的**部署交付物**：Jenkins 流水线、服务器端部署脚本、systemd 服务单元、sudoers 片段与 Jenkins 任务配置模板。
完整的服务器落地步骤（一次性初始化 + 首次构建 + 验收）见 [`../docs/DEPLOY.md`](../docs/DEPLOY.md)。

## 1. 概要

| 项 | 值 |
|---|---|
| Jenkins 任务名 | `FlomoEnhanced`（Pipeline script from SCM） |
| Jenkins 地址 | <http://192.168.0.111:8080/job/FlomoEnhanced/>（备用 <https://jenkins.yuan-xin.top/>） |
| Git 仓库（SSH） | `git@github.com:yuan-xin-9997/FlomoEnhanced.git` |
| 分支 | `*/main` |
| 凭据 | Jenkins 已有凭据 id `truthanalysis-github-ssh`（SSH 私钥，直接复用，**不新建**） |
| 触发器 | SCM 轮询 `H/30 * * * *`（每 30 分钟检查一次，有新提交才执行） |
| 并发 | 禁止同一任务并发构建（`disableConcurrentBuilds`） |
| 脚本路径 | `JenkinsConfig/Jenkinsfile`，`lightweight`（只取 Jenkinsfile，真正的检出由 `checkout scm` 完成） |
| 部署目录 | `/opt/FlomoEnhanced`（属主 `jenkins:jenkins`） |
| systemd 服务 | `flomoenhanced.service`（`User=jenkins`，`WantedBy=multi-user.target`） |
| 端口 / 监听 | `35080` / `0.0.0.0`（由 `/opt/FlomoEnhanced/.env` 的 `FLOMO_PORT`、`FLOMO_HOST` 指定） |
| 访问地址 | <http://192.168.0.111:35080> |
| 运行节点 | Jenkins `built-in` 节点（即 192.168.0.111 本机，流水线以 `jenkins` 用户执行） |

## 2. 目录内文件

| 文件 | 作用 |
|---|---|
| `Jenkinsfile` | 声明式流水线：`Checkout GitHub` → `Build and test` → `Stop service` → `Update /opt/FlomoEnhanced` → `Start and verify`。`post { failure }` 给中文排查提示。 |
| `deploy.sh` | 服务器端部署脚本，仅支持 `prepare` / `stop` / `update` / `start` 四个子命令（其它参数打印用法并退出 2）。 |
| `health.mjs` | 部署后的**只读**健康检查：`/api/health` 必须 `status=ok` 且 `db.ok=true`，首页必须含 `id="root"`。 |
| `flomoenhanced.service` | systemd 服务单元（安装到 `/etc/systemd/system/`）。 |
| `sudoers.d-flomoenhanced-deploy` | sudoers 片段（安装到 `/etc/sudoers.d/flomoenhanced-deploy`，权限 `0440`），只允许 `jenkins` 免密 `systemctl stop/start flomoenhanced.service`。 |
| `job-config.xml` | Jenkins 任务配置模板（`CpsScmFlowDefinition` + `GitSCM` + SCM 轮询 + 禁并发），用 REST `createItem` 导入。 |
| `README.md` | 本文件。 |

## 3. 流水线阶段与语义

1. **Checkout GitHub** — `checkout scm`：以任务配置中的 SSH 地址和凭据拉取 `main`，检出工作区。
2. **Build and test** — `bash JenkinsConfig/deploy.sh prepare`：
   断言 `uname -m` 为 `x86_64`；项目自带 Node 24.13.0 不存在时从 `https://nodejs.org/download/release/v24.13.0/` 下载
   `node-v24.13.0-linux-x64.tar.xz` 与 `SHASUMS256.txt` 并 `sha256sum --check` 校验后解压到 `/opt/FlomoEnhanced/.runtime/`（临时目录用 `mktemp -d` + `trap` 清理）；
   随后在**工作区根**执行 `npm ci --no-audit --no-fund` → `npm run typecheck` → `npm test` → `npm run build`。
   **本阶段失败不会停止现有服务。**
3. **Stop service** — `deploy.sh stop`：`sudo -n /usr/bin/systemctl stop flomoenhanced.service`。
4. **Update /opt/FlomoEnhanced** — `deploy.sh update`：安全断言（工作区 ≠ 部署目录、`realpath /opt/FlomoEnhanced` 一致、`origin` 为 SSH 地址）后
   `rsync -a --delete` 同步，排除 `.git/`、`.data/`、`.env`、`.env.*`、`.runtime/`、`.tools/`、`node_modules/.cache/`、`test-results/`、`coverage/`；
   写入 `DEPLOYED_COMMIT`。
5. **Start and verify** — `deploy.sh start`：确保 `.data`（`0700`）与 `.env`（缺失时用 `umask 077` 生成，含 `FLOMO_HOST=0.0.0.0`、`FLOMO_PORT=35080`、`FLOMO_TZ=Asia/Shanghai`、随机 `FLOMO_SESSION_SECRET`）；
   `sudo -n /usr/bin/systemctl start flomoenhanced.service`；最后运行 `node /opt/FlomoEnhanced/JenkinsConfig/health.mjs`（最多 45 次 × 1 秒重试）。

## 4. 服务器上的数据与配置

| 路径 | 说明 |
|---|---|
| `/opt/FlomoEnhanced/.runtime/node-v24.13.0-linux-x64` | 项目自带 Node 运行时（部署脚本下载并校验，不依赖系统 Node） |
| `/opt/FlomoEnhanced/.data` | SQLite 数据库目录，属主 `jenkins`，权限 `700`（`rsync` 不会覆盖或删除） |
| `/opt/FlomoEnhanced/.env` | 运行时配置，权限 `600`，systemd 用 `EnvironmentFile=-/opt/FlomoEnhanced/.env` 读取 |
| `/opt/FlomoEnhanced/DEPLOYED_COMMIT` | 当前部署的 git 提交 SHA |

数据库放在默认 `.data/` 或部署目录外。若 `FLOMO_DATA_DIR` / `FLOMO_DB_FILE` 指向部署目录内其它位置，部署脚本会在停服前拒绝继续，避免 `rsync --delete` 删除数据库；请先迁移数据并更新配置。
| `/opt/FlomoEnhanced/apps/api/dist/index.js` | 服务入口（`npm run build` 产物，启动命令 `node .../apps/api/dist/index.js`） |
| `/etc/systemd/system/flomoenhanced.service` | systemd 单元文件 |
| `/etc/sudoers.d/flomoenhanced-deploy` | 仅限本服务的 `systemctl stop/start` 免密授权 |

## 5. 日志与状态

```bash
sudo systemctl status flomoenhanced.service --no-pager      # 服务状态
sudo journalctl -u flomoenhanced.service -n 200 --no-pager  # 最近 200 行日志
sudo journalctl -u flomoenhanced.service -f                 # 实时跟踪
cat /opt/FlomoEnhanced/DEPLOYED_COMMIT                      # 当前部署提交
ss -ltnp | grep 35080                                       # 端口占用情况
```

Jenkins 构建日志：<http://192.168.0.111:8080/job/FlomoEnhanced/lastBuild/consoleText>

## 6. 回滚步骤（手动，流水线不自动回滚）

`rsync -a --delete` 是幂等部署，因此“回到旧版本”最安全的做法是用**新提交**表达旧状态：

1. 确认当前已部署提交：本地对读 `git log --oneline -10`，服务器上看 `cat /opt/FlomoEnhanced/DEPLOYED_COMMIT`（`/opt/FlomoEnhanced` 不含 `.git`，无法在服务器上直接切换提交）。
2. 在本地回滚代码：`git revert <出问题的提交>`（推荐，保留历史）或 `git reset --hard <上一个可用提交>`，然后 `git push origin main`（若用 `reset`，需要 `--force-with-lease`，属于例外操作）。
3. 触发一次构建：`curl.exe -s -u admin:admin -X POST "http://192.168.0.111:8080/job/FlomoEnhanced/build"`（或 Jenkins 页面「Build Now」），
   流水线会重新同步代码并重启服务。
4. 若只需临时恢复可用性且必须立刻停止服务：`ssh yuanxin@192.168.0.111 "sudo systemctl stop flomoenhanced.service"`；
   注意 `.data` 数据库不会被回滚（部署从不删除数据），因此数据库结构变更类问题需要人工处理。

**声明：本流水线不做自动回滚。** 停服后若同步或启动失败，服务可能保持停止状态，必须人工介入（见上一节日志命令）。

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| `Build and test` 失败 | 看 Console Output 里的 `npm ci/typecheck/test/build` 报错；这是构建问题，现有服务未受影响。 |
| `sudo: a password is required` | `/etc/sudoers.d/flomoenhanced-deploy` 未安装或命令路径不一致；执行 `sudo -n /usr/bin/systemctl stop flomoenhanced.service` 自测，并用 `sudo visudo -c` 校验语法。 |
| `rsync` 报权限错误 | `/opt/FlomoEnhanced` 属主不是 `jenkins:jenkins`（应为 `sudo install -d -m 755 -o jenkins -g jenkins /opt/FlomoEnhanced`）。 |
| `systemctl start` 报 `start request repeated too quickly` | 之前启动失败触发了启动频率限制：`sudo systemctl reset-failed flomoenhanced.service` 后再启动。 |
| 服务 `203/EXEC` | `apps/api/dist/index.js` 或自带 Node 不存在：说明 `prepare`/`update` 阶段没有成功完成。 |
| 健康检查超时 | `journalctl -u flomoenhanced.service -n 200`；常见原因：数据库迁移失败、端口被占用（`ss -ltnp | grep 35080`）、依赖缺失。 |
| 轮询不触发构建 | 确认任务里已配置 SCM 轮询，且 Jenkins 用 `truthanalysis-github-ssh` 能拉取仓库；也可手动「Build Now」验证。 |

## 8. 校验记录（本目录交付时实测）

- `bash -n JenkinsConfig/deploy.sh`：通过（在 192.168.0.111 上以 `bash 5.2.21` 实测，见 `docs/DEPLOY.md` 的校验记录）。
- `node --check JenkinsConfig/health.mjs`：通过（本地 Node v24.13.0）。
- `Jenkinsfile`：Jenkins REST `POST /pipeline-model-converter/validate` 返回 `Jenkinsfile successfully validated.`。
- `sudoers` 片段：`sudo -n visudo -cf <file>` 返回「解析正确」。
- `flomoenhanced.service`：在服务器上 `systemd-analyze verify` 通过（`ExecStart` 指向的自带 Node 尚未安装时只报该路径不可执行，属部署前预期）。
- `job-config.xml`：XML 解析通过（PowerShell `[xml]` 与服务器 `python3 xml.etree` 均解析成功）。

## 9. 部署结果与验收（2026-10-18 实测）

- 构建结果：任务 `FlomoEnhanced` 已创建，构建 `#2` `SUCCESS`（耗时约 43.7 s）；部署提交 `ae9fd998ec1f06e765ced5dcd21e98d577ed6345`。
- 运行状态：`flomoenhanced.service` `active`，`User=jenkins`，`0.0.0.0:35080` 已监听；`/api/health` 返回 200（`status=ok`、`db.ok=true`）。
- 端到端验收：`node scripts/acceptance-e2e.mjs --external http://192.168.0.111:35080` → **143/143 断言通过**。
  - 该脚本位于仓库 `scripts/`，用 `--external <url>` 对已部署实例做黑盒验收（默认无参数时对本地内存实例验收）。
  - 也可用根目录脚本：`npm run verify:e2e`（本地）/ `node scripts/acceptance-e2e.mjs --external http://192.168.0.111:35080`（线上）。
- 浏览器人工验收：注册 → 建模板（文本 + 金额字段）→ 记想法（含/不含模板）→ 洞察分析（概览 + 单模板统计）→ CSV 导出 → 修改密码 → 多用户数据隔离，全部通过。
- 完整证据与残留说明见 [`../docs/DEPLOY.md`](../docs/DEPLOY.md) 第 ⑨ 节。
