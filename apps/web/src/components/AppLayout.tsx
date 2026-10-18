/**
 * 应用外壳：顶部导航（记录 / 模板 / 洞察 / 设置）+ 当前用户菜单。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { errorMessage } from '../api/client';

const NAV_ITEMS = [
  { to: '/', label: '记录' },
  { to: '/templates', label: '模板' },
  { to: '/insights', label: '洞察' },
  { to: '/settings', label: '设置' },
];

export default function AppLayout(): JSX.Element {
  const { user, logout } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const onLogout = async (): Promise<void> => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-logo" aria-hidden="true">
              🖋️
            </span>
            浮墨增强版
          </Link>
          <nav className="nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="user-area" ref={menuRef}>
            <button
              type="button"
              className="user-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="avatar" aria-hidden="true">
                {user?.username.slice(0, 1).toUpperCase() ?? '?'}
              </span>
              <span className="username">{user?.username ?? '未登录'}</span>
            </button>
            {menuOpen && (
              <div className="dropdown" role="menu">
                <div className="dropdown-meta">
                  {user === null ? '未登录' : `${user.username} · 注册于 ${user.createdAt.slice(0, 10)}`}
                </div>
                <Link to="/settings" className="dropdown-item" role="menuitem" onClick={() => setMenuOpen(false)}>
                  账号设置
                </Link>
                <button type="button" className="dropdown-item danger" role="menuitem" onClick={() => void onLogout()}>
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
