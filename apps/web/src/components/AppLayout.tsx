/**
 * 应用外壳：左侧栏（品牌、用户、统计、热力图、导航、标签）+ 右侧内容区。
 * 桌面端参照 flomo：浅灰底、白色内容卡、品牌绿点缀。
 */
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Icon from './icons';
import type { IconName } from './icons';
import Heatmap from './Heatmap';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { useOverview } from '../state/overview';
import { errorMessage } from '../api/client';
import { formatCount } from '../lib/format';

const NAV_ITEMS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: '记录', icon: 'pen' },
  { to: '/templates', label: '模板', icon: 'grid' },
  { to: '/insights', label: '洞察', icon: 'chart' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

/** 侧栏最多展示的标签数 */
const SIDEBAR_TAG_LIMIT = 24;

export default function AppLayout(): JSX.Element {
  const { user, logout } = useSession();
  const overview = useOverview();
  const toast = useToast();
  const navigate = useNavigate();

  const onLogout = async (): Promise<void> => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const summary = overview.data?.summary;
  const heatmapDays = overview.data?.heatmap.days ?? [];
  const tags = overview.tags.slice(0, SIDEBAR_TAG_LIMIT);

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="side-brand">
          <img className="side-logo" src="/favicon.png" alt="" width={22} height={22} />
          <span>浮墨增强版</span>
        </Link>

        <div className="side-user">
          <span className="avatar" aria-hidden="true">
            {user?.username.slice(0, 1).toUpperCase() ?? '?'}
          </span>
          <div className="side-user-info">
            <div className="side-user-name truncate">{user?.username ?? '未登录'}</div>
            <div className="side-user-meta">
              {user === null ? '' : `注册于 ${user.createdAt.slice(0, 10)}`}
            </div>
          </div>
        </div>

        <div className="side-stats">
          <div className="side-stat">
            <b>{summary === undefined ? '—' : formatCount(summary.memoCount)}</b>
            <span>笔记</span>
          </div>
          <div className="side-stat">
            <b>{summary === undefined ? '—' : formatCount(summary.templateCount)}</b>
            <span>模板</span>
          </div>
          <div className="side-stat">
            <b>{summary === undefined ? '—' : formatCount(summary.activeDays)}</b>
            <span>活跃天</span>
          </div>
        </div>

        <div className="side-heatmap">
          {overview.error !== '' ? (
            <p className="side-error">{overview.error}</p>
          ) : (
            <Heatmap
              days={heatmapDays}
              weeks={14}
              size={10}
              onSelectDay={(day) => navigate({ pathname: '/', search: `?from=${day}&to=${day}` })}
            />
          )}
        </div>

        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'side-nav-link active' : 'side-nav-link')}
            >
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {tags.length > 0 && (
          <div className="side-section">
            <div className="side-section-title">全部标签</div>
            <div className="side-tags">
              {tags.map((tag) => (
                <Link
                  key={tag.tag}
                  className="side-tag"
                  to={{ pathname: '/', search: `?tag=${encodeURIComponent(tag.tag)}` }}
                  title={`#${tag.tag} · ${tag.count} 条`}
                >
                  <Icon name="hash" size={13} />
                  <span className="truncate">{tag.tag}</span>
                  <span className="side-tag-count">{formatCount(tag.count)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="side-foot">
          <button type="button" className="side-foot-btn" onClick={() => void onLogout()}>
            <Icon name="logout" size={15} />
            退出登录
          </button>
        </div>
      </aside>

      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}
