/**
 * GitHub 风格热力图网格（最近 N 周，5 档颜色）。
 * 输入来自 `GET /api/memos/summary` 或 `/api/analytics/*` 的 `heatmap.days`。
 */
import { addDays, dayDiff, parseDayKey, todayKey } from './dates';

/** 热力档位：0 = 无记录，4 = 最活跃 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** 单个格子 */
export interface HeatmapCell {
  /** `YYYY-MM-DD` */
  date: string;
  count: number;
  level: HeatLevel;
  /** 鼠标悬浮提示：`日期 · N 条` */
  title: string;
  /** 是否落在 [start, today] 内（未来日期为 false，不渲染） */
  inGrid: boolean;
}

/** 网格结果（列 = 周，行 = 周一…周日） */
export interface HeatmapGrid {
  /** 每列 7 个格子（周一 → 周日） */
  weeks: HeatmapCell[][];
  /** 每天最大计数 */
  max: number;
  /** 区间内总条数 */
  total: number;
  /** 有记录的天数 */
  activeDays: number;
  /** 月份标签（列索引） */
  monthLabels: Array<{ column: number; label: string }>;
  /** 网格首日 */
  start: string;
  /** 网格末日（今天） */
  end: string;
}

/** 计数 → 颜色档位 */
export function heatLevel(count: number, max: number): HeatLevel {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** 该日期所在周的周一 */
export function startOfWeekMonday(key: string): string {
  const parsed = parseDayKey(key);
  if (parsed === null) return key;
  const weekday = new Date(parsed.year, parsed.month - 1, parsed.day).getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(key, offset);
}

/**
 * 构建最近 `weeks` 周的热力图网格。
 * @param days 后端返回的 `{date, count}` 列表（顺序无关，可缺失日期）
 */
export function buildHeatmapGrid(
  days: ReadonlyArray<{ date: string; count: number }>,
  options: { weeks?: number; today?: string } = {},
): HeatmapGrid {
  const weeks = Math.max(1, options.weeks ?? 12);
  const today = options.today !== undefined && parseDayKey(options.today) !== null ? options.today : todayKey();
  const lastMonday = startOfWeekMonday(today);
  const start = addDays(lastMonday, -7 * (weeks - 1));

  const counts = new Map<string, number>();
  let rawMax = 0;
  for (const item of days) {
    if (typeof item?.date !== 'string' || parseDayKey(item.date) === null) continue;
    const count = Number.isFinite(item.count) ? Math.max(0, Math.trunc(item.count)) : 0;
    counts.set(item.date, (counts.get(item.date) ?? 0) + count);
    if (count > rawMax) rawMax = count;
  }

  const grid: HeatmapCell[][] = [];
  const monthLabels: Array<{ column: number; label: string }> = [];
  let total = 0;
  let activeDays = 0;
  let previousMonth = '';

  for (let column = 0; column < weeks; column += 1) {
    const columnCells: HeatmapCell[] = [];
    const columnStart = addDays(start, column * 7);
    const parsedStart = parseDayKey(columnStart);
    if (parsedStart !== null) {
      const monthKey = `${parsedStart.year}-${String(parsedStart.month).padStart(2, '0')}`;
      if (monthKey !== previousMonth) {
        monthLabels.push({ column, label: `${parsedStart.month}月` });
        previousMonth = monthKey;
      }
    }
    for (let row = 0; row < 7; row += 1) {
      const date = addDays(columnStart, row);
      // dayDiff(a, b) = b - a，因此 date 在今天或更早（dayDiff >= 0）才落在网格内
      const inGrid = dayDiff(date, today) >= 0;
      const count = inGrid ? counts.get(date) ?? 0 : 0;
      if (inGrid) {
        total += count;
        if (count > 0) activeDays += 1;
      }
      columnCells.push({
        date,
        count,
        level: inGrid ? heatLevel(count, rawMax) : 0,
        title: `${date} · ${count} 条`,
        inGrid,
      });
    }
    grid.push(columnCells);
  }

  return {
    weeks: grid,
    max: Math.max(1, rawMax),
    total,
    activeDays,
    monthLabels,
    start,
    end: today,
  };
}
