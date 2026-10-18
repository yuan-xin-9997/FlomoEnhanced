import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  validatePassword,
  validatePasswordChange,
  validatePasswordConfirm,
  validateUsername,
} from './auth';

describe('用户名校验（SPEC §8.1）', () => {
  it('规则为 3-32 位字母数字下划线连字符', () => {
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a_1-B')).toBeNull();
    expect(validateUsername('  abc  ')).toBeNull();
    expect(validateUsername('')).toBe('请输入用户名');
    expect(validateUsername('ab')).toBe('用户名需为 3-32 位字母、数字、下划线或连字符');
    expect(validateUsername('a'.repeat(33))).toBe('用户名需为 3-32 位字母、数字、下划线或连字符');
    expect(validateUsername('中文名')).toBe('用户名需为 3-32 位字母、数字、下划线或连字符');
    expect(USERNAME_PATTERN.test('abc_123')).toBe(true);
  });
});

describe('密码校验', () => {
  it('长度边界', () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(validatePassword('')).toBe('请输入密码');
    expect(validatePassword('1234567')).toBe('密码至少 8 位');
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toBe(`密码不能超过 ${PASSWORD_MAX} 位`);
  });

  it('两次输入一致性', () => {
    expect(validatePasswordConfirm('12345678', '12345678')).toBeNull();
    expect(validatePasswordConfirm('12345678', '')).toBe('请再次输入密码');
    expect(validatePasswordConfirm('12345678', '12345679')).toBe('两次输入的密码不一致');
  });
});

describe('validatePasswordChange', () => {
  it('逐字段返回中文错误', () => {
    const errors = validatePasswordChange('', 'short', 'other');
    expect(errors.currentPassword).toBe('请输入当前密码');
    expect(errors.newPassword).toBe('密码至少 8 位');
    expect(errors.confirm).toBe('两次输入的密码不一致');
  });

  it('新密码不能与当前密码相同', () => {
    expect(validatePasswordChange('12345678', '12345678', '12345678').newPassword).toBe('新密码不能与当前密码相同');
  });

  it('合法输入无错误', () => {
    expect(validatePasswordChange('oldpass123', 'newpass456', 'newpass456')).toEqual({});
  });
});
