/**
 * ECharts option 组装（纯函数）—— 洞察页所有图表的唯一来源，便于单测。
 * 约定：所有函数对空数据都必须返回「合法且可渲染」的 option，绝不抛错。
 */
import { FIELD_TYPE_META, effectivePrecision } from '@flomo/shared';
import type { FieldDefinition, FieldValue } from '@flomo/shared';
import type { EChartsOption } from 'echarts';
import { numericDisplayOf } from './fieldForm';
import type {
  AnalyticsOverview,
  DateStats,
  DistributionEntry,
  FieldInsight,
  Heatmap,
  HourOfDay,
  NumericStats,
  NumericTrend,
  OverviewTemplateShare,
  TagStat,
  TextStats,
  Timeline,
  UrlStats,
  Weekday,
} from './analyticsTypes';
import { formatNumber } from './format';

/** 通用配色（与 flomo 极简气质一致的冷色系） */
const PALETTE = ['#30cf79', '#5ad39a', '#8fe0b4', '#c9f0dd', '#4dc9c0', '#5aa9f0', '#f2b84b', '#9b8cf9'];

const AXIS_LABEL = { fontSize: 10, color: '#8f959e' } as const;

function baseGrid(hasLegend: boolean): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  containLabel: boolean;
} {
  return {
    left: 8,
    right: 12,
    top: hasLegend ? 34 : 18,
    bottom: 6,
    containLabel: true,
  };
}

function emptyOption(text = '该区间内暂无数据'): EChartsOption {
  return {
    title: {
      text,
      left: 'center',
      top: 'middle',
      textStyle: { color: '#8f959e', fontSize: 13, fontWeight: 400 },
    },
  };
}

/** 分桶标签（后端已给中文字段，缺失时回退 bucket） */
function pointLabels(points: ReadonlyArray<{ bucket: string; label?: string }>): string[] {
  return points.map((point) => (point.label !== undefined && point.label !== '' ? point.label : point.bucket));
}

/** 数值展示（按字段精度；金额/百分比带上币种与单位） */
export function formatFieldNumber(def: FieldDefinition | undefined, value: number): string {
  if (def === undefined) return formatNumber(value, 2);
  if (def.type === 'currency' || def.type === 'percent') return numericDisplayOf(def, value);
  return formatNumber(value, effectivePrecision(def));
}

/** 直方图桶标签：`10–633.75` */
export function binLabel(from: number, to: number, precision: number): string {
  const format = (value: number): string =>
    new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: precision,
      minimumFractionDigits: 0,
    }).format(value);
  return `${format(from)}–${format(to)}`;
}

/* ------------------------------ 主趋势（柱 + 折线双轴） ------------------------------ */

