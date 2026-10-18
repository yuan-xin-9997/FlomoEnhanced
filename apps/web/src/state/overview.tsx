/**
 * 侧边栏概览数据（全局共享）：统计数字、热力图、标签列表。
 *
 * 数据源：`GET /api/analytics/overview`（区间取「全部」——`from` 取十年前，
 * 十年以上的账号会被后端 3660 天上限截断，属预期）。
 * 任何页面写入数据后调用 `reload()` 即可刷新侧边栏。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { analyticsApi, errorMessage } from '../api/client';
import type { AnalyticsOverview, TagStat } from '../lib/analyticsTypes';
import { addDays, todayKey } from '../lib/dates';
import { useSession } from './session';

/** 后端区间上限约 10 年，取 3650 天作为「全部」 */
const ALL_RANGE_DAYS = 3650;

export interface OverviewValue {
  /** 全部想法的聚合结果（未加载完成时为 null） */
  data: AnalyticsOverview | null;
  /** 标签按出现次数倒序（`data.tags` 的稳定副本） */
  tags: TagStat[];
  loading: boolean;
  /** 中文错误信息，空串表示无错误 */
  error: string;
  reload: () => Promise<void>;
}

const OverviewContext = createContext<OverviewValue | null>(null);

export function OverviewProvider({ children }: { children: ReactNode }): JSX.Element {
  const session = useSession();
  const authed = session.status === 'authed';
  const userId = session.user?.id ?? '';
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setError('');
    try {
      const from = addDays(todayKey(), -(ALL_RANGE_DAYS - 1));
      const response = await analyticsApi.overview({ from });
      if (seq !== seqRef.current) return;
      setData(response);
    } catch (caught) {
      if (seq !== seqRef.current) return;
      setError(errorMessage(caught));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
  }, [authed, userId, reload]);

  const tags = useMemo<TagStat[]>(
    () => [...(data?.tags ?? [])].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    [data],
  );

  const value = useMemo<OverviewValue>(
    () => ({ data, tags, loading, error, reload }),
    [data, tags, loading, error, reload],
  );

  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}

/** 读取侧边栏概览数据（必须在 OverviewProvider 内使用） */
export function useOverview(): OverviewValue {
  const value = useContext(OverviewContext);
  if (value === null) throw new Error('useOverview 必须在 OverviewProvider 内部使用');
  return value;
}
