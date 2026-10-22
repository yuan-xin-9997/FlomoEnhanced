#!/usr/bin/env bash
# 浮墨增强版（FlomoEnhanced）部署脚本
#
# 用法（在 Jenkins 工作区，即仓库根目录执行）：
#   bash JenkinsConfig/deploy.sh prepare|stop|update|start
#
# Jenkinsfile 依次调用 prepare -> stop -> update -> start：
#   prepare 构建与测试（失败时不会停止现有服务）
#   stop    停止现有服务
#   update  把工作区代码同步到 /opt/FlomoEnhanced
#   start   启动服务并做只读健康检查
#
# 约定：部署根目录 /opt/FlomoEnhanced（属主 jenkins:jenkins）、服务 flomoenhanced.service、
#       项目自带 Node 运行时 /opt/FlomoEnhanced/.runtime/node-v24.13.0-linux-x64。
set -euo pipefail

deploy_root=/opt/FlomoEnhanced
node_version=24.13.0
runtime="$deploy_root/.runtime/node-v$node_version-linux-x64"
git_url=git@github.com:yuan-xin-9997/FlomoEnhanced.git
service=flomoenhanced.service
health_script=JenkinsConfig/health.mjs

# 工作区（Jenkins 检出目录）根：本脚本位于 <root>/JenkinsConfig/deploy.sh
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

export PATH="$runtime/bin:$PATH"

log() { printf '[deploy] %s\n' "$*"; }

# 失败时的排查提示（不自动回滚，不隐藏原始错误）
hint() {
  printf '\n[deploy] 排查提示：\n' >&2
  printf '  * 服务状态与最近日志：sudo systemctl status %s --no-pager ; sudo journalctl -u %s -n 200 --no-pager\n' "$service" "$service" >&2
  printf '  * 部署目录（属主 jenkins）：%s ；当前部署提交：%s/DEPLOYED_COMMIT\n' "$deploy_root" "$deploy_root" >&2
  printf '  * 应用配置：%s/.env ；数据目录：%s/.data\n' "$deploy_root" "$deploy_root" >&2
  printf '  * 本流水线在 build/test 失败时不会停止正在运行的服务；同步或启动失败需要人工判断是否回滚（见 JenkinsConfig/README.md 的回滚步骤）\n' >&2
}
on_error() { printf '\n[deploy] 执行失败（命令退出码 %s）。\n' "$1" >&2; hint; }
trap 'on_error $?' ERR

die() { printf '[deploy] 错误：%s\n' "$*" >&2; exit 1; }

# 优先使用项目自带的 Node 24.13.0，退化到系统 node
node_bin() {
  if [[ -x "$runtime/bin/node" ]]; then
    printf '%s\n' "$runtime/bin/node"
  else
    command -v node
  fi
}

