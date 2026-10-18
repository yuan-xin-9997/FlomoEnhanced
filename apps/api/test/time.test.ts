import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../src/lib/errors.js';
import {
  addDaysToDayKey,
  dayKeyDiff,
  dayKeyOfIso,
  enumerateDayKeys,
  formatLocalDayTime,
  localDayEndUtcIso,
  localDayKeyOf,
  localDayStartUtcIso,
  localHourOf,
  monthKeyOf,
  normalizeRange,
  parseIsoWithTzOffsetToUtcIso,
  toZonedIso,
  tzOffsetString,
  weekdayOf,
  weekStartDayKey,
  zonedParts,
} from '../src/lib/time.js';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';
const NOW = '2026-10-18T12:00:00.000Z'; // 上海本地 2026-10-18 20:00

describe('日边界转换', () => {
  it('Asia/Shanghai：本地日边界 → UTC ISO', () => {
    assert.equal(localDayStartUtcIso('2026-09-19', SH), '2026-09-18T16:00:00.000Z');
    assert.equal(localDayEndUtcIso('2026-09-19', SH), '2026-09-19T15:59:59.999Z');
    assert.equal(localDayStartUtcIso('2026-10-18', SH), '2026-10-17T16:00:00.000Z');
    assert.equal(localDayEndUtcIso('2026-10-18', SH), '2026-10-18T15:59:59.999Z');
  });

  it('UTC：本地日即 UTC 日', () => {
    assert.equal(localDayStartUtcIso('2026-09-19', 'UTC'), '2026-09-19T00:00:00.000Z');
    assert.equal(localDayEndUtcIso('2026-09-19', 'UTC'), '2026-09-19T23:59:59.999Z');
  });

  it('America/New_York：夏令时切换日的边界正确', () => {
    // 2026-03-08 02:00 进入夏令时（EST -5 → EDT -4）
    assert.equal(localDayStartUtcIso('2026-03-08', NY), '2026-03-08T05:00:00.000Z');
    assert.equal(localDayEndUtcIso('2026-03-08', NY), '2026-03-09T03:59:59.999Z');
    assert.equal(localDayStartUtcIso('2026-03-09', NY), '2026-03-09T04:00:00.000Z');
    assert.equal(localDayStartUtcIso('2026-03-07', NY), '2026-03-07T05:00:00.000Z');
    // 2026-11-01 02:00 退回标准时（EDT -4 → EST -5），该日有 25 小时
    assert.equal(localDayStartUtcIso('2026-11-01', NY), '2026-11-01T04:00:00.000Z');
    assert.equal(localDayEndUtcIso('2026-11-01', NY), '2026-11-02T04:59:59.999Z');
    assert.equal(localDayStartUtcIso('2026-11-02', NY), '2026-11-02T05:00:00.000Z');
  });

  it('夏令时切换日的本地日长分别为 23 / 25 小时', () => {
    const shortDay =
      Date.parse(localDayEndUtcIso('2026-03-08', NY)) - Date.parse(localDayStartUtcIso('2026-03-08', NY)) + 1;
    const longDay =
      Date.parse(localDayEndUtcIso('2026-11-01', NY)) - Date.parse(localDayStartUtcIso('2026-11-01', NY)) + 1;
    assert.equal(shortDay, 23 * 3600 * 1000);
    assert.equal(longDay, 25 * 3600 * 1000);
  });

  it('本地输入解释为指定时区', () => {
    assert.equal(parseIsoWithTzOffsetToUtcIso('2026-09-19', SH), '2026-09-18T16:00:00.000Z');
    assert.equal(parseIsoWithTzOffsetToUtcIso('2026-09-19T08:00:00', SH), '2026-09-19T00:00:00.000Z');
    assert.equal(parseIsoWithTzOffsetToUtcIso('2026-09-19 08:30', SH), '2026-09-19T00:30:00.000Z');
    assert.equal(parseIsoWithTzOffsetToUtcIso('2026-09-19T08:00:00+08:00', SH), '2026-09-19T00:00:00.000Z');
    assert.equal(parseIsoWithTzOffsetToUtcIso('2026-09-19T00:00:00Z', NY), '2026-09-19T00:00:00.000Z');
  });
});

