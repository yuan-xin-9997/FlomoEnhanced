import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '@flomo/shared';
import {
  binLabel,
  buildBooleanOption,
  buildCalendarHeatmapOption,
  buildDistributionOption,
  buildHourOption,
  buildNumericHistogramOption,
  buildNumericTrendOption,
  buildOverviewShareOption,
  buildRankedBarOption,
  buildTagsOption,
  buildTimelineOption,
  buildWeekdayOption,
  fillDistribution,
  heatmapVisualRange,
  numericMetricsOf,
  overviewNumericRank,
  wordCloudSizes,
} from './chartOptions';
import type { AnalyticsOverview, NumericStats, TemplateInsights } from './analyticsTypes';

/** EChartsOption 是大联合类型，测试里统一按结构断言 */
function obj(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

const timeline = {
  granularity: 'day' as const,
  points: [
    { bucket: '2026-10-17', label: '10-17', count: 3, chars: 210 },
    { bucket: '2026-10-18', label: '10-18', count: 5, chars: 300 },
  ],
};

describe('buildTimelineOption（柱 + 折线双轴）', () => {
  it('条数走柱状、字数走折线且使用次轴', () => {
    const option = obj(buildTimelineOption(timeline));
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(2);
    expect(series[0]?.type).toBe('bar');
    expect(series[0]?.data).toEqual([3, 5]);
    expect(series[1]?.type).toBe('line');
    expect(series[1]?.yAxisIndex).toBe(1);
    expect(series[1]?.data).toEqual([210, 300]);
    expect(obj(option.xAxis).data).toEqual(['10-17', '10-18']);
  });

  it('空数据返回可渲染的空状态而不是报错', () => {
    const option = obj(buildTimelineOption({ granularity: 'day', points: [] }));
    expect(option.series).toBeUndefined();
    expect(obj(option.title).text).toBe('该区间内暂无数据');
  });
});

describe('buildCalendarHeatmapOption', () => {
  it('visualMap 使用 [0, max] 分档且 calendar 覆盖完整区间', () => {
    const option = obj(
      buildCalendarHeatmapOption({
        max: 6,
        days: [
          { date: '2026-09-19', count: 0 },
          { date: '2026-09-20', count: 6 },
        ],
      }),
    );
    expect(obj(option.visualMap).max).toBe(6);
    expect(obj(option.visualMap).min).toBe(0);
    expect(obj(option.visualMap).splitNumber).toBe(5);
    expect(obj(option.calendar).range).toEqual(['2026-09-19', '2026-09-20']);
    expect((option.series as Array<Record<string, unknown>>)[0]?.data).toEqual([
      ['2026-09-19', 0],
      ['2026-09-20', 6],
    ]);
  });

  it('max 为 0 时视觉映射上限兜底为 1', () => {
    expect(heatmapVisualRange(0)).toEqual({ min: 0, max: 1 });
    expect(heatmapVisualRange(6.9)).toEqual({ min: 0, max: 6 });
    const option = obj(buildCalendarHeatmapOption({ max: 0, days: [{ date: '2026-10-01', count: 0 }] }));
    expect(obj(option.visualMap).max).toBe(1);
  });
});

describe('fillDistribution（补齐模板中未出现的选项）', () => {
  const def = {
    key: 'meal',
    label: '餐次',
    type: 'select',
    options: [
      { value: 'food', label: '餐饮' },
      { value: 'traffic', label: '交通' },
      { value: 'rent', label: '房租' },
    ],
  } as FieldDefinition;

  it('补零、排序并保留 defined 标记', () => {
    const points = fillDistribution([{ value: 'food', count: 18, share: 1 }], def, ['food', 'rent']);
    // 0 计数的选项按中文拼音排序：餐饮 > 房租 > 交通
    expect(points.map((point) => point.label)).toEqual(['餐饮', '房租', '交通']);
    expect(points[0]).toMatchObject({ value: 'food', count: 18, defined: true });
    expect(points.find((point) => point.value === 'traffic')).toMatchObject({ count: 0, share: 0, defined: true });
    expect(points.find((point) => point.value === 'rent')).toMatchObject({ count: 0, defined: true });
  });

  it('出现模板定义外的旧值时也一并展示', () => {
    const points = fillDistribution([{ value: 'legacy', count: 2, share: 1 }], def, null);
    expect(points[0]).toMatchObject({ value: 'legacy', label: 'legacy', defined: false });
    expect(points).toHaveLength(4);
  });

  it('≤8 项用饼图、超过则退化为横向条形', () => {
    const few = obj(buildDistributionOption(fillDistribution([{ value: 'food', count: 3, share: 1 }], def)));
    expect((few.series as Array<Record<string, unknown>>)[0]?.type).toBe('pie');

    const many = Array.from({ length: 12 }, (_, index) => ({ value: `v${index}`, count: 1, share: 0.1 }));
    const lot = obj(buildDistributionOption(fillDistribution(many, null)));
    expect((lot.series as Array<Record<string, unknown>>)[0]?.type).toBe('bar');
  });
});

describe('数值型图表', () => {
  const numeric: NumericStats = {
    count: 40,
    sum: 12345.6,
    mean: 308.64,
    median: 200,
    min: 10,
    max: 5000,
    p25: 100,
    p75: 400,
    p90: 900,
    p95: 1200,
    stddev: 123.4,
    range: 4990,
    histogram: {
      binCount: 2,
      binWidth: 2495,
      bins: [
        { from: 10, to: 2505, count: 30, ratio: 0.75, cumulativeRatio: 0.75 },
        { from: 2505, to: 5000, count: 10, ratio: 0.25, cumulativeRatio: 1 },
      ],
    },
    outliers: { method: 'iqr', lower: -350, upper: 850, count: 2 },
  };

  it('直方图 x 轴使用可读桶标签', () => {
    const field = { key: 'amount', label: '金额', type: 'currency', precision: 2, currency: 'CNY' } as FieldDefinition;
    const option = obj(buildNumericHistogramOption(numeric, field));
    expect(obj(option.xAxis).data).toEqual(['10–2,505', '2,505–5,000']);
    expect((option.series as Array<Record<string, unknown>>)[0]?.data).toEqual([30, 10]);
  });

  it('binLabel 按精度格式化', () => {
    expect(binLabel(10, 633.75, 2)).toBe('10–633.75');
    expect(binLabel(0, 12.5, 0)).toBe('0–13');
  });

  it('数值趋势：均值折线 + 条数柱状', () => {
    const option = obj(
      buildNumericTrendOption({
        granularity: 'day',
        points: [{ bucket: '2026-10-18', label: '10-18', count: 2, sum: 300, mean: 150.005, min: 100, max: 200 }],
      }),
    );
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.data).toEqual([2]);
    expect(series[1]?.data).toEqual([150.01]);
  });

  it('numericMetricsOf 输出全部指标并格式化离群值', () => {
    const metrics = numericMetricsOf(numeric, { key: 'a', label: '金额', type: 'currency', currency: 'CNY' } as FieldDefinition);
    expect(metrics.map((metric) => metric.key)).toEqual([
      'count',
      'sum',
      'mean',
      'median',
      'min',
      'max',
      'p25',
      'p75',
      'p90',
      'p95',
      'stddev',
      'range',
      'outliers',
    ]);
    expect(metrics.find((metric) => metric.key === 'sum')?.value).toBe('¥12,345.60');
    expect(metrics.find((metric) => metric.key === 'outliers')?.value).toBe('2 个');
    expect(numericMetricsOf(null)).toEqual([]);
    expect(numericMetricsOf({ ...numeric, count: 0 })).toEqual([]);
  });
});

