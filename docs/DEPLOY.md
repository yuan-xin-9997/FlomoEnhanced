# FlomoEnhanced 部署 Runbook（执行者 A6 专用）

> 本文件是**可直接复制粘贴执行**的部署手册。所有命令都在本机 Windows PowerShell 的仓库根目录
> `E:\dev\FlomoEnhanced` 下执行；其中 `ssh` / `scp` / `curl.exe` 使用 Windows 自带 OpenSSH 与 curl。
> 远端 shell 是 **zsh**，因此远端命令里**不要出现双引号**（PowerShell 会吃掉），本手册的远端命令都已按此写。
>
> 约定（已冻结，不要改动）：部署根目录 `/opt/FlomoEnhanced`（属主 `jenkins:jenkins`）、systemd 服务 `flomoenhanced.service`、
> sudoers 文件 `/etc/sudoers.d/flomoenhanced-deploy`、Jenkins 任务名 `FlomoEnhanced`、端口 `35080`、Jenkins 凭据 `truthanalysis-github-ssh`。

## 0. 前置事实（本次已实测确认，无需重测）

| 事实 | 实测值 |
|---|---|
| `ssh yuanxin@192.168.0.111` 免密登录 | 可用（`BatchMode=yes` 直接成功） |
| 服务器架构 / 系统 / bash | `x86_64` / Ubuntu 24.04.5 LTS / GNU bash 5.2.21 |
| 服务器系统 Node | `v22.23.3`（**不使用**；服务用项目自带的 `/opt/FlomoEnhanced/.runtime/node-v24.13.0-linux-x64`） |
| 服务器工具 | `rsync`、`openssl`、`base64`、`systemd-analyze`、`visudo`、`python3` 均存在 |
| `/opt/FlomoEnhanced` | 部署前**尚不存在**（步骤 ② 创建；**现已部署完成**，见 ⑨） |
| Jenkins 任务 `FlomoEnhanced` | 部署前**尚不存在**（`GET /job/FlomoEnhanced/api/json` 返回 404，步骤 ④ 创建；**现已创建并构建成功**，见 ⑨） |
| Jenkins CSRF | 已启用，crumb 接口 `GET /crumbIssuer/api/json` 返回字段名 `Jenkins-Crumb`（步骤 ④ 取用） |
| 本仓库 `core.autocrlf` | `true`（提交时自动归一化为 LF，仓库内脚本仍是 LF，Linux 端安全） |

## ① 本机提交并推送 `main`

Jenkins 的 `lightweight` 检出会先读 GitHub 上的 `JenkinsConfig/Jenkinsfile`，所以**必须先推送再建任务/构建**。

```powershell
cd E:\dev\FlomoEnhanced
git status --short
git add -A
git commit -m "feat(deploy): 增加 JenkinsConfig 流水线与部署脚本、部署文档"
git push origin main
```

说明与检查：

- `git add -A` 会提交工作区当前全部内容（含其它智能体的 `apps/`、`packages/`、`docs/`、`LICENSE`、`生成Jenkinsfile的提示词.md`）。
  若只想提交本次部署交付物：`git add JenkinsConfig docs/DEPLOY.md README.md`。
- 确认脚本以 **LF** 进入索引（避免 CRLF 让 bash 报 `\r: command not found`）：

  ```powershell
  git ls-files --eol JenkinsConfig
  # 期望：i/lf w/lf（i/=索引）出现在 deploy.sh / Jenkinsfile / *.service 等行
  ```

- 推送后用 GitHub 上的提交号（`git rev-parse --short HEAD`）对账：Jenkins 构建日志开头会显示同一个 commit。
- **首次构建的前置条件**：只有 `apps/api/dist` 能构建出来 `prepare` 才会通过。若其它智能体的代码尚未齐备，
  首次构建会在 `Build and test` 阶段失败——这**不会**影响服务器（此阶段不停服、不改 `/opt/FlomoEnhanced`）。

## ② 服务器上创建目录与属主权限

