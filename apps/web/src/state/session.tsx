/**
 * 会话状态（Context + useSession）。
 * 启动时 `GET /api/auth/me`；401 由 API 客户端通过全局回调通知本模块。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@flomo/shared';
import { authApi, setUnauthenticatedHandler } from '../api/client';

export type SessionStatus = 'loading' | 'authed' | 'anon';

export interface SessionValue {
  status: SessionStatus;
  user: User | null;
  /** 重新拉取当前用户 */
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await authApi.me();
      if (!mounted.current) return;
      setUser(response.user);
      setStatus('authed');
    } catch {
      if (!mounted.current) return;
      setUser(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // 任何请求返回 401 时立刻切到未登录态（路由守卫会跳转 /login）
    setUnauthenticatedHandler(() => {
      setUser(null);
      setStatus('anon');
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const response = await authApi.login(username, password);
    setUser(response.user);
    setStatus('authed');
  }, []);

  const register = useCallback(async (username: string, password: string): Promise<void> => {
    // 注册成功即自动登录（服务端同时下发 Cookie）
    const response = await authApi.register(username, password);
    setUser(response.user);
    setStatus('authed');
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('anon');
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, user, refresh, login, register, logout }),
    [status, user, refresh, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** 读取会话状态（必须在 SessionProvider 内使用） */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession 必须在 SessionProvider 内部使用');
  return value;
}
