/**
 * 密码哈希（SPEC §8.1）—— 签名由基础脚手架冻结，实现归 A1。
 * 约束：只能用 `node:crypto` 的 scrypt（禁止 bcrypt/argon2 等原生模块）。
 * 参数：N=16384, r=8, p=1, keylen=64，16 字节随机盐，`salt`/`hash` 以十六进制分开存。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** 存储形态的密码（对应 users 表的 password_algo/password_salt/password_hash 三列） */
export interface StoredPassword {
  algo: string;
  salt: string;
  hash: string;
}

/** 算法标识（写入 `users.password_algo`） */
export const PASSWORD_ALGO = 'scrypt';

/** scrypt 参数（SPEC §8.1 冻结：N=16384, r=8, p=1, keylen=64） */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
/** 盐长度：16 字节随机 */
const SALT_BYTES = 16;
/** 128 * N * r ≈ 16 MiB，留出余量避免不同 Node 版本默认 maxmem 差异导致失败 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** 密码长度约束（SPEC §8.1） */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * 常见弱口令小表（全部小写；用于拒绝明显可被字典穷举的密码）。
 * 刻意保持精简（约 36 项），避免误伤正常测试口令。
 */
const COMMON_WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  'password',
  'password1',
  'passw0rd',
  'p@ssw0rd',
  'qwertyui',
  'qwerty123',
  'qwertyuiop',
  '11111111',
  '22222222',
  '00000000',
  '88888888',
  'abc12345',
  'a1234567',
  '1234abcd',
  'admin123',
  'admin888',
  'administrator',
  'iloveyou',
  'letmein1',
  'welcome1',
  'monkey123',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'dragon123',
  'superman',
  'woaini1314',
  '1qaz2wsx',
  'asdfghjkl',
  'changeme',
  'flomoenhanced',
]);

/** 用 scrypt 派生密钥（同步、恒定参数） */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** 按 code point 计算长度（与 `lib/validate.ts` 的口径一致） */
function passwordLength(password: string): number {
  return Array.from(password).length;
}

/** 生成 scrypt 哈希（16 字节随机盐） */
export function hashPassword(password: string): StoredPassword {
  const value = typeof password === 'string' ? password : String(password ?? '');
  const salt = randomBytes(SALT_BYTES);
  const hash = deriveKey(value, salt);
  return {
    algo: PASSWORD_ALGO,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
  };
}

/**
 * 恒定时间比对密码。
 * 任何异常（参数损坏、算法不匹配、hex 非法）都返回 `false`，绝不抛出，
 * 以免登录接口因数据损坏而 500（也会泄露「该用户存在」的信息）。
 */
export function verifyPassword(password: string, stored: StoredPassword): boolean {
  try {
    if (typeof password !== 'string' || password === '') return false;
    if (stored === null || typeof stored !== 'object') return false;
    if (stored.algo !== PASSWORD_ALGO) return false;
    if (typeof stored.salt !== 'string' || typeof stored.hash !== 'string') return false;

    const salt = Buffer.from(stored.salt, 'hex');
    const expected = Buffer.from(stored.hash, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = deriveKey(password, salt);
    if (actual.length !== expected.length) {
      // 长度不等时先做一次等长比较再返回 false：既让耗时与正常路径接近，
      // 又避免 `timingSafeEqual` 因长度不同直接抛异常。
      const shorter = Math.min(actual.length, expected.length);
      timingSafeEqual(actual.subarray(0, shorter), expected.subarray(0, shorter));
      return false;
    }
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 返回密码强度问题列表（空数组表示合规；长度 8..128）。
 * 仅负责「密码自身」的强度：是否与用户名相同由调用方（domain/users.ts）校验。
 */
export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = [];
  if (typeof password !== 'string') return ['密码必须是字符串'];

  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) {
    errors.push(`密码长度至少需要 ${PASSWORD_MIN_LENGTH} 个字符`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    errors.push(`密码长度不能超过 ${PASSWORD_MAX_LENGTH} 个字符`);
  }

  const trimmed = password.trim();
  if (trimmed === '') {
    errors.push('密码不能全是空白字符');
  } else if (COMMON_WEAK_PASSWORDS.has(trimmed.toLowerCase())) {
    errors.push('密码过于简单，请更换更复杂的密码');
  }

  return errors;
}