describe('排行榜 / 标签 / 星期小时', () => {
  it('横向条形按降序保留前 N 项（y 轴倒序渲染）', () => {
    const option = obj(
      buildRankedBarOption(
        [
          { name: 'a', value: 5 },
          { name: 'b', value: 3 },
          { name: 'c', value: 1 },
        ],
        { limit: 2 },
      ),
    );
    expect(obj(option.yAxis).data).toEqual(['b', 'a']);
    expect((option.series as Array<Record<string, unknown>>)[0]?.data).toEqual([3, 5]);
  });

  it('tags / 空数据', () => {
    const option = obj(buildTagsOption([{ tag: '工作', count: 12, share: 0.3 }]));
    expect(obj(option.yAxis).data).toEqual(['工作']);
    expect(obj(buildTagsOption([])).title).toBeDefined();
  });

  it('星期与小时分布轴标签', () => {
    const weekday = obj(
      buildWeekdayOption({ buckets: [{ weekday: 1, label: '周一', count: 5 }, { weekday: 2, label: '周二', count: 0 }] }),
    );
    expect(obj(weekday.xAxis).data).toEqual(['周一', '周二']);

    const hour = obj(buildHourOption({ buckets: Array.from({ length: 24 }, (_, index) => ({ hour: index, count: index })) }));
    const labels = obj(hour.xAxis).data as string[];
    expect(labels).toHaveLength(24);
    expect(labels[0]).toBe('00');
    expect(labels[23]).toBe('23');
  });
});

