/**
 * 应用根组件：路由表 + 登录守卫。
 * 未登录只能访问 /login 与 /register。
 * 洞察 / 模板页按需加载，避免首页承载 ECharts 体积。
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppLayout from './components/AppLayout';
import { Loading } from './components/ui';
import LoginPage from './pages/LoginPage';
import MemoPage from './pages/MemoPage';
import NotFoundPage from './pages/NotFoundPage';
import RegisterPage from './pages/RegisterPage';
import SettingsPage from './pages/SettingsPage';
import { useSession } from './state/session';

const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'));

/** 路由守卫：会话检查中显示加载态，未登录跳转登录页并记住来源 */
function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="page">
        <Loading text="正在检查登录状态…" />
      </div>
    );
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}

export default function App(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Loading />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<MemoPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
