/**
 * 时区工具（不使用第三方库，SPEC §4 / ANALYTICS §1）。
 * 全部基于 `Intl.DateTimeFormat`，正确处理夏令时（America/New_York 等）。
 */
import { AppError } from './errors.js';

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** 时区本地时间字段 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 本地日键 `YYYY-MM-DD` */
  dayKey: string;
  /** 本地月键 `YYYY-MM` */
  monthKey: string;
  /** 1 = 周一 … 7 = 周日 */
  weekday: number;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(tz);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw new Error(`无效的时区：${tz}`);
    }
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

/** 校验时区名称是否合法 */
export function assertValidTimeZone(tz: string): void {
  formatterFor(tz);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function assertFiniteEpoch(epochMs: number): void {
  if (!Number.isFinite(epochMs)) {
    throw new AppError('VALIDATION_FAILED', `时间戳非法：${String(epochMs)}`);
  }
}

/** 把 UTC 毫秒拆成指定时区的本地时间字段 */
export function zonedParts(epochMs: number, tz: string): ZonedParts {
  assertFiniteEpoch(epochMs);
  const parts = formatterFor(tz).formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const year = Number(map.year ?? '1970');
  const month = Number(map.month ?? '1');
  const day = Number(map.day ?? '1');
  const hour = Number(map.hour ?? '0') % 24;
  const minute = Number(map.minute ?? '0');
  const second = Number(map.second ?? '0');
  const dayKey = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayKey,
    monthKey: dayKey.slice(0, 7),
    weekday: weekdayOf(dayKey),
  };
}

/** 指定时刻在某时区的 UTC 偏移（毫秒，东区为正） */
export function tzOffsetMs(epochMs: number, tz: string): number {
  assertFiniteEpoch(epochMs);
  const parts = zonedParts(epochMs, tz);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const truncated = Math.floor(epochMs / 1000) * 1000;
  return asUtc - truncated;
}

/** 某时区在某时刻的偏移字符串，如 `+08:00` */
export function tzOffsetString(epochMs: number, tz: string): string {
  const offset = tzOffsetMs(epochMs, tz);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / MS_PER_MINUTE);
  return `${sign}${pad(hours)}:${pad(minutes)}`;
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function wallClockOf(epochMs: number, tz: string): WallClock {
  const parts = zonedParts(epochMs, tz);
  const ms = ((epochMs % 1000) + 1000) % 1000;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: ms,
  };
}

/**
 * 把「某时区的本地墙钟时间」转换为 UTC 毫秒。
 * 双向试算以覆盖夏令时切换（春季跳变取切换后的偏移，秋季重叠取首个匹配）。
 */
export function wallClockToEpoch(clock: WallClock, tz: string): number {
  const utcGuess = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.millisecond,
  );
  const firstOffset = tzOffsetMs(utcGuess, tz);
  const candidate1 = utcGuess - firstOffset;
  if (sameWallClock(wallClockOf(candidate1, tz), clock)) return candidate1;

  const secondOffset = tzOffsetMs(candidate1, tz);
  const candidate2 = utcGuess - secondOffset;
  if (sameWallClock(wallClockOf(candidate2, tz), clock)) return candidate2;

  const thirdOffset = tzOffsetMs(candidate2, tz);
  const candidate3 = utcGuess - thirdOffset;
  if (sameWallClock(wallClockOf(candidate3, tz), clock)) return candidate3;

  // 不存在的本地时间（夏令时跳变区间）：返回切换后的时刻
  return candidate2;
}

/** 本地日键 `YYYY-MM-DD` */
export function localDayKeyOf(epochMs: number, tz: string): string {
  return zonedParts(epochMs, tz).dayKey;
}

/** 本地小时 0..23 */
export function localHourOf(epochMs: number, tz: string): number {
  return zonedParts(epochMs, tz).hour;
}

