/**
 * 用户领域逻辑（SPEC §8.1）—— 签名由基础脚手架冻结，实现归 A1。
 * 要求：SQL 全参数化、写操作包事务、`toUserDto` 永不返回密码字段。
 *
 * 关于「改密后吊销其它会话」：本模块的 `changePassword` 签名（4 个参数、返回 void）拿不到
 * 「当前会话」，无法自行保留当前会话；因此吊销动作由路由层调用
 * `lib/session.ts` 的 `revokeOtherSessions(app, userId, keepSessionId)` 完成（见 `routes/auth.ts`）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { User } from '@flomo/shared';
import { AppError, conflict, unauthorized, validationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { hashPassword, verifyPassword, validatePasswordStrength, type StoredPassword } from '../lib/password.js';
import { nowIso } from '../lib/time.js';

/** 用户名规则（SPEC §8.1）：3..32 位字母/数字/下划线/连字符 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

const USERNAME_MESSAGE = '用户名只能包含 3..32 位的字母、数字、下划线或连字符';

/** users 表显式列（禁止 SELECT *） */
const USER_COLUMNS = 'id, username, password_hash, password_salt, password_algo, created_at, updated_at';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_algo: string;
  created_at: string;
  updated_at: string;
}

/** 在事务中执行（已在事务内则直接执行，避免嵌套 BEGIN 报错） */
function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw error;
  }
}

/** 判断是否为 UNIQUE 约束冲突（用户名唯一索引，COLLATE NOCASE） */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

/** 数据库异常（bug/IO）转换为 500，避免把 SQLite 细节暴露给客户端 */
function asInternalError(error: unknown, message: string): AppError {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL', message, error instanceof Error ? error.message : undefined);
}

function readText(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** 密码强度校验（含「不得与用户名相同」，用户名由调用方传入） */
function assertPasswordStrength(password: string, username?: string): void {
  const errors = validatePasswordStrength(password);
  if (
    username !== undefined &&
    username !== '' &&
    password.trim().toLowerCase() === username.trim().toLowerCase()
  ) {
    errors.push('密码不能与用户名相同');
  }
  if (errors.length > 0) throw validationError('密码不符合要求', errors);
}

/** 登录失败时的等价哈希运算（抹平「用户是否存在」的耗时差异），惰性初始化并缓存 */
let dummyStoredPassword: StoredPassword | null = null;

function timingDecoy(): StoredPassword {
  if (dummyStoredPassword === null) {
    dummyStoredPassword = hashPassword('flomo-timing-decoy-password');
  }
  return dummyStoredPassword;
}

function readUserRow(db: DatabaseSync, column: 'id' | 'username', value: string): UserRow | null {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE ${column} = ? LIMIT 1`)
    .get(value) as unknown as UserRow | undefined;
  return row ?? null;
}

/** 注册用户并返回 DTO */
export function registerUser(db: DatabaseSync, username: string, password: string): User {
  const normalized = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME_PATTERN.test(normalized)) {
    throw validationError(USERNAME_MESSAGE, [USERNAME_MESSAGE]);
  }

  const passwordValue = typeof password === 'string' ? password : '';
  assertPasswordStrength(passwordValue, normalized);

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').get(normalized) as unknown as
      | { id?: string }
      | undefined;
    if (existing !== undefined && typeof existing.id === 'string') {
      throw conflict('该用户名已被注册');
    }

    const id = newId();
    const createdAt = nowIso();
    const stored = hashPassword(passwordValue);

    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, password_salt, password_algo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, normalized, stored.hash, stored.salt, stored.algo, createdAt, createdAt);
    });

    const created = findUserById(db, id);
    if (created === null) throw new AppError('INTERNAL', '用户创建后无法读取，请重试');
    return created;
  } catch (error) {
    // 并发/竞态下的唯一约束冲突同样返回 409（COLLATE NOCASE 保证大小写不敏感）
    if (isUniqueViolation(error)) throw conflict('该用户名已被注册');
    throw asInternalError(error, '注册用户失败，请稍后重试');
  }
}

/** 登录校验，成功返回 DTO，失败返回 null（调用方统一文案） */
export function loginUser(db: DatabaseSync, username: string, password: string): User | null {
  try {
    const normalized = typeof username === 'string' ? username.trim() : '';
    const row = readUserRow(db, 'username', normalized);
    const rawPassword = typeof password === 'string' ? password : '';

    // 用户不存在时也做一次等价的 scrypt 运算：让失败响应耗时与「密码错误」接近，
    // 避免通过时间差推断用户名是否存在。
    if (row === null) {
      verifyPassword(rawPassword, timingDecoy());
      return null;
    }

    const ok = verifyPassword(rawPassword, {
      algo: row.password_algo,
      salt: row.password_salt,
      hash: row.password_hash,
    });
    return ok ? toUserDto(row) : null;
  } catch (error) {
    throw asInternalError(error, '登录校验失败，请稍后重试');
  }
}

/** 按 id 查询用户 */
export function findUserById(db: DatabaseSync, id: string): User | null {
  const row = readUserRow(db, 'id', typeof id === 'string' ? id : '');
  return row === null ? null : toUserDto(row);
}

/** 按用户名查询用户（大小写不敏感，依赖列上的 COLLATE NOCASE） */
export function findUserByUsername(db: DatabaseSync, username: string): User | null {
  const normalized = typeof username === 'string' ? username.trim() : '';
  const row = readUserRow(db, 'username', normalized);
  return row === null ? null : toUserDto(row);
}

/**
 * 修改密码（校验当前密码；新密码走强度校验）。
 * 校验失败抛 `VALIDATION_FAILED`（文案「当前密码不正确」）。
 * 会话吊销（保留当前会话）由调用方在路由层执行，见本文件顶部说明。
 */
export function changePassword(
  db: DatabaseSync,
  userId: string,
  currentPassword: string,
  newPassword: string,
): void {
  try {
    const row = readUserRow(db, 'id', typeof userId === 'string' ? userId : '');
    if (row === null) throw unauthorized('请先登录');

    const current = typeof currentPassword === 'string' ? currentPassword : '';
    const ok = verifyPassword(current, {
      algo: row.password_algo,
      salt: row.password_salt,
      hash: row.password_hash,
    });
    if (!ok) throw validationError('当前密码不正确');

    const next = typeof newPassword === 'string' ? newPassword : '';
    assertPasswordStrength(next, row.username);

    const stored = hashPassword(next);
    const updatedAt = nowIso();

    inTransaction(db, () => {
      db.prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ? WHERE id = ?',
      ).run(stored.hash, stored.salt, stored.algo, updatedAt, row.id);
    });
  } catch (error) {
    throw asInternalError(error, '修改密码失败，请稍后重试');
  }
}

/** 用户总数（健康检查使用） */
export function countUsers(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c?: number | bigint } | undefined;
  const value = row?.c ?? 0;
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

/** users 表行 → User DTO（永不包含密码字段） */
export function toUserDto(row: unknown): User {
  if (typeof row !== 'object' || row === null) {
    throw new AppError('INTERNAL', '用户数据格式不正确');
  }
  const record = row as Record<string, unknown>;
  const id = readText(record, 'id');
  const username = readText(record, 'username');
  const createdAt = readText(record, 'createdAt', 'created_at');
  if (id === undefined || username === undefined || createdAt === undefined) {
    throw new AppError('INTERNAL', '用户数据不完整');
  }
  // 只挑出 DTO 字段：即使传入的是完整行，也不会把 password_* 泄露出去。
  return { id, username, createdAt };
}
