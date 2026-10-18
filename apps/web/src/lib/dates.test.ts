import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayDiff,
  dayEndIso,
  dayStartIso,
  enumerateDays,
  inclusiveDays,
  parseDayKey,
  rangeForPreset,
  rangeLabel,
  toDayKey,
  validateRange,
} from './dates';

describe('day key 基础运算', () => {
  it('addDays / dayDiff / inclusiveDays', () => {
    expect(addDays('2026-10-18', -6)).toBe('2026-10-12');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayDiff('2026-10-12', '2026-10-18')).toBe(6);
    expect(dayDiff('2026-10-18', '2026-10-12')).toBe(-6);
    expect(inclusiveDays('2026-09-19', '2026-10-18')).toBe(30);
  });

  it('addMonths 处理日期溢出', () => {
    expect(addMonths('2026-10-18', -6)).toBe('2026-04-18');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('parseDayKey 拒绝非法日期', () => {
    expect(parseDayKey('2026-02-30')).toBeNull();
    expect(parseDayKey('2026/10/18')).toBeNull();
    expect(parseDayKey('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(toDayKey(new Date(2026, 9, 18))).toBe('2026-10-18');
  });

  it('enumerateDays 生成闭区间序列', () => {
    expect(enumerateDays('2026-10-16', '2026-10-18')).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    expect(enumerateDays('2026-10-18', '2026-10-01')).toEqual([]);
  });
});

describe('快捷区间换算', () => {
  it('最近 7 天 / 30 天 / 6 个月', () => {
    expect(rangeForPreset('7d', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(rangeForPreset('30d', '2026-10-18')).toEqual({ from: '2026-09-19', to: '2026-10-18' });
    expect(rangeForPreset('6m', '2026-10-18')).toEqual({ from: '2026-04-18', to: '2026-10-18' });
  });

  it('自定义区间原样保留', () => {
    const current = { from: '2026-01-01', to: '2026-02-01' };
    expect(rangeForPreset('custom', '2026-10-18', current)).toEqual(current);
    expect(rangeForPreset('custom', '2026-10-18')).toEqual({ from: '2026-09-19', to: '2026-10-18' });
  });

  it('区间标签', () => {
    expect(rangeLabel('30d', { from: '2026-09-19', to: '2026-10-18' })).toBe('最近 30 天');
    expect(rangeLabel('6m', { from: '2026-04-18', to: '2026-10-18' })).toBe('最近 6 个月');
    expect(rangeLabel('custom', { from: '2026-04-18', to: '2026-10-18' })).toBe('2026-04-18 ~ 2026-10-18');
  });

  it('区间校验：倒置与超长跨度', () => {
    expect(validateRange({ from: '2026-01-01', to: '2026-02-01' })).toBeNull();
    expect(validateRange({ from: '2026-02-01', to: '2026-01-01' })).toBe('开始日期不能晚于结束日期');
    expect(validateRange({ from: '2000-01-01', to: '2026-01-01' })).toBe('区间跨度不能超过约 10 年');
    expect(validateRange({ from: '', to: '2026-01-01' })).toBe('请选择合法的日期区间');
  });
});

describe('日边界 ISO', () => {
  it('本地 00:00 / 23:59:59.999 转 UTC ISO', () => {
    expect(dayStartIso('2026-10-18')).toBe(new Date(2026, 9, 18, 0, 0, 0, 0).toISOString());
    expect(dayEndIso('2026-10-18')).toBe(new Date(2026, 9, 18, 23, 59, 59, 999).toISOString());
    expect(dayStartIso('非法')).toBe('');
  });
});
