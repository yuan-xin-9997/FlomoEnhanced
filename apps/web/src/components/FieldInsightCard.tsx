/**
 * 单个字段的洞察卡片：填写率 + 按字段类型渲染的图表。
 */
import type { FieldDefinition } from '@flomo/shared';
import EChart from './EChart';
import WordCloud from './WordCloud';
import { Kpi, Viz } from './ui';
import {
  buildBooleanOption,
  buildDateBucketsOption,
  buildDateHourOption,
  buildDateWeekdayOption,
  buildDistributionOption,
  buildNumericHistogramOption,
  buildNumericTrendOption,
  buildRatingOption,
  buildTextHistogramOption,
  buildUrlDomainsOption,
  buildRankedBarOption,
  fillDistribution,
  numericMetricsOf,
} from '../lib/chartOptions';
import { formatCount, formatRatio } from '../lib/format';
import type { FieldInsight } from '../lib/analyticsTypes';

export interface FieldInsightCardProps {
  insight: FieldInsight;
  /** 模板字段定义（提供 options / precision / currency） */
  def?: FieldDefinition;
}

export default function FieldInsightCard({ insight, def }: FieldInsightCardProps): JSX.Element {
  const hasNumeric = insight.numeric !== null && insight.numeric !== undefined && insight.numeric.count > 0;
  const distribution = fillDistribution(insight.distribution, def, insight.valueUnion);
  const hasDistribution = distribution.some((point) => point.count > 0);
  const hasBoolean = insight.boolean !== null && insight.boolean !== undefined && insight.boolean.trueCount + insight.boolean.falseCount > 0;
  const dateStats = insight.date ?? null;
  const hasDate = dateStats !== null && dateStats.byMonth.length > 0;
  const textStats = insight.text ?? null;
  const hasText = textStats !== null && textStats.topWords.length > 0;
  const urlStats = insight.url ?? null;
  const hasUrl = urlStats !== null && urlStats.distinctDomains.length > 0;

  const nothingToRender =
    !hasNumeric && !hasDistribution && !hasBoolean && !hasDate && !hasText && !hasUrl;

  return (
    <section className="card">
      <div className="card-title">
        <span>
          {insight.label} <small>{insight.type}</small>
        </span>
        <span className="row small muted">
          <span>
            填写率 {formatRatio(insight.fillRatio)}（{formatCount(insight.filled)} 有值 / {formatCount(insight.missing)} 缺失）
          </span>
        </span>
      </div>

      <div className="stack">
        {/* 数值型：指标卡 + 直方图 + 趋势 */}
        {hasNumeric && insight.numeric !== null && insight.numeric !== undefined && (
          <>
            <div className="kpi-grid">
              {numericMetricsOf(insight.numeric, def).map((metric) => (
                <Kpi key={metric.key} label={metric.label} value={metric.value} />
              ))}
            </div>
            <div className="viz-grid">
              <Viz title="数值分布（直方图）" empty={insight.numeric.histogram.bins.length === 0}>
                <EChart option={buildNumericHistogramOption(insight.numeric, def)} height={220} />
              </Viz>
              <Viz title="数值趋势（条数 + 均值）" empty={(insight.trend?.points ?? []).length === 0}>
                <EChart option={buildNumericTrendOption(insight.trend, def)} height={220} />
              </Viz>
            </div>
          </>
        )}

        {/* 单选 / 多选：分布 */}
        {(insight.type === 'select' || insight.type === 'multiselect') && (
          <Viz
            title={insight.type === 'select' ? '选项分布' : '选项分布（一条可多选）'}
            sub={insight.type === 'multiselect' ? '占比分母为该字段被引用的总次数' : undefined}
            empty={!hasDistribution}
            height={240}
          >
            <EChart option={buildDistributionOption(distribution)} height={240} />
          </Viz>
        )}

        {/* 评分：分布柱状（numeric 已在上方展示） */}
        {insight.type === 'rating' && (
          <Viz title="评分分布" empty={!hasDistribution} height={220}>
            <EChart option={buildRatingOption(insight.distribution, def)} height={220} />
          </Viz>
        )}

        {/* 布尔：占比环图 */}
        {insight.type === 'boolean' && (
          <Viz title="是 / 否占比" empty={!hasBoolean} height={220}>
            <EChart option={buildBooleanOption(insight.boolean)} height={220} />
          </Viz>
        )}

        {/* 日期 / 日期时间 */}
        {(insight.type === 'date' || insight.type === 'datetime') && (
          <div className="viz-grid">
            <Viz title="按月分布" empty={!hasDate}>
              <EChart option={buildDateBucketsOption(dateStats)} height={220} />
            </Viz>
            <Viz title="按星期分布" empty={dateStats === null || dateStats.byWeekday.length === 0}>
              <EChart option={buildDateWeekdayOption(dateStats)} height={220} />
            </Viz>
            {insight.type === 'datetime' && (
              <Viz title="按小时分布" span2 empty={dateStats?.byHour === undefined || dateStats.byHour.length === 0}>
                <EChart option={buildDateHourOption(dateStats)} height={200} />
              </Viz>
            )}
            {dateStats !== null && (
              <div className="viz viz-span2">
                <div className="row small muted">
                  <span>
                    最早 {dateStats.min === '' ? '—' : dateStats.min} · 最晚 {dateStats.max === '' ? '—' : dateStats.max} ·
                    跨度 {formatCount(dateStats.spanDays)} 天
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 文本：字数直方图 + 词云 */}
        {(insight.type === 'text' || insight.type === 'longtext') && (
          <div className="viz-grid">
            <Viz title="字数分布" empty={textStats === null || textStats.histogram.bins.length === 0}>
              <EChart option={buildTextHistogramOption(textStats)} height={220} />
            </Viz>
            <Viz
              title="高频词"
              sub={textStats?.topWordsNote ?? '字号越大出现次数越多'}
              empty={!hasText}
            >
              <WordCloud words={textStats?.topWords ?? []} />
            </Viz>
            {textStats !== null && (
              <div className="viz viz-span2">
                <div className="row small muted">
                  <span>
                    总字数 {formatCount(textStats.totalChars)} · 平均 {formatCount(textStats.avgChars)} · 最短{' '}
                    {formatCount(textStats.minChars)} · 最长 {formatCount(textStats.maxChars)} · 中位{' '}
                    {formatCount(textStats.medianChars)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 链接：域名 Top + https 占比 */}
        {insight.type === 'url' && (
          <div className="viz-grid">
            <Viz title="域名 Top" empty={!hasUrl} height={240}>
              <EChart option={buildUrlDomainsOption(urlStats)} height={240} />
            </Viz>
            <Viz title="链接概览" empty={urlStats === null}>
              <div className="kpi-grid">
                <Kpi label="不同域名" value={formatCount(urlStats?.distinctCount ?? 0)} />
                <Kpi label="HTTPS 占比" value={formatRatio(urlStats?.httpsRatio ?? 0)} />
                <Kpi label="链接条数" value={formatCount(insight.filled)} />
              </div>
            </Viz>
          </div>
        )}

        {nothingToRender && <div className="viz-empty">该区间内暂无该字段的数据</div>}

        {/* 分布明细表（选择型 / 评分） */}
        {hasDistribution && (insight.type === 'select' || insight.type === 'multiselect') && (
          <div className="memo-values">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '50%' }}>选项</th>
                  <th>条数</th>
                  <th>占比</th>
                </tr>
              </thead>
              <tbody>
                {distribution.map((point) => (
                  <tr key={point.value}>
                    <td>{point.label}</td>
                    <td>{formatCount(point.count)}</td>
                    <td>{formatRatio(point.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** 概览页：跨模板数值字段排行（独立小图，避免概览页结构过长） */
export function NumericFieldRankViz({ items }: { items: Array<{ name: string; value: number }> }): JSX.Element {
  return (
    <Viz title="数值字段合计排行" sub="跨模板汇总，取前 15" empty={items.length === 0} height={Math.max(200, items.length * 26)}>
      <EChart option={buildRankedBarOption(items, { limit: 15, color: '#9b8cf9' })} height={Math.max(200, items.length * 26)} />
    </Viz>
  );
}
