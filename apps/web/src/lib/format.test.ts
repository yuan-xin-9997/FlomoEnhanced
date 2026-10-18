import { describe, expect, it } from 'vitest';
import { formatCount, formatDateTime, formatNumber, formatRatio, formatRelativeTime, formatShortDay, safeFileName } from './format';

describe('formatNumber', () => {
  it('千分位与小数位', () => {
    expect(formatNumber(1234.5, 2)).toBe('1,234.50');
    expect(formatNumber(0, 0)).toBe('0');
    expect(formatNumber(3.14159, 3)).toBe('3.142');
  });

  it('空值返回空字符串', () => {
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(undefined)).toBe('');
    expect(formatNumber(Number.NaN)).toBe('');
  });
});

describe('formatRatio', () => {
  it('0..1 比率转百分数', () => {
    expect(formatRatio(0.3066, 1)).toBe('30.7%');
    expect(formatRatio(1, 0)).toBe('100%');
    expect(formatRatio(null)).toBe('');
  });
});

describe('formatCount / formatShortDay', () => {
  it('计数与短日期', () => {
    expect(formatCount(12_345)).toBe('12,345');
    expect(formatCount(null)).toBe('0');
    expect(formatShortDay('2026-10-18')).toBe('10-18');
    expect(formatShortDay('非法')).toBe('非法');
  });
});

describe('formatDateTime', () => {
  it('输出本地 YYYY-MM-DD HH:mm', () => {
    const iso = new Date(2026, 9, 18, 8, 5).toISOString();
    expect(formatDateTime(iso)).toBe('2026-10-18 08:05');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('不是时间')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  it('按时间差返回中文相对时间', () => {
    const base = Date.parse('2026-10-18T12:00:00.000Z');
    expect(formatRelativeTime('2026-10-18T11:59:30.000Z', base)).toBe('刚刚');
    expect(formatRelativeTime('2026-10-18T11:30:00.000Z', base)).toBe('30 分钟前');
    expect(formatRelativeTime('2026-10-18T09:00:00.000Z', base)).toBe('3 小时前');
    expect(formatRelativeTime('2026-10-15T12:00:00.000Z', base)).toBe('3 天前');
  });
});

describe('safeFileName', () => {
  it('替换非法字符并回退默认名', () => {
    expect(safeFileName('每日开销 2026/10')).toBe('每日开销_2026_10');
    expect(safeFileName('   ')).toBe('flomo');
    expect(safeFileName('a:b*c?')).toBe('a_b_c_');
  });
});
