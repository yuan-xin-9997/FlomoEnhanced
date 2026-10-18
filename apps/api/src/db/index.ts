/**
 * SQLite 打开、PRAGMA 设置与迁移执行（SPEC §5）。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations.js';

export interface OpenDatabaseOptions {
  /** 数据库文件路径（绝对路径，或相对于 cwd） */
  file: string;
  /** 是否自动创建父目录，默认 true */
  createDir?: boolean;
}

/** 读取当前架构版本 */
export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined;
  const value = row?.user_version ?? 0;
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

/**
 * 按 `PRAGMA user_version` 顺序执行迁移（整体事务）。
 * 数据库版本高于代码已知版本时抛错拒绝启动。
 */
export function migrate(db: DatabaseSync): number {
  const current = getSchemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `数据库架构版本（${current}）高于当前程序支持的版本（${SCHEMA_VERSION}），已拒绝启动。请升级程序或恢复备份。`,
    );
  }
  if (current === SCHEMA_VERSION) return current;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (let version = current + 1; version <= SCHEMA_VERSION; version += 1) {
      const sql = MIGRATIONS[version - 1];
      if (sql === undefined) throw new Error(`缺少 v${version} 的迁移脚本`);
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 忽略回滚失败
    }
    throw error;
  }
  return SCHEMA_VERSION;
}

/** 打开数据库并完成 PRAGMA 设置与迁移 */
export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  const file = options.file;
  if (options.createDir !== false) {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

/** 关闭数据库（幂等，忽略重复关闭错误） */
export function closeDatabase(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // 已关闭则忽略
  }
}
