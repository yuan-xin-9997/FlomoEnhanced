/**
 * 设置页（/settings）：账号信息、修改密码、数据统计、退出登录。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, errorMessage, memosApi, templatesApi } from '../api/client';
import { ErrorBox, Kpi, Loading } from '../components/ui';
import { validatePasswordChange } from '../lib/auth';
import { formatCount, formatDateTime, formatRelativeTime } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';

export default function SettingsPage(): JSX.Element {
  useDocumentTitle('设置');
  const { user, logout } = useSession();
  const toast = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState<{ templates: number; archived: number; memos: number } | null>(null);
  const [statsError, setStatsError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    setStatsError('');
    try {
      const [templates, summary] = await Promise.all([templatesApi.list(true), memosApi.summary()]);
      setStats({
        templates: templates.items.filter((item) => item.archivedAt === null).length,
        archived: templates.items.filter((item) => item.archivedAt !== null).length,
        memos: summary.total,
      });
    } catch (error) {
      setStatsError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const onChangePassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextErrors = validatePasswordChange(currentPassword, newPassword, confirm);
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('密码已修改，其它设备上的登录已失效');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const onLogout = async (): Promise<void> => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">账号信息、数据统计与安全设置</p>
        </div>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => void onLogout()}>
          退出登录
        </button>
      </div>

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-title">账号信息</div>
            <div className="memo-values">
              <table>
                <tbody>
                  <tr>
                    <th scope="row">用户名</th>
                    <td>{user?.username ?? '未登录'}</td>
                  </tr>
                  <tr>
                    <th scope="row">注册时间</th>
                    <td title={user?.createdAt}>
                      {user === null ? '—' : `${formatDateTime(user.createdAt)}（${formatRelativeTime(user.createdAt)}）`}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">用户 ID</th>
                    <td className="mono small">{user?.id ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <span>数据统计</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadStats()}>
                刷新
              </button>
            </div>
            {statsError !== '' && <ErrorBox message={statsError} onRetry={() => void loadStats()} />}
            {stats === null && statsError === '' && <Loading />}
            {stats !== null && (
              <div className="kpi-grid">
                <Kpi label="我的模板" value={formatCount(stats.templates)} sub={`归档 ${stats.archived} 个`} />
                <Kpi label="我的想法" value={formatCount(stats.memos)} />
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">修改密码</div>

          {submitError !== '' && (
            <div className="error-box mb-16" role="alert">
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={(event) => void onChangePassword(event)} noValidate>
            <div className="field">
              <label className="label" htmlFor="current-password">
                当前密码
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                className={errors.currentPassword === undefined ? 'input' : 'input input-error'}
                value={currentPassword}
                disabled={submitting}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              {errors.currentPassword !== undefined && <div className="field-error">{errors.currentPassword}</div>}
            </div>

            <div className="field">
              <label className="label" htmlFor="new-password">
                新密码
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className={errors.newPassword === undefined ? 'input' : 'input input-error'}
                value={newPassword}
                placeholder="至少 8 位"
                disabled={submitting}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              {errors.newPassword !== undefined && <div className="field-error">{errors.newPassword}</div>}
            </div>

            <div className="field">
              <label className="label" htmlFor="confirm-password">
                确认新密码
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                className={errors.confirm === undefined ? 'input' : 'input input-error'}
                value={confirm}
                disabled={submitting}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {errors.confirm !== undefined && <div className="field-error">{errors.confirm}</div>}
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? '提交中…' : '修改密码'}
            </button>
            <div className="field-help">修改成功后，该账号在其它设备上的登录会话会被吊销。</div>
          </form>
        </div>
      </div>
    </div>
  );
}