/** 由 UTC 毫秒生成带偏移的 ISO 字符串，如 `2026-09-19T00:00:00.000+08:00` */
export function toZonedIso(epochMs: number, tz: string): string {
  const parts = zonedParts(epochMs, tz);
  const ms = ((epochMs % 1000) + 1000) % 1000;
  const offset = tzOffsetString(epochMs, tz);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(
    parts.second,
  )}.${pad(ms, 3)}${offset}`;
}

/** 本地时间展示 `YYYY-MM-DD HH:mm:ss` */
export function formatLocalDayTime(epochMsOrIso: number | string, tz: string): string {
  const epochMs = typeof epochMsOrIso === 'number' ? epochMsOrIso : parseIsoToEpochMs(epochMsOrIso, tz);
  const parts = zonedParts(epochMs, tz);
  return `${parts.dayKey} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** 当前时间（UTC ISO） */
export function nowIso(): string {
  return new Date().toISOString();
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PART_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;
const OFFSET_PATTERN = /(?:Z|z|[+-]\d{2}:?\d{2})$/;

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 日键 → 自 1970-01-01 起的天数（纯公历运算，与时区无关） */
export function dayKeyToEpochDay(dayKey: string): number {
  const matched = DAY_KEY_PATTERN.exec(dayKey);
  if (matched === null) throw new AppError('VALIDATION_FAILED', `日期格式非法（应为 YYYY-MM-DD）："${dayKey}"`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!isValidDateParts(year, month, day)) {
    throw new AppError('VALIDATION_FAILED', `日期不存在："${dayKey}"`);
  }
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 自 1970-01-01 起的天数 → 日键 */
export function epochDayToDayKey(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 日键加减天数 */
export function addDaysToDayKey(dayKey: string, days: number): string {
  return epochDayToDayKey(dayKeyToEpochDay(dayKey) + days);
}

/** 日键差值 `a - b`（天） */
export function dayKeyDiff(a: string, b: string): number {
  return dayKeyToEpochDay(a) - dayKeyToEpochDay(b);
}

/** 枚举 `[from, to]` 闭区间的所有日键 */
export function enumerateDayKeys(fromDayKey: string, toDayKey: string): string[] {
  const start = dayKeyToEpochDay(fromDayKey);
  const end = dayKeyToEpochDay(toDayKey);
  const keys: string[] = [];
  if (end < start) return keys;
  for (let day = start; day <= end; day += 1) keys.push(epochDayToDayKey(day));
  return keys;
}

/** 星期（1 = 周一 … 7 = 周日） */
export function weekdayOf(dayKey: string): number {
  const epochDay = dayKeyToEpochDay(dayKey);
  return (((epochDay + 3) % 7) + 7) % 7 + 1;
}

/** 该日所在周的周一 */
export function weekStartDayKey(dayKey: string): string {
  return addDaysToDayKey(dayKey, -(weekdayOf(dayKey) - 1));
}

/** 月键 `YYYY-MM` */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** 该日所在月的第一天 */
export function monthStartDayKey(dayKey: string): string {
  return `${monthKeyOf(dayKey)}-01`;
}

/** 本地日 00:00:00.000 → UTC ISO */
export function localDayStartUtcIso(dayKey: string, tz: string): string {
  const [year, month, day] = splitDayKey(dayKey);
  return new Date(wallClockToEpoch({ year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 }, tz)).toISOString();
}

/** 本地日 23:59:59.999 → UTC ISO */
export function localDayEndUtcIso(dayKey: string, tz: string): string {
  const [year, month, day] = splitDayKey(dayKey);
  return new Date(
    wallClockToEpoch({ year, month, day, hour: 23, minute: 59, second: 59, millisecond: 999 }, tz),
  ).toISOString();
}

function splitDayKey(dayKey: string): [number, number, number] {
  const matched = DAY_KEY_PATTERN.exec(dayKey);
  if (matched === null) throw new AppError('VALIDATION_FAILED', `日期格式非法（应为 YYYY-MM-DD）："${dayKey}"`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!isValidDateParts(year, month, day)) {
    throw new AppError('VALIDATION_FAILED', `日期不存在："${dayKey}"`);
  }
  return [year, month, day];
}

function parseWithOffset(input: string): number | null {
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 把本地语义的时间输入解释为 `tz` 时区并转成 UTC ISO。
 * 支持：`2026-09-19`、`2026-09-19T08:00:00`、`2026-09-19 08:00`、`2026-09-19T08:00:00+08:00`、`...Z`。
 */
export function parseIsoWithTzOffsetToUtcIso(input: string, tz: string): string {
  return new Date(parseIsoToEpochMs(input, tz)).toISOString();
}

/** 同 `parseIsoWithTzOffsetToUtcIso`，但返回 UTC 毫秒 */
export function parseIsoToEpochMs(input: string, tz: string): number {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new AppError('VALIDATION_FAILED', '时间不能为空');
  }
  const value = input.trim();

  if (OFFSET_PATTERN.test(value)) {
    const parsed = parseWithOffset(value);
    if (parsed === null) throw new AppError('VALIDATION_FAILED', `时间格式非法："${input}"`);
    return parsed;
  }

  const matched = TIME_PART_PATTERN.exec(value);
  if (matched === null) throw new AppError('VALIDATION_FAILED', `时间格式非法："${input}"`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!isValidDateParts(year, month, day)) {
    throw new AppError('VALIDATION_FAILED', `日期不存在："${input}"`);
  }
  const hour = matched[4] === undefined ? 0 : Number(matched[4]);
  const minute = matched[5] === undefined ? 0 : Number(matched[5]);
  const second = matched[6] === undefined ? 0 : Number(matched[6]);
  const millisecond = matched[7] === undefined ? 0 : Number(matched[7].padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) {
    throw new AppError('VALIDATION_FAILED', `时间格式非法："${input}"`);
  }
  return wallClockToEpoch({ year, month, day, hour, minute, second, millisecond }, tz);
}

/** 把 ISO（或本地输入）转换成该时区的日键 */
export function dayKeyOfIso(iso: string, tz: string): string {
  return localDayKeyOf(parseIsoToEpochMs(iso, tz), tz);
}

/** 区间归一化输入 */
export interface NormalizeRangeInput {
  from?: string | null;
  to?: string | null;
  tz: string;
  /** 参考「现在」，默认当前时刻 */
  now?: number | string | Date;
}

/** 区间归一化结果（全部为 UTC ISO，可直接用于 SQL 比较） */
export interface NormalizedRange {
  fromIso: string;
  toIso: string;
  fromDayKey: string;
  toDayKey: string;
  /** 闭区间天数 */
  days: number;
  /** 中文可读标签 */
  label: string;
}

/** 最大跨度（约 10 年，SPEC §8.4） */
export const MAX_RANGE_DAYS = 3660;

/** 默认区间天数 */
export const DEFAULT_RANGE_DAYS = 30;

function nowEpoch(now: NormalizeRangeInput['now']): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return parseIsoToEpochMs(now, 'UTC');
}

/**
 * 归一化查询区间（ANALYTICS §1）：
 * `from` 取当日本地 00:00:00.000、`to` 取当日本地 23:59:59.999，均为闭区间。
 * 默认最近 30 天；`from > to` → 422；跨度 > 3660 天 → 422。
 */
export function normalizeRange(input: NormalizeRangeInput): NormalizedRange {
  const tz = input.tz;
  const nowMs = nowEpoch(input.now);

  let toEpochMs: number;
  if (input.to === undefined || input.to === null || input.to === '') {
    toEpochMs = nowMs;
  } else {
    toEpochMs = parseIsoToEpochMs(input.to, tz);
  }
  const toDayKey = localDayKeyOf(toEpochMs, tz);

  let fromDayKey: string;
  if (input.from === undefined || input.from === null || input.from === '') {
    fromDayKey = addDaysToDayKey(toDayKey, -(DEFAULT_RANGE_DAYS - 1));
  } else {
    fromDayKey = localDayKeyOf(parseIsoToEpochMs(input.from, tz), tz);
  }

  const days = dayKeyDiff(toDayKey, fromDayKey) + 1;
  if (days <= 0) {
    throw new AppError('VALIDATION_FAILED', '开始日期不能晚于结束日期');
  }
  if (days > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', `时间跨度不能超过 ${MAX_RANGE_DAYS} 天（约 10 年）`);
  }

  const todayKey = localDayKeyOf(nowMs, tz);
  const label = toDayKey === todayKey ? `最近 ${days} 天` : `${fromDayKey} ~ ${toDayKey}`;

  return {
    fromIso: localDayStartUtcIso(fromDayKey, tz),
    toIso: localDayEndUtcIso(toDayKey, tz),
    fromDayKey,
    toDayKey,
    days,
    label,
  };
}
