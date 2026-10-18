import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildHistogram,
  countBy,
  freedmanDiaconisBinWidth,
  iqr,
  maxOf,
  mean,
  median,
  minOf,
  percentile,
  rangeOf,
  sortAscending,
  stddevSample,
  streaks,
  sturgesBinCount,
  sum,
  topCounts,
  varianceSample,
} from '../src/index.ts';

/** 浮点近似断言 */
function closeTo(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `期望 ${expected}，实际 ${actual}`);
}

describe('基础聚合', () => {
  it('sum / mean / min / max / range', () => {
    const values = [10, 20, 30, 40, 50];
    assert.equal(sum(values), 150);
    assert.equal(mean(values), 30);
    assert.equal(minOf(values), 10);
    assert.equal(maxOf(values), 50);
    assert.equal(rangeOf(values), 40);
    assert.equal(sum([]), 0);
    assert.equal(mean([]), 0);
    assert.equal(minOf([]), 0);
    assert.equal(maxOf([]), 0);
  });

  it('median 对偶数个取中间两数平均', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), 0);
  });
});

describe('percentile（线性插值，对齐 numpy method=linear）', () => {
  const sorted = sortAscending([1, 2, 3, 4]);

  it('h = (n-1)*p 的线性插值', () => {
    closeTo(percentile(sorted, 0), 1);
    closeTo(percentile(sorted, 0.25), 1.75);
    closeTo(percentile(sorted, 0.5), 2.5);
    closeTo(percentile(sorted, 0.75), 3.25);
    closeTo(percentile(sorted, 0.9), 3.7);
    closeTo(percentile(sorted, 1), 4);
  });

  it('单元素与空数组安全', () => {
    closeTo(percentile([7], 0.25), 7);
    closeTo(percentile([], 0.5), 0);
  });

  it('iqr = p75 - p25', () => {
    closeTo(iqr([1, 2, 3, 4]), 1.5);
    closeTo(iqr([10, 20, 30, 40, 50]), 20);
  });
});

describe('stddevSample（ddof=1）', () => {
  it('与 numpy.std(ddof=1) 一致', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    closeTo(varianceSample(values), 32 / 7, 1e-12);
    closeTo(stddevSample(values), Math.sqrt(32 / 7), 1e-12);
  });

  it('count<2 时为 0', () => {
    assert.equal(stddevSample([]), 0);
    assert.equal(stddevSample([5]), 0);
  });
});

describe('Freedman–Diaconis / Sturges', () => {
  it('FD 宽度 = 2*IQR/n^(1/3)', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const expected = (2 * iqr(sortAscending(values))) / Math.cbrt(values.length);
    closeTo(freedmanDiaconisBinWidth(values), expected, 1e-12);
  });

  it('IQR 为 0 时 FD 宽度为 0', () => {
    assert.equal(freedmanDiaconisBinWidth([5, 5, 5, 5]), 0);
  });

  it('Sturges = ceil(log2(n)) + 1', () => {
    assert.equal(sturgesBinCount(1), 1);
    assert.equal(sturgesBinCount(8), 4);
    assert.equal(sturgesBinCount(100), 8);
  });
});

describe('buildHistogram', () => {
  it('空数组返回空直方图', () => {
    assert.deepEqual(buildHistogram([]), { binCount: 0, binWidth: 0, bins: [] });
  });

  it('全部同值：单桶、binWidth 0、binCount 夹取 min(5,n)', () => {
    const histogram = buildHistogram([7, 7, 7]);
    assert.equal(histogram.binCount, 3);
    assert.equal(histogram.binWidth, 0);
    assert.equal(histogram.bins.length, 1);
    assert.deepEqual(histogram.bins[0], { from: 7, to: 7, count: 3, ratio: 1, cumulativeRatio: 1 });
  });

  it('桶数夹取到 [5,20] 且覆盖 [min,max]', () => {
    const values = [10, 20, 30, 40, 50];
    const histogram = buildHistogram(values);
    assert.equal(histogram.binCount, 5);
    assert.equal(histogram.bins.length, 5);
    assert.equal(histogram.bins[0]?.from, 10);
    assert.equal(histogram.bins[4]?.to, 50);
    closeTo(histogram.binWidth, 8, 1e-9);
    assert.equal(histogram.bins.reduce((acc, bin) => acc + bin.count, 0), 5);
    assert.deepEqual(
      histogram.bins.map((bin) => bin.count),
      [1, 1, 1, 1, 1],
    );
    closeTo(histogram.bins[4]?.cumulativeRatio ?? 0, 1, 1e-9);
  });

  it('大量数据时桶数不超过 20，占比合计为 1', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index / 100);
    const histogram = buildHistogram(values);
    assert.ok(histogram.binCount >= 5 && histogram.binCount <= 20);
    assert.equal(histogram.bins.length, histogram.binCount);
    const total = histogram.bins.reduce((acc, bin) => acc + bin.count, 0);
    assert.equal(total, values.length);
    closeTo(histogram.bins[histogram.bins.length - 1]?.cumulativeRatio ?? 0, 1, 1e-6);
  });
});

describe('countBy / topCounts', () => {
  it('按 key 计数并降序返回', () => {
    const items = ['工作', '生活', '工作', '读书', '工作'];
    const counts = countBy(items, (item) => item);
    assert.equal(counts.get('工作'), 3);
    assert.equal(counts.get('生活'), 1);
    assert.deepEqual(topCounts(counts, 2), [
      { key: '工作', count: 3 },
      { key: '读书', count: 1 },
    ]);
  });
});

describe('streaks', () => {
  const diff = (a: string, b: string): number =>
    Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

  it('计算最长连续与当前连续', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
    const active = new Set(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']);
    assert.deepEqual(streaks(active, days, diff), { longest: 2, current: 2 });
  });

  it('末日无记录时当前连续为 0', () => {
    const days = ['2026-10-01', '2026-10-02'];
    assert.deepEqual(streaks(new Set(['2026-10-01']), days, diff), { longest: 1, current: 0 });
  });
});
