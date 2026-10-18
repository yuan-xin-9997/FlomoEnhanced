/**
 * 后端入口（SPEC §4）：读取配置 → 打开数据库 → 装配应用 → 监听 0.0.0.0:35080。
 * 收到 SIGINT/SIGTERM 时优雅关闭（先关 HTTP，再关数据库）。
 */
import type { Config } from './config.js';
import { buildApp } from './app.js';
import { ensureDataDir, loadConfig, resolveDbPath } from './config.js';
import { closeDatabase, openDatabase } from './db/index.js';

/** 把监听失败（端口占用等）翻译成可操作的中文提示 */
function describeListenError(error: unknown, config: Config): string {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'EADDRINUSE') {
    return `端口 ${config.port} 已被占用：请先停止占用该端口的进程（可执行 netstat -ano | findstr :${config.port} 后结束对应进程），或改用环境变量 FLOMO_PORT 指定其它端口。`;
  }
  if (code === 'EACCES') {
    return `没有权限监听 ${config.host}:${config.port}：请改用 1024 以上的端口，或以管理员权限运行。`;
  }
  if (code === 'EADDRNOTAVAIL') {
    return `网卡地址 ${config.host} 在本机不可用：请检查环境变量 FLOMO_HOST 的配置。`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const config = loadConfig();
  ensureDataDir(config);
  const dbFile = resolveDbPath(config);
  const db = openDatabase({ file: dbFile });
  const app = await buildApp({ config, db });

  app.log.info(`数据库已就绪：${dbFile}`);

  // 未捕获的 Promise 拒绝：记录日志但不退出，避免单个请求的漏网异常拖垮整个服务。
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, '未处理的 Promise 拒绝（已记录，服务继续运行）');
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info(`收到 ${signal}，正在优雅关闭浮墨增强版…`);
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, '关闭 HTTP 服务失败');
    }
    try {
      closeDatabase(db);
    } catch (error) {
      app.log.error({ err: error }, '关闭数据库失败');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error({ err: error }, '监听端口失败');
    // 控制台也输出一次，保证红色启动日志里能直接看到中文原因。
    console.error(`浮墨增强版启动失败：${describeListenError(error, config)}`);
    try {
      await app.close();
    } catch {
      // 忽略关闭失败
    }
    closeDatabase(db);
    process.exit(1);
  }

  app.log.info(
    `浮墨增强版已启动：http://${config.host}:${config.port}　数据目录：${config.dataDir}　数据库：${dbFile}　时区：${config.tz}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`浮墨增强版启动失败：${message}`);
  process.exit(1);
});