case "${1:-}" in
  prepare)
    log "阶段 1/4：构建与测试（架构检查 / Node 运行时 / npm ci / typecheck / test / build）"

    arch="$(uname -m)"
    [[ "$arch" = x86_64 ]] || die "本部署脚本仅支持 x86_64，当前架构为 $arch"

    if [[ ! -x "$runtime/bin/node" ]]; then
      log "未发现项目自带 Node v$node_version，开始从 nodejs.org 下载并校验（临时目录由 mktemp 创建，退出时清理）"
      mkdir -p "$deploy_root/.runtime"
      download="$(mktemp -d)"
      trap 'rm -rf -- "${download:-}"' EXIT

      archive="node-v$node_version-linux-x64.tar.xz"
      base_url="https://nodejs.org/download/release/v$node_version"
      curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 --speed-time 30 --speed-limit 1024 \
        "$base_url/$archive" -o "$download/$archive"
      curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 --speed-time 30 --speed-limit 1024 \
        "$base_url/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
      log "校验 $archive 的 sha256"
      (cd "$download"; grep "  $archive\$" SHASUMS256.txt | sha256sum --check --strict -)
      log "解压 Node 运行时到 $deploy_root/.runtime"
      tar -xJf "$download/$archive" -C "$deploy_root/.runtime"

      rm -rf -- "$download"
      trap - EXIT
    fi

    export PATH="$runtime/bin:$PATH"
    current_node_version="$("$runtime/bin/node" --version)"
    [[ "$current_node_version" = "v$node_version" ]] \
      || die "项目自带 Node 版本不符：期望 v$node_version，实际 $current_node_version"

    "$(node_bin)" "$source_root/JenkinsConfig/check-data-path.mjs" "$deploy_root"

    cd "$source_root"
    log "工作区：$source_root"
    [[ -f package-lock.json ]] \
      || die "仓库根缺少 package-lock.json（npm workspaces 必须提交锁文件），无法执行 npm ci"
    [[ -f package.json ]] || die "仓库根缺少 package.json"

    log "npm ci（使用项目自带 Node $(node --version)，npm $(npm --version)）"
    npm ci --no-audit --no-fund

    log "npm run typecheck"
    npm run typecheck

    log "npm test"
    npm test

    log "npm run build"
    npm run build

    log "阶段 1/4 完成：构建与测试全部通过，尚未停止现有服务"
    ;;

  stop)
    log "阶段 2/4：停止 $service（此阶段起至启动完成，服务不可用）"
    sudo -n /usr/bin/systemctl stop "$service"
    log "已停止 $service"
    ;;

  update)
    log "阶段 3/4：同步工作区代码到 $deploy_root"
    mkdir -p "$deploy_root"

    [[ "$source_root" != "$deploy_root" ]] \
      || die "工作区与部署目录相同（$source_root），拒绝同步，避免误删源码"
    resolved_deploy_root="$(realpath "$deploy_root")"
    [[ "$resolved_deploy_root" = "$deploy_root" ]] \
      || die "部署目录解析结果异常：$resolved_deploy_root（期望 $deploy_root）"

    actual_git_url="$(git -C "$source_root" remote get-url origin)"
    [[ "$actual_git_url" = "$git_url" ]] \
      || die "工作区 origin 不是 $git_url，实际为 $actual_git_url，拒绝部署"

    "$(node_bin)" "$source_root/JenkinsConfig/check-data-path.mjs" "$deploy_root"

    log "rsync 同步（保留 .data/、.env、.runtime/、.tools/ 等运行期内容）"
    rsync -a --delete \
      --exclude='.git/' \
      --exclude='.data/' \
      --exclude='.env' \
      --exclude='.env.*' \
      --exclude='.runtime/' \
      --exclude='.tools/' \
      --exclude='node_modules/.cache/' \
      --exclude='test-results/' \
      --exclude='coverage/' \
      "$source_root/" "$deploy_root/"

    git -C "$source_root" rev-parse HEAD > "$deploy_root/DEPLOYED_COMMIT"
    log "已写入 DEPLOYED_COMMIT：$(< "$deploy_root/DEPLOYED_COMMIT")"
    ;;

  start)
    log "阶段 4/4：启动 $service 并做只读健康检查"

    log "确保数据目录 $deploy_root/.data（权限 700）"
    install -d -m 700 "$deploy_root/.data"

    if [[ ! -f "$deploy_root/.env" ]]; then
      log "未发现 $deploy_root/.env，生成默认配置（监听 0.0.0.0:35080，会话密钥随机生成）"
      session_secret="$(openssl rand -hex 32)"
      (
        umask 077
        cat > "$deploy_root/.env" <<EOF
FLOMO_HOST=0.0.0.0
FLOMO_PORT=35080
FLOMO_TZ=Asia/Shanghai
FLOMO_SESSION_SECRET=$session_secret
EOF
      )
      chmod 600 "$deploy_root/.env"
    else
      log "已存在 $deploy_root/.env，保持不变（如需修改端口或配置请直接编辑该文件后重启服务）"
    fi

    sudo -n /usr/bin/systemctl start "$service"
    log "已提交启动请求，开始只读健康检查（$deploy_root/$health_script）"
    "$(node_bin)" "$deploy_root/$health_script"

    log "部署完成：$service 运行中，访问地址 http://192.168.0.111:35080"
    log "当前部署提交：$(< "$deploy_root/DEPLOYED_COMMIT")"
    ;;

  *)
    printf '用法：deploy.sh prepare|stop|update|start\n' >&2
    printf '  prepare  构建与测试（npm ci / typecheck / test / build），不触碰现有服务\n' >&2
    printf '  stop     停止 %s\n' "$service" >&2
    printf '  update   把工作区代码 rsync 到 %s（保留 .data/.env/.runtime）\n' "$deploy_root" >&2
    printf '  start    确保 .data 与 .env，启动服务并做只读健康检查\n' >&2
    exit 2
    ;;
esac