```powershell
ssh yuanxin@192.168.0.111 "sudo install -d -m 755 -o jenkins -g jenkins /opt/FlomoEnhanced"
ssh yuanxin@192.168.0.111 "sudo install -d -m 755 -o jenkins -g jenkins /opt/FlomoEnhanced/.runtime"
ssh yuanxin@192.168.0.111 "sudo install -d -m 700 -o jenkins -g jenkins /opt/FlomoEnhanced/.data"
ssh yuanxin@192.168.0.111 "ls -ld /opt/FlomoEnhanced /opt/FlomoEnhanced/.runtime /opt/FlomoEnhanced/.data"
```

- 不使用 `sudo mkdir -p`：`install -d` 会同时把属主/权限设置正确（`jenkins` 需要写 `/opt/FlomoEnhanced`，否则 `rsync` 会失败）。
- `/opt/FlomoEnhanced/.env` 与 `DEPLOYED_COMMIT` **不在这里创建**：`.env` 由 `deploy.sh start` 用 `umask 077` 生成（`600`），`DEPLOYED_COMMIT` 由 `update` 阶段写入。

## ③ 安装 systemd unit 与 sudoers

把仓库里的两个文件先传到服务器临时目录（`scp` 走同一套免密 SSH），再用 `install` 落地并校验：

```powershell
ssh yuanxin@192.168.0.111 "rm -rf /tmp/flomoenhanced-stage; mkdir -p /tmp/flomoenhanced-stage"
scp JenkinsConfig\flomoenhanced.service JenkinsConfig\sudoers.d-flomoenhanced-deploy yuanxin@192.168.0.111:/tmp/flomoenhanced-stage/

# systemd unit：/etc/systemd/system/flomoenhanced.service（644, root:root）
ssh yuanxin@192.168.0.111 "sudo install -m 644 -o root -g root /tmp/flomoenhanced-stage/flomoenhanced.service /etc/systemd/system/flomoenhanced.service"

# sudoers：/etc/sudoers.d/flomoenhanced-deploy（440, root:root）—— 必须用 install，不能直接 cp 到 /etc/sudoers.d
ssh yuanxin@192.168.0.111 "sudo install -m 440 -o root -g root /tmp/flomoenhanced-stage/sudoers.d-flomoenhanced-deploy /etc/sudoers.d/flomoenhanced-deploy"

# 语法校验（务必先 visudo -c 通过再 daemon-reload）
ssh yuanxin@192.168.0.111 "sudo visudo -c"
ssh yuanxin@192.168.0.111 "sudo systemd-analyze verify /etc/systemd/system/flomoenhanced.service"
ssh yuanxin@192.168.0.111 "sudo systemctl daemon-reload"
ssh yuanxin@192.168.0.111 "sudo systemctl enable --now flomoenhanced.service"
ssh yuanxin@192.168.0.111 "sudo systemctl reset-failed flomoenhanced.service"
ssh yuanxin@192.168.0.111 "rm -rf /tmp/flomoenhanced-stage"
```

- `sudo visudo -c` 期望输出包含 `.../flomoenhanced-deploy: 解析正确` 与 `已解析的 sudoers 文件`。
- 权限自测（列出 `jenkins` 被授权的命令，不改动任何状态）：

  ```powershell
  ssh yuanxin@192.168.0.111 "sudo -u jenkins -H sudo -n -l"
  # 期望输出中出现：
  #   (root) NOPASSWD: /usr/bin/systemctl stop flomoenhanced.service, /usr/bin/systemctl start flomoenhanced.service
  ```

  ⚠️ 不要用 `systemctl status`/`systemctl restart` 来自测：sudoers 只授权 `stop` 与 `start` 两个子命令（`deploy.sh` 也只调用这两个）。

- **预期现象**：此刻 `enable --now` 的首次启动会以 `203/EXEC`（自带 Node 与 `apps/api/dist/index.js` 尚不存在）失败，
  这是正常的——代码要等 ⑤ 的首次构建才会同步过去。所以紧接着执行了 `reset-failed`，清掉失败状态与 systemd 启动频率限制
  （否则后续 `systemctl start` 可能报 `start request repeated too quickly`）。
  真正把服务拉起来的是 ⑤ 构建中的 `Start and verify` 阶段。

## ④ 用 Jenkins REST API 创建任务

