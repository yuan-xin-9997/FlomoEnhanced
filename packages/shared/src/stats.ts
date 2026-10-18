/**
 * 统计纯函数（口径见 docs/ANALYTICS.md §4.1）。
 * 稳定 API：A3 的 domain/analytics.ts 直接调用这些函数，签名不要改。
 *
 * 口径要点：
 * - 分位数：线性插值 `h = (n-1)*p`（等同 numpy.percentile method='linear'）
 * - 样本标准差：ddof=1，count < 2 时为 0
 * - 直方图：Freedman–Diaconis 宽度 `2*IQR/n^(1/3)`，桶数夹取到 [5, 20]，退化时用 Sturges
 */

/** 直方图桶数下限 */
export const MIN_HISTOGRAM_BINS = 5;

/** 直方图桶数上限 */
export const MAX_HISTOGRAM_BINS = 20;

/** 保留小数位（避免浮点噪声，`digits` 省略则原样返回） */
export function roundTo(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** 求和（空数组为 0） */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** 算术平均（空数组为 0） */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/** 最小值（空数组为 0） */
export function minOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let result = Number.POSITIVE_INFINITY;
  for (const value of values) if (value < result) result = value;
  return result;
}

/** 最大值（空数组为 0） */
export function maxOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) if (value > result) result = value;
  return result;
}

/** 极差 max - min（空数组为 0） */
export function rangeOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return maxOf(values) - minOf(values);
}

/** 升序拷贝 */
export function sortAscending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * 分位数（线性插值）：要求 `sortedValues` 已升序。
 * `p` 取 0..1（如 0.25 表示 25% 分位）。
 */
export function percentile(sortedValues: readonly number[], p: number): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return sortedValues[0] ?? 0;
  const clamped = Math.min(Math.max(p, 0), 1);
  const h = (n - 1) * clamped;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const low = sortedValues[lo] ?? 0;
  if (lo === hi) return low;
  const high = sortedValues[hi] ?? low;
  return low + (high - low) * (h - lo);
}

/** 中位数（内部排序，无需预先排序） */
export function median(values: readonly number[]): number {
  return percentile(sortAscending(values), 0.5);
}

/** 四分位距 p75 - p25（要求已升序） */
export function iqr(sortedValues: readonly number[]): number {
  return percentile(sortedValues, 0.75) - percentile(sortedValues, 0.25);
}

/** 样本方差（ddof=1；count<2 时为 0） */
export function varianceSample(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const avg = mean(values);
  let acc = 0;
  for (const value of values) acc += (value - avg) ** 2;
  return acc / (n - 1);
}

/** 样本标准差（ddof=1；count<2 时为 0） */
export function stddevSample(values: readonly number[]): number {
  return Math.sqrt(varianceSample(values));
}

/** Freedman–Diaconis 分箱宽度 `2*IQR/n^(1/3)`；无法计算时返回 0 */
export function freedmanDiaconisBinWidth(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const width = (2 * iqr(sortAscending(values))) / Math.cbrt(n);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/** Sturges 桶数 `ceil(log2(n)) + 1` */
export function sturgesBinCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.ceil(Math.log2(n)) + 1;
}

/** 直方图单个桶 */
export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  /** count / 总数 */
  ratio: number;
  /** 累计占比 */
  cumulativeRatio: number;
}

/** 直方图结果 */
export interface Histogram {
  binCount: number;
  binWidth: number;
  bins: HistogramBin[];
}

/**
 * 构建直方图（ANALYTICS §4.1）。
 * - 空输入 → `{binCount:0, binWidth:0, bins:[]}`
 * - 全部同值 → `binCount = min(5, n)`，单桶，`binWidth = 0`
 * - 其余：FD 宽度 → `binCount = ceil(range/binWidth)`，夹取 `[minBins, maxBins]`；FD 非法（IQR=0）时用 Sturges
 * - 输出 `binWidth = range / binCount`，最后一个桶的 `to` 精确等于最大值
 */
export function buildHistogram(
  values: readonly number[],
  options: { minBins?: number; maxBins?: number } = {},
): Histogram {
  const minBins = options.minBins ?? MIN_HISTOGRAM_BINS;
  const maxBins = options.maxBins ?? MAX_HISTOGRAM_BINS;
  const n = values.length;
  if (n === 0) return { binCount: 0, binWidth: 0, bins: [] };

  const low = minOf(values);
  const high = maxOf(values);
  const range = high - low;

  if (range === 0) {
    return {
      binCount: Math.min(5, n),
      binWidth: 0,
      bins: [{ from: low, to: high, count: n, ratio: 1, cumulativeRatio: 1 }],
    };
  }

  const fdWidth = freedmanDiaconisBinWidth(values);
  let binCount = fdWidth > 0 ? Math.ceil(range / fdWidth) : sturgesBinCount(n);
  if (!Number.isFinite(binCount) || binCount < 1) binCount = sturgesBinCount(n);
  binCount = Math.min(Math.max(Math.trunc(binCount), minBins), maxBins);

  const binWidth = range / binCount;
  const counts = new Array<number>(binCount).fill(0);
  for (const value of values) {
    let index = binWidth > 0 ? Math.floor((value - low) / binWidth) : 0;
    if (index < 0) index = 0;
    if (index > binCount - 1) index = binCount - 1;
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const bins: HistogramBin[] = [];
  let cumulative = 0;
  for (let index = 0; index < binCount; index += 1) {
    const count = counts[index] ?? 0;
    const ratio = count / n;
    cumulative += ratio;
    const from = low + binWidth * index;
    const to = index === binCount - 1 ? high : low + binWidth * (index + 1);
    bins.push({ from: roundTo(from), to: roundTo(to), count, ratio: roundTo(ratio), cumulativeRatio: roundTo(cumulative) });
  }

  return { binCount, binWidth: roundTo(binWidth), bins };
}

/** 按 key 计数（保持首次出现顺序） */
export function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

/** 计数结果按 count 降序（相同则按 key 升序），取前 limit 项 */
export function topCounts(counts: Map<string, number>, limit?: number): Array<{ key: string; count: number }> {
  const list = [...counts.entries()].map(([key, count]) => ({ key, count }));
  list.sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key, 'zh-Hans-CN'));
  return limit === undefined ? list : list.slice(0, limit);
}

/**
 * 连续天数统计（基于「每日计数 > 0」的日期集合）。
 * @param dayKeys 已按升序排列、含 0 计数的完整日期序列（用于计算 currentStreak 的截断）
 * @param dayKeyDiff 日期差函数（避免本模块依赖时区工具）
 */
export function streaks(
  active: ReadonlySet<string>,
  orderedDayKeys: readonly string[],
  dayKeyDiff: (a: string, b: string) => number,
): { longest: number; current: number } {
  let longest = 0;
  let running = 0;
  for (const key of orderedDayKeys) {
    if (active.has(key)) {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 0;
    }
  }
  const last = orderedDayKeys[orderedDayKeys.length - 1];
  let current = 0;
  if (last !== undefined && active.has(last)) {
    for (let index = orderedDayKeys.length - 1; index >= 0; index -= 1) {
      const key = orderedDayKeys[index];
      if (key === undefined || !active.has(key)) break;
      if (index < orderedDayKeys.length - 1) {
        const next = orderedDayKeys[index + 1];
        if (next === undefined || dayKeyDiff(next, key) !== 1) break;
      }
      current += 1;
    }
  }
  return { longest, current };
}
