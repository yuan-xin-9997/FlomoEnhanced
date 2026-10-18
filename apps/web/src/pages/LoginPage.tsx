/**
 * 登录页（/login）。表单校验 + 提交中禁用 + 直接展示后端中文错误。
 */
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { validatePassword, validateUsername } from '../lib/auth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useSession } from '../state/session';

export default function LoginPage(): JSX.Element {
  useDocumentTitle('登录');
  const { status, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authed') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const usernameError = validateUsername(username);
    if (usernameError !== null) nextErrors.username = usernameError;
    const passwordError = validatePassword(password);
    if (passwordError !== null) nextErrors.password = passwordError;
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <h1 className="auth-title">🖋️ 浮墨增强版</h1>
          <p className="auth-sub">模板记录 · 洞察分析</p>
        </div>

        {submitError !== '' && (
          <div className="error-box mb-16" role="alert">
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <div className="field">
            <label className="label" htmlFor="login-username">
              用户名
            </label>
            <input
              id="login-username"
              className={errors.username === undefined ? 'input' : 'input input-error'}
              value={username}
              autoComplete="username"
              autoFocus
              placeholder="3-32 位字母、数字、_ 或 -"
              disabled={submitting}
              onChange={(event) => setUsername(event.target.value)}
            />
            {errors.username !== undefined && <div className="field-error">{errors.username}</div>}
          </div>

          <div className="field">
            <label className="label" htmlFor="login-password">
              密码
            </label>
            <input
              id="login-password"
              type="password"
              className={errors.password === undefined ? 'input' : 'input input-error'}
              value={password}
              autoComplete="current-password"
              placeholder="至少 8 位"
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
            {errors.password !== undefined && <div className="field-error">{errors.password}</div>}
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="auth-foot">
          还没有账号？<Link to="/register">立即注册</Link>
        </p>
      </div>
    </div>
  );
}