```powershell
# 1) 取 crumb（字段名为 Jenkins-Crumb）
#    ⚠️ Jenkins 的 crumb 与会话 Cookie 绑定：取 crumb 与后续 POST 必须共用同一个 Cookie（用 -c/-b 同一个 cookie jar）。
#    若只带 -u 不带 cookie jar，POST 会返回 403 "No valid crumb was included in the request"（实测踩到过）。
$cj = "$env:TEMP\jenkins-cookies.txt"
if (Test-Path $cj) { Remove-Item $cj }
$crumb = (curl.exe -s -c $cj -u admin:admin "http://192.168.0.111:8080/crumbIssuer/api/json" | ConvertFrom-Json).crumb
"crumb=$crumb"

# 2) 确认任务尚不存在（期望 HTTP=404）
curl.exe -s -o NUL -w "存在性检查 HTTP=%{http_code}`n" -u admin:admin "http://192.168.0.111:8080/job/FlomoEnhanced/api/json"

# 3) 创建任务（导入 JenkinsConfig/job-config.xml）
curl.exe -s -b $cj -c $cj -o "$env:TEMP\createItem.out" -w "createItem HTTP=%{http_code}`n" -u admin:admin `
  -H "Jenkins-Crumb: $crumb" -H "Content-Type: application/xml" `
  -X POST "http://192.168.0.111:8080/createItem?name=FlomoEnhanced" --data-binary "@JenkinsConfig/job-config.xml"
Get-Content "$env:TEMP\createItem.out"   # 成功时通常为空；失败时是 Jenkins 的错误 HTML

# 4) 校验创建结果（期望 HTTP=200；同时看配置里的 SCM 是否生效）
curl.exe -s -o NUL -w "创建后存在性 HTTP=%{http_code}`n" -u admin:admin "http://192.168.0.111:8080/job/FlomoEnhanced/api/json"
curl.exe -s -u admin:admin "http://192.168.0.111:8080/job/FlomoEnhanced/config.xml" | Select-String -Pattern "scriptPath|url|credentialsId|H/30"
```

- 成功返回 `createItem HTTP=200`；若返回 `400` 或 `302`，多为任务已存在或 XML 未通过校验，
  此时用浏览器核对 <http://192.168.0.111:8080/job/FlomoEnhanced/configure>（`Pipeline script from SCM`、脚本路径 `JenkinsConfig/Jenkinsfile`、仓库 `git@github.com:...`、凭据 `truthanalysis-github-ssh`、轮询 `H/30 * * * *`）。
- 若 Jenkins 关闭了 CSRF（不会），`-H "Jenkins-Crumb: ..."` 可以省略。
- `job-config.xml` 里已包含 `DisableConcurrentBuildsJobProperty`（禁并发）与 `SCMTrigger`（30 分钟轮询），无需页面上再配。

## ⑤ 触发构建并查看日志

```powershell
# 触发（无参数任务用 /build；返回 201 表示已入队。$crumb/$cj 沿用 ④ 的同一个 cookie jar）
curl.exe -s -b $cj -o NUL -w "build HTTP=%{http_code}`n" -u admin:admin -H "Jenkins-Crumb: $crumb" -X POST "http://192.168.0.111:8080/job/FlomoEnhanced/build"

# 进度与结果（result 为 null 表示还在跑；SUCCESS 为通过）
curl.exe -s -u admin:admin "http://192.168.0.111:8080/job/FlomoEnhanced/lastBuild/api/json?tree=number,building,result,duration"

# 控制台日志（也可直接在浏览器打开 /job/FlomoEnhanced/lastBuild/console）
curl.exe -s -u admin:admin "http://192.168.0.111:8080/job/FlomoEnhanced/lastBuild/consoleText"
```

也可在 <http://192.168.0.111:8080/job/FlomoEnhanced/> 点「Build Now」。首次构建会下载并校验 Node 24.13.0（约 30 MB）、
`npm ci` 安装整个 workspace，耗时可能数分钟；`options.timeout` 为 60 分钟。

## ⑥ 验收命令

```powershell
# 服务状态（应 active (running)，User=jenkins）
ssh yuanxin@192.168.0.111 "systemctl status flomoenhanced.service --no-pager -l"