describe('布尔 / 概览占比', () => {
  it('布尔占比环图与空数据', () => {
    const option = obj(buildBooleanOption({ trueCount: 12, falseCount: 28, trueRatio: 0.3 }));
    const series = (option.series as Array<Record<string, unknown>>)[0];
    expect(series?.type).toBe('pie');
    expect(series?.data).toEqual([
      { name: '是', value: 12 },
      { name: '否', value: 28 },
    ]);
    expect(obj(buildBooleanOption(null)).title).toBeDefined();
    expect(obj(buildBooleanOption({ trueCount: 0, falseCount: 0, trueRatio: 0 })).title).toBeDefined();
  });

  it('概览占比饼图过滤 0 条模板', () => {
    const option = obj(
      buildOverviewShareOption([
        { templateId: 't1', templateName: '每日开销', icon: '💰', count: 42, share: 0.3 },
        { templateId: null, templateName: '无模板', icon: '', count: 0, share: 0 },
      ]),
    );
    const series = (option.series as Array<Record<string, unknown>>)[0];
    expect(series?.data).toEqual([{ name: '💰 每日开销', value: 42 }]);
    expect(obj(buildOverviewShareOption([])).title).toBeDefined();
  });

  it('overviewNumericRank 按 sum 降序并加模板前缀', () => {
    const overview = {
      numericFields: [
        { templateId: 't1', templateName: 'A', key: 'a', label: '金额', type: 'currency', count: 1, sum: 10, mean: 10, median: 10, max: 10 },
        { templateId: 't2', templateName: 'B', key: 'b', label: '耗时', type: 'number', count: 1, sum: 99.456, mean: 99, median: 99, max: 99 },
      ],
    } as unknown as AnalyticsOverview;
    expect(overviewNumericRank(overview)).toEqual([
      { name: 'B·耗时', value: 99.46 },
      { name: 'A·金额', value: 10 },
    ]);
    expect(overviewNumericRank(null)).toEqual([]);
  });
});

describe('wordCloudSizes（用字号表意）', () => {
  it('最小/最大计数映射到字号区间', () => {
    const sized = wordCloudSizes(
      [
        { word: '复盘', count: 1 },
        { word: '学习', count: 5 },
        { word: '工作', count: 9 },
      ],
      { min: 12, max: 30 },
    );
    expect(sized[0]?.fontSize).toBe(12);
    expect(sized[1]?.fontSize).toBe(21);
    expect(sized[2]?.fontSize).toBe(30);
    expect(wordCloudSizes([])).toEqual([]);
    expect(wordCloudSizes([{ word: 'x', count: 3 }])[0]?.fontSize).toBe(30);
  });
});

describe('模板洞察结构 → option 组装（端到端形状）', () => {
  it('典型响应可组装出全部图表而不报错', () => {
    const insights = {
      timeline,
      heatmap: { max: 6, days: [{ date: '2026-10-18', count: 6 }] },
      weekday: { buckets: [{ weekday: 1, label: '周一', count: 3 }] },
      hourOfDay: { buckets: [{ hour: 9, count: 2 }] },
    } as unknown as TemplateInsights;

    expect(buildTimelineOption(insights.timeline)).toBeDefined();
    expect(buildCalendarHeatmapOption(insights.heatmap)).toBeDefined();
    expect(buildWeekdayOption(insights.weekday)).toBeDefined();
    expect(buildHourOption(insights.hourOfDay)).toBeDefined();
  });
});