describe('日键运算', () => {
  it('dayKeyOfIso 按本地日划分', () => {
    assert.equal(dayKeyOfIso('2026-09-18T16:30:00.000Z', SH), '2026-09-19');
    assert.equal(dayKeyOfIso('2026-09-18T15:30:00.000Z', SH), '2026-09-18');
    assert.equal(dayKeyOfIso('2026-09-18T23:30:00.000Z', NY), '2026-09-18');
    assert.equal(dayKeyOfIso('2026-09-19T03:30:00.000Z', NY), '2026-09-18');
    assert.equal(dayKeyOfIso('2026-09-19T04:30:00.000Z', NY), '2026-09-19');
  });

  it('addDaysToDayKey / dayKeyDiff 跨月跨年', () => {
    assert.equal(addDaysToDayKey('2026-09-30', 1), '2026-10-01');
    assert.equal(addDaysToDayKey('2026-03-01', -1), '2026-02-28');
    assert.equal(addDaysToDayKey('2028-02-28', 1), '2028-02-29');
    assert.equal(addDaysToDayKey('2026-12-31', 1), '2027-01-01');
    assert.equal(dayKeyDiff('2026-10-18', '2026-09-19'), 29);
    assert.equal(dayKeyDiff('2026-09-19', '2026-10-18'), -29);
  });

  it('enumerateDayKeys 跨月补全', () => {
    assert.deepEqual(enumerateDayKeys('2026-09-29', '2026-10-02'), [
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    assert.equal(enumerateDayKeys('2026-09-19', '2026-10-18').length, 30);
    assert.deepEqual(enumerateDayKeys('2026-10-02', '2026-10-01'), []);
  });

  it('weekdayOf 1=周一..7=周日，weekStartDayKey 取周一', () => {
    assert.equal(weekdayOf('1970-01-01'), 4); // 周四
    assert.equal(weekdayOf('2026-01-01'), 4); // 周四
    assert.equal(weekdayOf('2026-10-18'), 7); // 周日
    assert.equal(weekdayOf('2026-10-19'), 1); // 周一
    assert.equal(weekStartDayKey('2026-10-18'), '2026-10-12');
    assert.equal(weekStartDayKey('2026-10-19'), '2026-10-19');
    assert.equal(weekdayOf(weekStartDayKey('2026-10-25')), 1);
  });

  it('monthKeyOf', () => {
    assert.equal(monthKeyOf('2026-10-18'), '2026-10');
    assert.equal(monthKeyOf('2026-01-01'), '2026-01');
  });
});

describe('zonedParts / 本地展示', () => {
  it('拆分本地字段', () => {
    const parts = zonedParts(Date.parse('2026-09-18T16:30:45.000Z'), SH);
    assert.equal(parts.dayKey, '2026-09-19');
    assert.equal(parts.hour, 0);
    assert.equal(parts.minute, 30);
    assert.equal(parts.second, 45);
    assert.equal(parts.weekday, 6); // 2026-09-19 是周六
    assert.equal(parts.monthKey, '2026-09');
  });

  it('localDayKeyOf / localHourOf / formatLocalDayTime', () => {
    const instant = Date.parse('2026-09-18T16:30:45.000Z');
    assert.equal(localDayKeyOf(instant, SH), '2026-09-19');
    assert.equal(localHourOf(instant, SH), 0);
    assert.equal(localHourOf(instant, NY), 12);
    assert.equal(formatLocalDayTime(instant, SH), '2026-09-19 00:30:45');
    assert.equal(formatLocalDayTime('2026-09-18T16:30:45.000Z', SH), '2026-09-19 00:30:45');
  });

  it('toZonedIso / tzOffsetString 输出本地偏移', () => {
    const instant = Date.parse('2026-09-18T16:00:00.000Z');
    assert.equal(toZonedIso(instant, SH), '2026-09-19T00:00:00.000+08:00');
    assert.equal(tzOffsetString(instant, SH), '+08:00');
    assert.equal(toZonedIso(Date.parse('2026-03-09T04:00:00.000Z'), NY), '2026-03-09T00:00:00.000-04:00');
    assert.equal(tzOffsetString(Date.parse('2026-03-08T05:00:00.000Z'), NY), '-05:00');
  });
});

describe('normalizeRange', () => {
  it('默认最近 30 天（闭区间，日边界）', () => {
    const range = normalizeRange({ tz: SH, now: NOW });
    assert.equal(range.toDayKey, '2026-10-18');
    assert.equal(range.fromDayKey, '2026-09-19');
    assert.equal(range.days, 30);
    assert.equal(range.label, '最近 30 天');
    assert.equal(range.fromIso, '2026-09-18T16:00:00.000Z');
    assert.equal(range.toIso, '2026-10-18T15:59:59.999Z');
  });

  it('显式 from/to 归一化到日边界', () => {
    const range = normalizeRange({ from: '2026-01-05', to: '2026-01-05T13:45:00', tz: SH, now: NOW });
    assert.equal(range.fromDayKey, '2026-01-05');
    assert.equal(range.toDayKey, '2026-01-05');
    assert.equal(range.days, 1);
    assert.equal(range.fromIso, '2026-01-04T16:00:00.000Z');
    assert.equal(range.toIso, '2026-01-05T15:59:59.999Z');
    assert.equal(range.label, '2026-01-05 ~ 2026-01-05');
  });

  it('自定义区间带起止日标签', () => {
    const range = normalizeRange({ from: '2026-09-19', to: '2026-10-17', tz: SH, now: NOW });
    assert.equal(range.label, '2026-09-19 ~ 2026-10-17');
    assert.equal(range.days, 29);
  });

  it('from > to 抛 422', () => {
    assert.throws(
      () => normalizeRange({ from: '2026-10-18', to: '2026-10-01', tz: SH, now: NOW }),
      (error: unknown) => error instanceof AppError && error.status === 422 && error.code === 'VALIDATION_FAILED',
    );
  });

  it('跨度超过 3660 天抛 422', () => {
    assert.throws(
      () => normalizeRange({ from: '2010-01-01', to: '2026-10-18', tz: SH, now: NOW }),
      (error: unknown) => error instanceof AppError && error.status === 422,
    );
    const ok = normalizeRange({ from: '2016-11-01', to: '2026-10-18', tz: SH, now: NOW });
    assert.ok(ok.days <= 3660);
  });

  it('非法日期抛 422', () => {
    assert.throws(() => normalizeRange({ from: '2026-02-30', to: '2026-03-01', tz: SH, now: NOW }), AppError);
    assert.throws(() => normalizeRange({ from: 'not-a-date', tz: SH, now: NOW }), AppError);
  });
});