# 最近日志 + 当前部署提交
ssh yuanxin@192.168.0.111 "sudo journalctl -u flomoenhanced.service -n 100 --no-pager"
ssh yuanxin@192.168.0.111 "cat /opt/FlomoEnhanced/DEPLOYED_COMMIT"

# 端口与监听地址（应为 0.0.0.0:35080）
ssh yuanxin@192.168.0.111 "ss -ltnp | grep 35080"

# 健康检查（应为 200 且 status=ok、db.ok=true）
curl.exe -s -w "`nHTTP=%{http_code}`n" http://192.168.0.111:35080/api/health

# 首页（应返回 HTML，含 id="root"）
curl.exe -s -o NUL -w "首页 HTTP=%{http_code} type=%{content_type}`n" http://192.168.0.111:35080/

# 只读健康检查脚本本身（部署后可在部署目录复跑）
ssh yuanxin@192.168.0.111 "cd /opt/FlomoEnhanced && /opt/FlomoEnhanced/.runtime/node-v24.13.0-linux-x64/bin/node JenkinsConfig/health.mjs"
```

浏览器验收（项目经理执行）：<http://192.168.0.111:35080> 走通 注册 → 建模板 → 记录想法 → 看洞察分析。

## ⑦ 常见失败与处置

| 现象 | 原因 / 处置 |
|---|---|
| `Build and test` 失败（`npm ci` / `typecheck` / `test` / `build` 报错） | 代码问题，交回对应实现者修复。此时**服务未受影响**（still running），可直接重复构建。 |
| `npm ci` 报缺 `package-lock.json` | 仓库根缺锁文件（`deploy.sh prepare` 会直接给出中文错误），需要 [F] 提交锁文件。 |
| `sudo: a password is required` | `/etc/sudoers.d/flomoenhanced-deploy` 未安装/路径不匹配：重做 ③，并 `sudo visudo -c`；自测 `ssh yuanxin@192.168.0.111 "sudo -u jenkins -H sudo -n -l"` 是否列出本项目的 stop/start 规则。 |
| `rsync: ... Permission denied` / `mkdir` 失败 | `/opt/FlomoEnhanced` 属主不是 `jenkins:jenkins`：重做 ②。 |
| `systemctl start` 报 `start request repeated too quickly` | 之前失败触发启动限流：`ssh yuanxin@192.168.0.111 "sudo systemctl reset-failed flomoenhanced.service"` 后重新构建。 |
| 服务 `status=203/EXEC` | `apps/api/dist/index.js` 或自带 Node 不存在：说明 `prepare`/`update` 没走完（看构建日志）。 |
| `Start and verify` 健康检查失败（45 次重试后抛出） | `sudo journalctl -u flomoenhanced.service -n 200 --no-pager`。常见：数据库迁移失败、`.data` 权限不对（应 700）、端口被占用（`ss -ltnp | grep 35080`）、`.env` 被手工改坏（看 `FLOMO_PORT`/`FLOMO_HOST` 是否 `35080`/`0.0.0.0`）。 |
| 访问 `http://192.168.0.111:35080` 打不开但服务 running | 检查 `ss` 是否监听 `0.0.0.0:35080`；检查服务器防火墙/安全组是否放行 35080。 |
| 轮询不自动触发 | 在任务页面确认 `Poll SCM` 为 `H/30 * * * *`；确认 Jenkins 能拉取（凭据 `truthanalysis-github-ssh`）；轮询只在有新提交时触发，可先用「Build Now」验证整条链路。 |
| Jenkinsfile 相关语法错误 | 本地先跑官方校验：`curl.exe -s -u admin:admin -X POST -F "jenkinsfile=<JenkinsConfig/Jenkinsfile" http://192.168.0.111:8080/pipeline-model-converter/validate`（期望 `Jenkinsfile successfully validated.`）。 |

## ⑧ 回滚方案（明确：不自动回滚）

**声明：本流水线不做自动回滚。** `post { failure }` 只输出中文排查提示；停止服务后如果同步或启动失败，
服务可能一直处于停止状态，需要人工介入。以下为人工回滚步骤。

