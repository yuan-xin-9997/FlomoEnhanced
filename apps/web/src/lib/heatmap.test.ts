import { describe, expect, it } from 'vitest';
import { buildHeatmapGrid, heatLevel, startOfWeekMonday } from './heatmap';

describe('heatLevel（5 档颜色）', () => {
  it('按 max 分档', () => {
    expect(heatLevel(0, 4)).toBe(0);
    expect(heatLevel(1, 4)).toBe(1);
    expect(heatLevel(2, 4)).toBe(2);
    expect(heatLevel(3, 4)).toBe(3);
    expect(heatLevel(4, 4)).toBe(4);
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(3, 0)).toBe(1);
  });
});

describe('startOfWeekMonday', () => {
  it('周日归到上一个周一', () => {
    // 2026-10-18 是周日
    expect(startOfWeekMonday('2026-10-18')).toBe('2026-10-12');
    expect(startOfWeekMonday('2026-10-12')).toBe('2026-10-12');
    expect(startOfWeekMonday('2026-10-17')).toBe('2026-10-12');
    expect(startOfWeekMonday('2026-10-19')).toBe('2026-10-19');
  });
});

describe('buildHeatmapGrid', () => {
  const today = '2026-10-18';

  it('生成 12 周 × 7 天的网格并以今天结尾', () => {
    const grid = buildHeatmapGrid([{ date: today, count: 3 }], { weeks: 12, today });
    expect(grid.weeks).toHaveLength(12);
    expect(grid.weeks.every((column) => column.length === 7)).toBe(true);
    expect(grid.weeks[0]?.[0]?.date).toBe('2026-07-27');
    expect(grid.weeks[11]?.[6]?.date).toBe(today);
    expect(grid.start).toBe('2026-07-27');
    expect(grid.end).toBe(today);
  });

  it('统计总数、活跃天数与档位', () => {
    const grid = buildHeatmapGrid(
      [
        { date: '2026-10-18', count: 4 },
        { date: '2026-10-17', count: 2 },
        { date: '2026-10-17', count: 1 },
        { date: '2026-08-01', count: 0 },
      ],
      { weeks: 12, today },
    );
    expect(grid.max).toBe(4); // 同一天多次出现会被累加：10-17 → 3
    expect(grid.total).toBe(7);
    expect(grid.activeDays).toBe(2);
    const lastColumn = grid.weeks[11] ?? [];
    expect(lastColumn[6]?.date).toBe('2026-10-18');
    expect(lastColumn[6]?.count).toBe(4);
    expect(lastColumn[6]?.level).toBe(4); // 4/4 = 1 → 档位 4
    expect(lastColumn[5]?.count).toBe(3);
    expect(lastColumn[5]?.level).toBe(3); // 3/4 = 0.75 → 档位 3
    expect(lastColumn[6]?.title).toBe('2026-10-18 · 4 条');
  });

  it('未来日期不参与统计且标记为不在网格内', () => {
    const grid = buildHeatmapGrid([{ date: '2026-10-20', count: 9 }], { weeks: 2, today: '2026-10-14' });
    const lastColumn = grid.weeks[1] ?? [];
    const todayIndex = lastColumn.findIndex((cell) => cell.date === '2026-10-14');
    expect(todayIndex).toBeGreaterThanOrEqual(0);
    expect(lastColumn[todayIndex]?.inGrid).toBe(true);
    // 今天之后的行（周四…周日）都是未来
    expect(lastColumn.slice(todayIndex + 1).every((cell) => !cell.inGrid)).toBe(true);
    expect(lastColumn.slice(todayIndex + 1).every((cell) => cell.count === 0)).toBe(true);
    expect(grid.total).toBe(0);
  });

  it('月份标签按列去重', () => {
    const grid = buildHeatmapGrid([], { weeks: 12, today });
    const labels = grid.monthLabels.map((item) => item.label);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels).toContain('10月');
    expect(new Set(grid.monthLabels.map((item) => item.column)).size).toBe(grid.monthLabels.length);
  });

  it('忽略非法日期与负数计数', () => {
    const grid = buildHeatmapGrid(
      [
        { date: '不是日期', count: 5 },
        { date: '2026-10-18', count: -3 },
      ],
      { weeks: 1, today },
    );
    expect(grid.total).toBe(0);
    expect(grid.activeDays).toBe(0);
  });
});
