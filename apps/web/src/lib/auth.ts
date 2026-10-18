/**
 * 认证表单校验（与 SPEC §8.1 的规则一致，纯函数）。
 */

/** 用户名规则（SPEC §8.1） */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** 密码长度规则 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function validateUsername(username: string): string | null {
  const value = username.trim();
  if (value === '') return '请输入用户名';
  if (!USERNAME_PATTERN.test(value)) return '用户名需为 3-32 位字母、数字、下划线或连字符';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password === '') return '请输入密码';
  if (Array.from(password).length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (Array.from(password).length > PASSWORD_MAX) return `密码不能超过 ${PASSWORD_MAX} 位`;
  return null;
}

export function validatePasswordConfirm(password: string, confirm: string): string | null {
  if (confirm === '') return '请再次输入密码';
  if (password !== confirm) return '两次输入的密码不一致';
  return null;
}

/** 修改密码的表单校验（新密码不能与当前密码相同） */
export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirm: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (currentPassword === '') errors.currentPassword = '请输入当前密码';
  const passwordError = validatePassword(newPassword);
  if (passwordError !== null) errors.newPassword = passwordError;
  else if (newPassword === currentPassword) errors.newPassword = '新密码不能与当前密码相同';
  const confirmError = validatePasswordConfirm(newPassword, confirm);
  if (confirmError !== null) errors.confirm = confirmError;
  return errors;
}