1. **确定当前版本**
   ```powershell
   ssh yuanxin@192.168.0.111 "cat /opt/FlomoEnhanced/DEPLOYED_COMMIT"
   git log --oneline -10
   ```
   `/opt/FlomoEnhanced` 内没有 `.git`（rsync 排除），所以不能在服务器上 `git checkout` 旧版本；回滚统一由**代码 + 重新构建**完成。
2. **首选：revert 一个坏提交（保留历史，安全）**
   ```powershell
   git revert <出问题的提交>
   git push origin main
   # 触发一次构建（同 ⑤；新开终端需按 ④ 重新取 crumb 并共用同一 cookie jar）
   curl.exe -s -b $cj -o NUL -w "build HTTP=%{http_code}`n" -u admin:admin -H "Jenkins-Crumb: $crumb" -X POST "http://192.168.0.111:8080/job/FlomoEnhanced/build"
   ```
   由于 `rsync -a --delete` 是幂等全量同步，重新构建即可把 `/opt/FlomoEnhanced` 恢复到旧版本代码。
3. **紧急停服**（例如新版接口疯狂报错、需要立刻止损）
   ```powershell
   ssh yuanxin@192.168.0.111 "sudo systemctl stop flomoenhanced.service"
   ssh yuanxin@192.168.0.111 "systemctl status flomoenhanced.service --no-pager"
   ```
4. **数据不会被回滚**：部署过程从不删除或覆盖 `/opt/FlomoEnhanced/.data`（SQLite）与 `.env`。
   若坏版本做过不兼容的数据库迁移，仅回滚代码可能不够，需要人工用备份恢复 `.data`（当前项目没有自动备份，属于已知缺口）。
5. **保留现场**：处置前先留证据，便于定位：
   ```powershell
   ssh yuanxin@192.168.0.111 "sudo journalctl -u flomoenhanced.service -n 500 --no-pager > /tmp/flomoenhanced-fail.log; ls -l /tmp/flomoenhanced-fail.log"
   ```
6. 若回滚后需要重新同步：重复 ⑤ 触发构建；必要时先 `ssh yuanxin@192.168.0.111 "sudo systemctl reset-failed flomoenhanced.service"`。

## ⑨ 部署后的真实验收记录（已完成）

本节记录 **2026-10-18 本次实际部署** 的结果，用于替代上面 0 节与附录中的"尚未验证"状态。

### 9.1 流水线与构建

| 项目 | 实测值 |
|---|---|
| Jenkins 任务 | `FlomoEnhanced`（`http://192.168.0.111:8080/job/FlomoEnhanced/`，`color=blue`） |
| 最近构建 | `#2`，`result=SUCCESS`，耗时 43740 ms（约 43.7 秒） |
| 已部署提交 | `/opt/FlomoEnhanced/DEPLOYED_COMMIT` = `ae9fd998ec1f06e765ced5dcd21e98d577ed6345` |
| 四个阶段 | `prepare` / `build and test` / `update`（rsync + systemctl）/ `verify`（健康检查）全部通过 |

### 9.2 运行时状态

| 项目 | 实测命令 | 结果 |
|---|---|---|
| 服务状态 | `systemctl is-active flomoenhanced.service` | `active` |
| 运行用户 | `systemctl show -p User` | `User=jenkins` |
| 监听地址 | `ss -ltnp \| grep 35080` | `LISTEN 0 511 0.0.0.0:35080 0.0.0.0:*`（对外可达，符合 `FLOMO_HOST=0.0.0.0`） |
| 自带 Node | `ls -l /opt/FlomoEnhanced/.runtime/node-v24.13.0-linux-x64/bin/node` | 存在，121 MB，`-rwxr-xr-x` |
| 部署根目录 | `ls -ld /opt/FlomoEnhanced` | `drwxr-xr-x jenkins jenkins` |
| 数据目录 | `ls -ld /opt/FlomoEnhanced/.data` | `drwx------ jenkins jenkins`（700） |
| 环境文件 | `ls -l /opt/FlomoEnhanced/.env` | `-rw------- jenkins jenkins`（600） |
| 健康检查 | `GET /api/health` | HTTP 200，`status=ok`、`db.ok=true` |
| 首页 | `GET /` | HTTP 200，`text/html`，含 `id="root"` |

### 9.3 自愈与行为验证

