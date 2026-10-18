/**
 * 注册页（/register）。注册成功由后端下发 Cookie，前端直接进入首页。
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { validatePassword, validatePasswordConfirm, validateUsername } from '../lib/auth';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useSession } from '../state/session';

export default function RegisterPage(): JSX.Element {
  useDocumentTitle('注册');
  const { status, register } = useSession();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authed') return <Navigate to="/" replace />;

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const usernameError = validateUsername(username);
    if (usernameError !== null) nextErrors.username = usernameError;
    const passwordError = validatePassword(password);
    if (passwordError !== null) nextErrors.password = passwordError;
    const confirmError = validatePasswordConfirm(password, confirm);
    if (confirmError !== null) nextErrors.confirm = confirmError;
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await register(username.trim(), password);
      navigate('/', { replace: true });
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
          <img className="auth-logo" src="/favicon.png" alt="" width={44} height={44} />
          <h1 className="auth-title">创建账号</h1>
          <p className="auth-sub">你的想法与模板只对你可见</p>
        </div>

        {submitError !== '' && (
          <div className="error-box mb-16" role="alert">
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <div className="field">
            <label className="label" htmlFor="register-username">
              用户名
            </label>
            <input
              id="register-username"
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
            <label className="label" htmlFor="register-password">
              密码
            </label>
            <input
              id="register-password"
              type="password"
              className={errors.password === undefined ? 'input' : 'input input-error'}
              value={password}
              autoComplete="new-password"
              placeholder="至少 8 位"
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
            {errors.password !== undefined && <div className="field-error">{errors.password}</div>}
          </div>

          <div className="field">
            <label className="label" htmlFor="register-confirm">
              确认密码
            </label>
            <input
              id="register-confirm"
              type="password"
              className={errors.confirm === undefined ? 'input' : 'input input-error'}
              value={confirm}
              autoComplete="new-password"
              placeholder="再次输入密码"
              disabled={submitting}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {errors.confirm !== undefined && <div className="field-error">{errors.confirm}</div>}
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '注册中…' : '注册并进入'}
          </button>
        </form>

        <p className="auth-foot">
          已有账号？<Link to="/login">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
