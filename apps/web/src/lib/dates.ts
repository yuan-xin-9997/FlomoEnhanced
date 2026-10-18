/**
 * 日期与区间换算（纯函数，供洞察页与筛选器使用）。
 * 所有「日」都按浏览器本地时区计算，与后端 FLOMO_TZ 的日边界保持一致语义。
 */

/** 区间快捷按钮标识 */
export type RangePreset = '7d' | '30d' | '6m' | 'custom';

/** 快捷区间描述 */
export interface RangePresetMeta {
  key: RangePreset;
  label: string;
}

/** 洞察页快捷区间按钮（SPEC §8.4 前端要求） */
export const RANGE_PRESETS: RangePresetMeta[] = [
  { key: '7d', label: '最近 7 天' },
  { key: '30d', label: '最近 30 天' },
  { key: '6m', label: '最近 6 个月' },
  { key: 'custom', label: '自定义' },
];

/** 日期区间（`YYYY-MM-DD`，闭区间，本地日） */
export interface DayRange {
  from: string;
  to: string;
}

/** Date → 本地 `YYYY-MM-DD` */
export function toDayKey(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 解析 `YYYY-MM-DD`，非法返回 null */
export function parseDayKey(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return { year, month, day };
}

/** 今天（本地）的 day key */
export function todayKey(now: Date = new Date()): string {
  return toDayKey(now);
}

/** day key 平移 n 天 */
export function addDays(key: string, days: number): string {
  const parsed = parseDayKey(key);
  if (parsed === null) return key;
  return toDayKey(new Date(parsed.year, parsed.month - 1, parsed.day + days));
}

/** day key 平移 n 个自然月（日期溢出时自动回落，如 3-31 → 2-28） */
export function addMonths(key: string, months: number): string {
  const parsed = parseDayKey(key);
  if (parsed === null) return key;
  const target = new Date(parsed.year, parsed.month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toDayKey(new Date(target.getFullYear(), target.getMonth(), Math.min(parsed.day, lastDay)));
}

/** `to - from` 的天数差 */
export function dayDiff(from: string, to: string): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  if (a === null || b === null) return 0;
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000);
}

/** 闭区间天数（含首尾） */
export function inclusiveDays(from: string, to: string): number {
  return Math.max(0, dayDiff(from, to) + 1);
}

/** 本地日 00:00:00.000 对应的 UTC ISO */
export function dayStartIso(key: string): string {
  const parsed = parseDayKey(key);
  if (parsed === null) return '';
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).toISOString();
}

/** 本地日 23:59:59.999 对应的 UTC ISO */
export function dayEndIso(key: string): string {
  const parsed = parseDayKey(key);
  if (parsed === null) return '';
  return new Date(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999).toISOString();
}

/** 区间按快捷按钮换算（`custom` 原样返回） */
export function rangeForPreset(preset: RangePreset, today: string, current?: DayRange): DayRange {
  const safeToday = parseDayKey(today) === null ? todayKey() : today;
  switch (preset) {
    case '7d':
      return { from: addDays(safeToday, -6), to: safeToday };
    case '30d':
      return { from: addDays(safeToday, -29), to: safeToday };
    case '6m':
      return { from: addMonths(safeToday, -6), to: safeToday };
    case 'custom':
    default:
      return current ?? { from: addDays(safeToday, -29), to: safeToday };
  }
}

/** 区间标签：自定义区间输出 `YYYY-MM-DD ~ YYYY-MM-DD` */
export function rangeLabel(preset: RangePreset, range: DayRange): string {
  if (preset === 'custom') return `${range.from} ~ ${range.to}`;
  const meta = RANGE_PRESETS.find((item) => item.key === preset);
  return meta?.label ?? `${range.from} ~ ${range.to}`;
}

/** 校验自定义区间（from ≤ to、且跨度不超过 3660 天） */
export function validateRange(range: DayRange): string | null {
  const from = parseDayKey(range.from);
  const to = parseDayKey(range.to);
  if (from === null || to === null) return '请选择合法的日期区间';
  if (dayDiff(range.from, range.to) < 0) return '开始日期不能晚于结束日期';
  if (inclusiveDays(range.from, range.to) > 3660) return '区间跨度不能超过约 10 年';
  return null;
}

/** 生成 [from, to] 的连续 day key 序列（含首尾，最多 limit 项） */
export function enumerateDays(from: string, to: string, limit = 4000): string[] {
  const days: string[] = [];
  const total = inclusiveDays(from, to);
  if (total <= 0 || total > limit) return days;
  let cursor = from;
  for (let index = 0; index < total; index += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