| 验证项 | 结果 |
|---|---|
| 重启自愈（`systemctl stop` 后由 `deploy.sh` 拉起的 `start` 恢复） | 通过：服务重新 `active`，端口重新监听，健康检查恢复 200 |
| 幂等重跑 | 通过：连续两次构建（`#1`、`#2`）均 `SUCCESS`，`rsync -a --delete` 全量同步不影响 `.data`/`.env` |
| 只读健康检查脚本 | `node JenkinsConfig/health.mjs` 在部署目录内可复跑，返回健康结果 |

### 9.4 端到端验收

| 验收方式 | 结果 |
|---|---|
| 项目经理自动化脚本（外部模式） | `node scripts/acceptance-e2e.mjs --external http://192.168.0.111:35080` → **143/143 断言通过** |
| 项目经理浏览器人工验收 | 通过：注册 → 建模板（文本 + 金额字段）→ 记想法（含/不含模板）→ 洞察分析（概览 + 单模板统计）→ CSV 导出 → 改密码 → 多用户隔离 → 健康检查 |
| 单模板统计正确性抽查 | 金额合计 ¥105.50、平均 ¥35.17、中位数 ¥35.50、P25 ¥31.75、P75 ¥38.75、标准差 ¥7.01（ddof=1）、字段填写率 100%——与 `docs/ANALYTICS.md` 语义一致 |

### 9.5 已知残留（非缺陷）

- 自动化验收与人工验收**在真实数据库里留下了测试数据**（用户、模板、想法）。当前 `GET /api/health` 统计：`users=3`（另有隔离测试用户）、`templates=6`、`memos=47`。
  这些数据仅用于验收，若要清空可在停服后删除 `/opt/FlomoEnhanced/.data` 下的 SQLite 文件再重启（会丢失所有业务数据，请确认后操作）。
- `POST /api/auth/login` 等接口在首次未登录访问 `/api/auth/me` 时会返回一次 `401`，属于前端启动时的预期探测，控制台中的该条 401 不是错误。

## 附：本次交付时的静态校验记录（真实输出）

| 校验项 | 命令 | 结果 |
|---|---|---|
| deploy.sh 语法 | 服务器上 `bash -n /tmp/flomoenhanced-check/deploy.sh`（bash 5.2.21） | 通过（exit 0，无输出） |
| deploy.sh 用法分支 | 服务器上 `bash /tmp/.../deploy.sh`（无参数） | 打印用法，`exit=2` |
| health.mjs 语法 | 本地 `node --check JenkinsConfig/health.mjs`（Node v24.13.0） | `exit 0` |
| Jenkinsfile | `POST /pipeline-model-converter/validate`（admin:admin） | `Jenkinsfile successfully validated.` |
| sudoers 片段 | 服务器上 `sudo -n visudo -cf /tmp/.../sudoers.d-flomoenhanced-deploy` | `... 解析正确`（exit 0） |
| systemd unit | 服务器上 `systemd-analyze verify`（ExecStart 临时替换为 `/bin/true` 以规避尚未安装的自带 Node） | `exit=0`（唯一提示是服务器上无关的既有 `runawesun.service` 可执行位告警） |
| job-config.xml | PowerShell `[xml]` 解析 + 服务器 `python3 xml.etree` 解析 | 均解析成功；`scriptPath=JenkinsConfig/Jenkinsfile`、`lightweight=true`、`url=git@github.com:yuan-xin-9997/FlomoEnhanced.git`、`credentialsId=truthanalysis-github-ssh`、`branch=*/main`、`trigger=H/30 * * * *`、`disabled=false` |
| 行尾/编码 | 本地逐字节检查 `JenkinsConfig/*` | 全部 LF、无 BOM |
| 验收脚本语法 | 本地 `node --check scripts/acceptance-e2e.mjs`（Node v24.13.0） | `exit 0` |

**部署阶段已全部验证**：`deploy.sh` 四个阶段（Node 下载校验、`npm ci`、构建、rsync、`systemctl stop/start`、健康检查）已在服务器上端到端跑通，
Jenkins 任务已创建并两次构建成功，端口 `35080` 已在 `0.0.0.0` 上可访问。真实证据见 ⑨「部署后的真实验收记录」。
