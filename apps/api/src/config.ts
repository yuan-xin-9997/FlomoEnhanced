/**
 * 运行配置（SPEC §4）。环境变量前缀 `FLOMO_`，全部有默认值。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface Config {
  /** 监听网卡，默认 0.0.0.0 */
  host: string;
  /** 监听端口，默认 35080 */
  port: number;
  /** SQLite 文件所在目录（绝对路径） */
  dataDir: string;
  /** 数据库文件名或绝对路径 */
  dbFile: string;
  /** 统计分日依据的时区 */
  tz: string;
  /** 会话有效期（天） */
  sessionTtlDays: number;
  /** 会话签名密钥（保留给未来扩展；当前不参与校验） */
  sessionSecret: string;
  /** 是否允许注册 */
  allowRegistration: boolean;
  /** 前端静态目录（绝对路径） */
  webDist: string;
  /** fastify logger 级别 */
  logLevel: string;
  /** 应用版本 */
  appVersion: string;
  /** 运行环境（NODE_ENV） */
  env: string;
}

/** 本文件所在目录：`apps/api/src`（tsx）或 `apps/api/dist`（构建后） */
const moduleDir = dirname(fileURLToPath(import.meta.url));

/** 仓库根目录 */
export const REPO_ROOT = resolve(moduleDir, '..', '..', '..');

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  throw new Error(`环境变量 ${key} 必须是 0/1 或 true/false，当前值："${raw}"`);
}

function readInteger(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`环境变量 ${key} 必须是 ${min}..${max} 之间的整数，当前值："${raw}"`);
  }
  return value;
}

function resolveFromRepo(value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
}

/** 读取 `apps/api/package.json` 的版本号（失败时回退 1.0.0） */
function readAppVersion(): string {
  const candidates = [resolve(moduleDir, '..', 'package.json'), resolve(moduleDir, '..', '..', 'package.json')];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (parsed.name === '@flomo/api' && typeof parsed.version === 'string') return parsed.version;
    } catch {
      // 忽略，回退到下一条
    }
  }
  return '1.0.0';
}

function assertValidTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`环境变量 FLOMO_TZ 不是合法的时区名称，当前值："${tz}"（示例：Asia/Shanghai）`);
  }
}

/** 加载配置；`env` 省略时读取 `process.env` */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = readString(env, 'FLOMO_HOST') ?? '0.0.0.0';
  const port = readInteger(env, 'FLOMO_PORT', 35080, 1, 65535);
  const dataDir = resolveFromRepo(readString(env, 'FLOMO_DATA_DIR') ?? join(REPO_ROOT, '.data'));
  const dbFile = readString(env, 'FLOMO_DB_FILE') ?? 'flomoenhanced.db';
  const tz = readString(env, 'FLOMO_TZ') ?? 'Asia/Shanghai';
  assertValidTimeZone(tz);
  const sessionTtlDays = readInteger(env, 'FLOMO_SESSION_TTL_DAYS', 30, 1, 3650);
  const sessionSecret = readString(env, 'FLOMO_SESSION_SECRET') ?? randomBytes(32).toString('hex');
  const allowRegistration = readBoolean(env, 'FLOMO_ALLOW_REGISTRATION', true);
  const webDist = resolveFromRepo(readString(env, 'FLOMO_WEB_DIST') ?? join(REPO_ROOT, 'apps', 'web', 'dist'));
  const logLevel = readString(env, 'FLOMO_LOG_LEVEL') ?? 'info';
  const appVersion = readAppVersion();
  const nodeEnv = readString(env, 'NODE_ENV') ?? 'development';

  return {
    host,
    port,
    dataDir,
    dbFile,
    tz,
    sessionTtlDays,
    sessionSecret,
    allowRegistration,
    webDist,
    logLevel,
    appVersion,
    env: nodeEnv,
  };
}

/** 数据库文件的绝对路径（`FLOMO_DB_FILE` 为绝对路径时直接使用） */
export function resolveDbPath(config: Config): string {
  return isAbsolute(config.dbFile) ? config.dbFile : join(config.dataDir, config.dbFile);
}

/** 确保数据目录存在（首次启动时自动创建） */
export function ensureDataDir(config: Config): string {
  const dir = dirname(resolveDbPath(config));
  mkdirSync(dir, { recursive: true });
  return dir;
}