export function buildTimelineOption(timeline: Timeline | null | undefined, subtitle?: string): EChartsOption {
  const points = timeline?.points ?? [];
  if (points.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['条数', '字数'],
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: '#4e5969' },
    },
    grid: baseGrid(true),
    xAxis: {
      type: 'category',
      data: pointLabels(points),
      axisLabel: { ...AXIS_LABEL, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: [
      { type: 'value', name: subtitle ?? '', nameTextStyle: { fontSize: 10, color: '#8f959e' }, axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
      { type: 'value', name: '', axisLabel: AXIS_LABEL, splitLine: { show: false } },
    ],
    series: [
      {
        name: '条数',
        type: 'bar',
        data: points.map((point) => point.count),
        barMaxWidth: 16,
        itemStyle: { color: '#a8e6c3', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: '字数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 4,
        data: points.map((point) => point.chars),
        itemStyle: { color: '#26b769' },
        lineStyle: { width: 2 },
      },
    ],
  };
}

/* ------------------------------ 日历热力图 ------------------------------ */

/** 视觉映射区间：[0, max]，max 至少为 1 以免全 0 时图例异常 */
export function heatmapVisualRange(max: number): { min: number; max: number } {
  return { min: 0, max: Math.max(1, Math.floor(max)) };
}

export function buildCalendarHeatmapOption(
  heatmap: Heatmap | null | undefined,
  range?: { from?: string; to?: string },
): EChartsOption {
  const days = (heatmap?.days ?? []).filter((day) => typeof day.date === 'string' && day.date !== '');
  if (days.length === 0) return emptyOption();
  const dates = days.map((day) => day.date).sort((a, b) => a.localeCompare(b));
  const start = range?.from !== undefined && range.from !== '' ? range.from.slice(0, 10) : dates[0] ?? '';
  const end = range?.to !== undefined && range.to !== '' ? range.to.slice(0, 10) : dates[dates.length - 1] ?? '';
  const visual = heatmapVisualRange(heatmap?.max ?? 0);

  return {
    tooltip: { formatter: '{b} · {c} 条' },
    visualMap: {
      show: false,
      min: visual.min,
      max: visual.max,
      type: 'piecewise',
      splitNumber: 5,
      inRange: { color: ['#ededed', '#c9f0dd', '#8fe0b4', '#4fcf8b', '#30cf79'] },
    },
    calendar: {
      range: [start, end],
      left: 30,
      right: 12,
      top: 22,
      cellSize: ['auto', 14],
      itemStyle: { borderWidth: 2, borderColor: '#fff', color: '#ededed' },
      splitLine: { show: false },
      yearLabel: { show: false },
      monthLabel: { fontSize: 10, color: '#8f959e', nameMap: 'zh' },
      dayLabel: { fontSize: 10, color: '#8f959e', firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'] },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: days.map((day) => [day.date, day.count]),
      },
    ],
  };
}

/* ------------------------------ 星期 / 小时分布 ------------------------------ */

export function buildWeekdayOption(weekday: Weekday | null | undefined): EChartsOption {
  const buckets = weekday?.buckets ?? [];
  if (buckets.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => bucket.label !== '' ? bucket.label : `周${bucket.weekday}`),
      axisLabel: AXIS_LABEL,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      {
        type: 'bar',
        data: buckets.map((bucket) => bucket.count),
        barMaxWidth: 22,
        itemStyle: { color: '#5ad39a', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

export function buildHourOption(hourOfDay: HourOfDay | null | undefined): EChartsOption {
  const buckets = hourOfDay?.buckets ?? [];
  if (buckets.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis', formatter: '{b} 时 · {c} 条' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => String(bucket.hour).padStart(2, '0')),
      axisLabel: { ...AXIS_LABEL, interval: 1 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      {
        type: 'bar',
        data: buckets.map((bucket) => bucket.count),
        barMaxWidth: 14,
        itemStyle: { color: '#9b8cf9', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

/* ------------------------------ 标签 / 域名横向条形 ------------------------------ */

export function buildRankedBarOption(
  items: ReadonlyArray<{ name: string; value: number }>,
  options: { limit?: number; color?: string } = {},
): EChartsOption {
  const limit = options.limit ?? 15;
  const list = items.filter((item) => item.name !== '').slice(0, limit);
  if (list.length === 0) return emptyOption();
  // 横向条形：yAxis 自下而上，故倒序保证最大值在顶部
  const ordered = [...list].reverse();
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 10, bottom: 6, containLabel: true },
    xAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    yAxis: {
      type: 'category',
      data: ordered.map((item) => item.name),
      axisLabel: { fontSize: 11, color: '#4e5969' },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    series: [
      {
        type: 'bar',
        data: ordered.map((item) => item.value),
        barMaxWidth: 14,
        itemStyle: { color: options.color ?? '#5ad39a', borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', fontSize: 10, color: '#8f959e' },
      },
    ],
  };
}

export function buildTagsOption(tags: readonly TagStat[] | null | undefined, limit = 20): EChartsOption {
  return buildRankedBarOption(
    (tags ?? []).map((item) => ({ name: item.tag, value: item.count })),
    { limit, color: '#30cf79' },
  );
}

export function buildUrlDomainsOption(url: UrlStats | null | undefined): EChartsOption {
  return buildRankedBarOption(
    (url?.distinctDomains ?? []).map((item) => ({ name: item.domain, value: item.count })),
    { limit: 15, color: '#f2b84b' },
  );
}

/* ------------------------------ 数值型：直方图 / 趋势 ------------------------------ */

export function buildNumericHistogramOption(
  numeric: NumericStats | null | undefined,
  def?: FieldDefinition,
): EChartsOption {
  const bins = numeric?.histogram?.bins ?? [];
  if (bins.length === 0) return emptyOption();
  const precision = def === undefined ? 2 : effectivePrecision(def);
  return {
    tooltip: { trigger: 'axis' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: bins.map((bin) => binLabel(bin.from, bin.to, precision)),
      axisLabel: { ...AXIS_LABEL, rotate: bins.length > 8 ? 30 : 0, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      {
        type: 'bar',
        data: bins.map((bin) => bin.count),
        barMaxWidth: 26,
        itemStyle: { color: '#a8e6c3', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

export function buildNumericTrendOption(
  trend: NumericTrend | null | undefined,
  def?: FieldDefinition,
): EChartsOption {
  const points = trend?.points ?? [];
  if (points.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['条数', '均值'],
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: '#4e5969' },
    },
    grid: baseGrid(true),
    xAxis: {
      type: 'category',
      data: pointLabels(points),
      axisLabel: { ...AXIS_LABEL, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: [
      { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
      { type: 'value', axisLabel: AXIS_LABEL, splitLine: { show: false } },
    ],
    series: [
      {
        name: '条数',
        type: 'bar',
        data: points.map((point) => point.count),
        barMaxWidth: 16,
        itemStyle: { color: '#e2f6ea', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: '均值',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 4,
        connectNulls: true,
        data: points.map((point) => Math.round(point.mean * 100) / 100),
        itemStyle: { color: '#26b769' },
        lineStyle: { width: 2 },
      },
    ],
  };
}

/* ------------------------------ 选择型分布 ------------------------------ */

/** 分布点（补齐模板定义里存在但区间内未出现的选项） */
export interface DistributionPoint {
  value: string;
  label: string;
  count: number;
  share: number;
  /** 是否在模板 options 中有定义 */
  defined: boolean;
}

/**
 * 补零 + 排序：以模板字段的 options 为全集，结合后端 `distribution` 与 `valueUnion`。
 * 排序：count 降序 → label 升序。
 */
export function fillDistribution(
  distribution: readonly DistributionEntry[] | null | undefined,
  def: FieldDefinition | null | undefined,
  valueUnion?: readonly string[] | null,
): DistributionPoint[] {
  const options = def?.options ?? [];
  const labelOf = new Map<string, string>();
  const definedValues = new Set<string>();
  const counts = new Map<string, { count: number; share: number }>();
  for (const option of options) {
    definedValues.add(option.value);
    labelOf.set(option.value, option.label);
    // 模板定义的所有选项都参与展示（未出现的补 0）
    counts.set(option.value, { count: 0, share: 0 });
  }

  for (const item of distribution ?? []) {
    const value = typeof item.value === 'string' ? item.value : String(item.value);
    counts.set(value, { count: item.count, share: item.share });
    if (item.label !== undefined && item.label !== '' && !labelOf.has(value)) labelOf.set(value, item.label);
  }
  for (const value of valueUnion ?? []) {
    if (!counts.has(value)) counts.set(value, { count: 0, share: 0 });
  }

  const points: DistributionPoint[] = [...counts.entries()].map(([value, stat]) => ({
    value,
    label: labelOf.get(value) ?? value,
    count: stat.count,
    share: stat.share,
    defined: definedValues.has(value),
  }));

  points.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  return points;
}

export function buildDistributionOption(points: readonly DistributionPoint[], title = '占比'): EChartsOption {
  const effective = points.filter((point) => point.count > 0);
  if (points.length === 0) return emptyOption();
  if (effective.length <= 8) {
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c}（{d}%）' },
      legend: { bottom: 0, type: 'scroll', textStyle: { fontSize: 11, color: '#4e5969' }, itemWidth: 10, itemHeight: 8 },
      color: PALETTE,
      series: [
        {
          name: title,
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          data: points.map((point) => ({ name: point.label, value: point.count })),
          label: { fontSize: 11, color: '#4e5969', formatter: '{b}' },
          labelLine: { length: 6, length2: 6 },
        },
      ],
    };
  }
  return buildRankedBarOption(
    points.map((point) => ({ name: `${point.label}（${point.count}）`, value: point.count })),
    { limit: 20, color: '#5ad39a' },
  );
}

/** 评分分布（0..scale 全量桶） */
export function buildRatingOption(
  distribution: readonly DistributionEntry[] | null | undefined,
  def?: FieldDefinition,
): EChartsOption {
  const scale = typeof def?.scale === 'number' ? def.scale : 5;
  const counts = new Map<number, number>();
  for (const item of distribution ?? []) {
    const value = typeof item.value === 'number' ? item.value : Number(item.value);
    if (Number.isFinite(value)) counts.set(value, item.count);
  }
  const values = Array.from({ length: scale + 1 }, (_, index) => index);
  const data = values.map((value) => counts.get(value) ?? 0);
  if (data.every((count) => count === 0)) return emptyOption();
  return {
    tooltip: { trigger: 'axis', formatter: '{b} 分 · {c} 条' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: values.map((value) => (value === 0 ? '未评分' : `${value} 分`)),
      axisLabel: AXIS_LABEL,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      {
        type: 'bar',
        data,
        barMaxWidth: 26,
        itemStyle: { color: '#f2b84b', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

/* ------------------------------ 布尔占比 ------------------------------ */

export function buildBooleanOption(stats: FieldInsight['boolean']): EChartsOption {
  if (stats === null || stats === undefined) return emptyOption();
  const total = stats.trueCount + stats.falseCount;
  if (total === 0) return emptyOption();
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}（{d}%）' },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: '#4e5969' }, itemWidth: 10, itemHeight: 8 },
    color: ['#30cf79', '#e6e6e6'],
    series: [
      {
        type: 'pie',
        radius: ['48%', '70%'],
        center: ['50%', '44%'],
        data: [
          { name: '是', value: stats.trueCount },
          { name: '否', value: stats.falseCount },
        ],
        label: { fontSize: 11, color: '#4e5969', formatter: '{b} {d}%' },
        labelLine: { length: 6, length2: 6 },
      },
    ],
  };
}

/* ------------------------------ 日期型分布 ------------------------------ */

export function buildDateBucketsOption(dateStats: DateStats | null | undefined): EChartsOption {
  const buckets = dateStats?.byMonth ?? [];
  if (buckets.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis', formatter: `{b} · {c} 条` },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => bucket.bucket),
      axisLabel: { ...AXIS_LABEL, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      {
        type: 'bar',
        data: buckets.map((bucket) => bucket.count),
        barMaxWidth: 26,
        itemStyle: { color: '#a8e6c3', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

export function buildDateWeekdayOption(dateStats: DateStats | null | undefined): EChartsOption {
  const buckets = dateStats?.byWeekday ?? [];
  if (buckets.length === 0) return emptyOption();
  const names = ['一', '二', '三', '四', '五', '六', '日'];
  return {
    tooltip: { trigger: 'axis', formatter: '{b} · {c} 条' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => `周${names[bucket.weekday - 1] ?? bucket.weekday}`),
      axisLabel: AXIS_LABEL,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      { type: 'bar', data: buckets.map((bucket) => bucket.count), barMaxWidth: 22, itemStyle: { color: '#4dc9c0', borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

export function buildDateHourOption(dateStats: DateStats | null | undefined): EChartsOption {
  const buckets = dateStats?.byHour ?? [];
  if (buckets.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis', formatter: '{b} 时 · {c} 条' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => String(bucket.hour).padStart(2, '0')),
      axisLabel: { ...AXIS_LABEL, interval: 1 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      { type: 'bar', data: buckets.map((bucket) => bucket.count), barMaxWidth: 12, itemStyle: { color: '#9b8cf9', borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

/* ------------------------------ 文本：字数直方图 + 词云 ------------------------------ */

export function buildTextHistogramOption(text: TextStats | null | undefined): EChartsOption {
  const bins = text?.histogram?.bins ?? [];
  if (bins.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'axis', formatter: '{b} 字 · {c} 条' },
    grid: baseGrid(false),
    xAxis: {
      type: 'category',
      data: bins.map((bin) => binLabel(bin.from, bin.to, 0)),
      axisLabel: { ...AXIS_LABEL, hideOverlap: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e5e5' } },
    },
    yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: { lineStyle: { color: '#f4f4f4' } } },
    series: [
      { type: 'bar', data: bins.map((bin) => bin.count), barMaxWidth: 26, itemStyle: { color: '#30cf79', borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

/** 词云字号映射（用字号表意，纯函数便于单测） */
export function wordCloudSizes(
  words: ReadonlyArray<{ word: string; count: number }>,
  options: { min?: number; max?: number } = {},
): Array<{ word: string; count: number; fontSize: number }> {
  const minSize = options.min ?? 12;
  const maxSize = options.max ?? 30;
  const list = words.filter((item) => item.word !== '');
  if (list.length === 0) return [];
  const maxCount = Math.max(...list.map((item) => item.count));
  const minCount = Math.min(...list.map((item) => item.count));
  return list.map((item) => {
    const span = maxCount - minCount;
    const ratio = span <= 0 ? 1 : (item.count - minCount) / span;
    return {
      word: item.word,
      count: item.count,
      fontSize: Math.round((minSize + (maxSize - minSize) * ratio) * 10) / 10,
    };
  });
}

/* ------------------------------ 全局概览 ------------------------------ */

export function buildOverviewShareOption(byTemplate: readonly OverviewTemplateShare[] | null | undefined): EChartsOption {
  const list = (byTemplate ?? []).filter((item) => item.count > 0);
  if (list.length === 0) return emptyOption();
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}（{d}%）' },
    legend: { bottom: 0, type: 'scroll', textStyle: { fontSize: 11, color: '#4e5969' }, itemWidth: 10, itemHeight: 8 },
    color: PALETTE,
    series: [
      {
        type: 'pie',
        radius: ['40%', '66%'],
        center: ['50%', '44%'],
        data: list.map((item) => ({
          name: `${item.icon !== '' ? `${item.icon} ` : ''}${item.templateName}`,
          value: item.count,
        })),
        label: { fontSize: 11, color: '#4e5969', formatter: '{b}' },
        labelLine: { length: 6, length2: 6 },
      },
    ],
  };
}

/** 概览页「7×24 记录时段分布」矩阵（weekday × hour → count）。后端未直接提供矩阵，由两维分布合成。 */
export function toHotspotMatrixSizes(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 1;
  return Math.min(1, value / max);
}

/** 数值型字段指标卡（保留 ECharts 之外的纯展示数据，便于单测） */
export interface NumericMetric {
  key: string;
  label: string;
  value: string;
}

export function numericMetricsOf(numeric: NumericStats | null | undefined, def?: FieldDefinition): NumericMetric[] {
  if (numeric === null || numeric === undefined || numeric.count === 0) return [];
  const format = (value: number): string => formatFieldNumber(def, value);
  return [
    { key: 'count', label: '有值条数', value: String(numeric.count) },
    { key: 'sum', label: '合计', value: format(numeric.sum) },
    { key: 'mean', label: '平均', value: format(numeric.mean) },
    { key: 'median', label: '中位数', value: format(numeric.median) },
    { key: 'min', label: '最小', value: format(numeric.min) },
    { key: 'max', label: '最大', value: format(numeric.max) },
    { key: 'p25', label: 'P25', value: format(numeric.p25) },
    { key: 'p75', label: 'P75', value: format(numeric.p75) },
    { key: 'p90', label: 'P90', value: format(numeric.p90) },
    { key: 'p95', label: 'P95', value: format(numeric.p95) },
    { key: 'stddev', label: '标准差', value: format(numeric.stddev) },
    { key: 'range', label: '极差', value: format(numeric.range) },
    { key: 'outliers', label: '离群值 (1.5×IQR)', value: `${numeric.outliers.count} 个` },
  ];
}

/** 字段值的展示（图表 tooltip / 列表复用 shared 的 formatFieldValue） */
export function fieldValueText(
  def: FieldDefinition | undefined,
  value: FieldValue | undefined,
  format: (def: FieldDefinition, value: FieldValue | undefined) => string,
): string {
  if (def === undefined) return '';
  return format(def, value);
}

/** 字段类型中文名（供 header 文案） */
export function fieldTypeLabel(field: FieldInsight): string {
  return FIELD_TYPE_META[field.type]?.label ?? field.type;
}

/** 概览页数值字段排行（按 sum 降序） */
export function overviewNumericRank(overview: AnalyticsOverview | null): Array<{ name: string; value: number }> {
  const list = overview?.numericFields ?? [];
  return [...list]
    .sort((a, b) => b.sum - a.sum || a.label.localeCompare(b.label, 'zh-Hans-CN'))
    .slice(0, 15)
    .map((item) => ({ name: `${item.templateName}·${item.label}`, value: Math.round(item.sum * 100) / 100 }));
}
