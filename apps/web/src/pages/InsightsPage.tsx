/**
 * 洞察页（/insights）：模板选择 + 快捷区间 + 概览 / 模板洞察图表 + CSV 导出。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Template } from '@flomo/shared';
import { analyticsApi, errorMessage, templatesApi } from '../api/client';
import EChart from '../components/EChart';
import FieldInsightCard, { NumericFieldRankViz } from '../components/FieldInsightCard';
import WordCloud from '../components/WordCloud';
import { EmptyState, ErrorBox, Kpi, Loading, Segmented, Viz } from '../components/ui';
import {
  buildCalendarHeatmapOption,
  buildHourOption,
  buildOverviewShareOption,
  buildTagsOption,
  buildTimelineOption,
  buildWeekdayOption,
  overviewNumericRank,
} from '../lib/chartOptions';
import type { AnalyticsOverview, TemplateInsights } from '../lib/analyticsTypes';
import { RANGE_PRESETS, dayEndIso, dayStartIso, rangeForPreset, rangeLabel, todayKey, validateRange } from '../lib/dates';
import type { DayRange, RangePreset } from '../lib/dates';
import { csvFallbackName } from '../lib/memoQuery';
import { formatCount, formatDateTime, formatRatio } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useToast } from '../state/toast';

const GRANULARITY_TEXT: Record<string, string> = { day: '按天', week: '按周', month: '按月' };

export default function InsightsPage(): JSX.Element {
  useDocumentTitle('洞察');
  const toast = useToast();
  const todayRef = useRef(todayKey());

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [customRange, setCustomRange] = useState<DayRange>(() => rangeForPreset('30d', todayKey()));
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [insights, setInsights] = useState<TemplateInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const range = useMemo<DayRange>(
    () => (preset === 'custom' ? customRange : rangeForPreset(preset, todayRef.current)),
    [preset, customRange],
  );
  const rangeError = validateRange(range);

  useEffect(() => {
    void (async () => {
      try {
        const response = await templatesApi.list(true);
        setTemplates(response.items);
      } catch (templatesError) {
        toast.error(errorMessage(templatesError));
      }
    })();
  }, [toast]);

  const load = useCallback(async (): Promise<void> => {
    if (rangeError !== null) {
      setError(rangeError);
      return;
    }
    setLoading(true);
    setError('');
    const params = { from: dayStartIso(range.from), to: dayEndIso(range.to) };
    try {
      if (templateId === '') {
        setInsights(null);
        setOverview(await analyticsApi.overview(params));
      } else {
        setOverview(null);
        setInsights(await analyticsApi.templateInsights(templateId, params));
      }
    } catch (loadError) {
      setOverview(null);
      setInsights(null);
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, templateId, rangeError]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPresetChange = (next: RangePreset): void => {
    if (next === 'custom') setCustomRange(range);
    setPreset(next);
  };

  const onExportCsv = async (): Promise<void> => {
    if (insights === null) return;
    setExporting(true);
    try {
      await analyticsApi.exportCsv(
        insights.template.id,
        { from: dayStartIso(range.from), to: dayEndIso(range.to) },
        csvFallbackName(insights.template.name, todayRef.current),
      );
      toast.success('CSV 已开始下载');
    } catch (exportError) {
      toast.error(errorMessage(exportError));
    } finally {
      setExporting(false);
    }
  };

  const activeRangeLabel =
    insights?.range.label ?? overview?.range.label ?? rangeLabel(preset, range);
  const granularity = insights?.range.granularity ?? overview?.range.granularity ?? 'day';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">洞察</h1>
          <p className="page-sub">
            {activeRangeLabel} · {GRANULARITY_TEXT[granularity] ?? granularity} ·{' '}
            {formatCount(insights?.summary.memoCount ?? overview?.summary.memoCount ?? 0)} 条记录
          </p>
        </div>
        <div className="row">
          <select
            className="select"
            style={{ width: 200 }}
            value={templateId}
            aria-label="选择模板"
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">全部模板（概览）</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.icon} {template.name}
                {template.archivedAt === null ? '' : '（已归档）'}
              </option>
            ))}
          </select>
          {templateId !== '' && (
            <button type="button" className="btn" disabled={exporting || insights === null} onClick={() => void onExportCsv()}>
              {exporting ? '导出中…' : '导出 CSV'}
            </button>
          )}
        </div>
      </div>

      <div className="card mb-16">
        <div className="row-between">
          <Segmented items={RANGE_PRESETS} value={preset} onChange={onPresetChange} />
          {preset === 'custom' && (
            <div className="row">
              <input
                className="input"
                type="date"
                value={customRange.from}
                aria-label="开始日期"
                onChange={(event) => setCustomRange((previous) => ({ ...previous, from: event.target.value }))}
              />
              <span className="muted">~</span>
              <input
                className="input"
                type="date"
                value={customRange.to}
                aria-label="结束日期"
                onChange={(event) => setCustomRange((previous) => ({ ...previous, to: event.target.value }))}
              />
            </div>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
            刷新
          </button>
        </div>
        <div className="small muted mt-8">
          实际查询区间：{range.from} ~ {range.to}（{formatCount(insights?.range.days ?? overview?.range.days ?? 0)} 天）
          {insights !== null && ` · 统计耗时 ${formatCount(insights.tookMs)} ms`}
        </div>
      </div>

      {error !== '' && <div className="mb-16"><ErrorBox message={error} onRetry={() => void load()} /></div>}

      {loading ? (
        <Loading text="正在统计…" />
      ) : templateId === '' ? (
        overview === null ? (
          <div className="card">
            <EmptyState icon="📊" title="暂时没有可展示的概览数据" hint="先记录一些想法再回来看看。" />
          </div>
        ) : (
          <OverviewPanel overview={overview} />
        )
      ) : insights === null ? (
        <div className="card">
          <EmptyState icon="📊" title="暂时没有可展示的统计数据" hint="换个区间或模板试试。" />
        </div>
      ) : (
        <TemplatePanel insights={insights} />
      )}
    </div>
  );
}

/* ------------------------------ 概览 ------------------------------ */

function OverviewPanel({ overview }: { overview: AnalyticsOverview }): JSX.Element {
  const { summary } = overview;
  return (
    <div className="stack">
      <div className="kpi-grid">
        <Kpi label="想法总数" value={formatCount(summary.memoCount)} />
        <Kpi label="使用模板数" value={formatCount(summary.templateCount)} />
        <Kpi
          label="活跃天数"
          value={formatCount(summary.activeDays)}
          sub={`区间覆盖率 ${formatRatio(summary.dayCoverage)}`}
        />
        <Kpi label="当前连续" value={`${formatCount(summary.currentStreak)} 天`} sub={`最长 ${formatCount(summary.longestStreak)} 天`} />
        <Kpi label="总字数" value={formatCount(summary.totalChars)} sub={`平均 ${formatCount(summary.avgChars)} 字/条`} />
      </div>

      <div className="viz-grid">
        <Viz title="各模板记录占比" empty={summary.byTemplate.length === 0}>
          <EChart option={buildOverviewShareOption(summary.byTemplate)} height={260} />
        </Viz>
        <Viz title="记录趋势（条数 + 字数）" empty={overview.timeline.points.length === 0}>
          <EChart option={buildTimelineOption(overview.timeline)} height={260} />
        </Viz>

        <Viz title="记录热力图" empty={overview.heatmap.days.length === 0} span2 height={210}>
          <EChart option={buildCalendarHeatmapOption(overview.heatmap)} height={210} />
        </Viz>

        <Viz title="星期分布" empty={overview.weekday.buckets.length === 0}>
          <EChart option={buildWeekdayOption(overview.weekday)} height={220} />
        </Viz>
        <Viz title="时段分布（24 小时）" empty={overview.hourOfDay.buckets.length === 0}>
          <EChart option={buildHourOption(overview.hourOfDay)} height={220} />
        </Viz>

        <Viz title="标签 Top 20" empty={overview.tags.length === 0} height={Math.max(200, Math.min(20, overview.tags.length) * 24)}>
          <EChart
            option={buildTagsOption(overview.tags)}
            height={Math.max(200, Math.min(20, overview.tags.length) * 24)}
          />
        </Viz>
        <NumericFieldRankViz items={overviewNumericRank(overview)} />

        <Viz title="标签云" sub="字号代表出现次数" empty={overview.tags.length === 0} span2>
          <WordCloud words={overview.tags.map((tag) => ({ word: `#${tag.tag}`, count: tag.count }))} />
        </Viz>
      </div>
    </div>
  );
}

/* ------------------------------ 模板洞察 ------------------------------ */

function TemplatePanel({ insights }: { insights: TemplateInsights }): JSX.Element {
  const { summary, template } = insights;

  return (
    <div className="stack">
      {summary.memoCount === 0 && (
        <div className="notice notice-warn">
          该区间内暂无使用「{template.name}」的记录，图表均为空状态。可以换个区间，或先去
          <Link to="/"> 记录 </Link>几条。
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="该模板记录数" value={formatCount(summary.memoCount)} sub={`占全部想法 ${formatRatio(summary.shareOfAllMemos)}`} />
        <Kpi label="全部想法数" value={formatCount(summary.allMemoCount)} sub={`共 ${formatCount(summary.memosWithContent)} 条有文字内容`} />
        <Kpi label="总字数" value={formatCount(summary.totalChars)} sub={`平均 ${formatCount(summary.avgChars)} 字/条`} />
        <Kpi label="活跃天数" value={formatCount(summary.activeDays)} sub={`区间覆盖率 ${formatRatio(summary.dayCoverage)}`} />
        <Kpi label="当前连续" value={`${formatCount(summary.currentStreak)} 天`} sub={`最长 ${formatCount(summary.longestStreak)} 天`} />
        <Kpi
          label="最忙一天"
          value={summary.busiestDay === null ? '—' : summary.busiestDay.date}
          sub={summary.busiestDay === null ? '暂无记录' : `${summary.busiestDay.count} 条`}
        />
        <Kpi label="首次记录" value={summary.firstMemoAt === null ? '—' : summary.firstMemoAt.slice(0, 10)} />
        <Kpi label="最近记录" value={summary.lastMemoAt === null ? '—' : formatDateTime(summary.lastMemoAt)} />
      </div>

      <div className="viz-grid">
        <Viz title="记录趋势（条数 + 字数）" empty={insights.timeline.points.length === 0}>
          <EChart option={buildTimelineOption(insights.timeline)} height={260} />
        </Viz>
        <Viz title="标签 Top" empty={insights.tags.length === 0} height={Math.max(200, Math.min(20, insights.tags.length) * 24)}>
          <EChart option={buildTagsOption(insights.tags)} height={Math.max(200, Math.min(20, insights.tags.length) * 24)} />
        </Viz>

        <Viz title="记录热力图" empty={insights.heatmap.days.length === 0} span2 height={210}>
          <EChart option={buildCalendarHeatmapOption(insights.heatmap)} height={210} />
        </Viz>

        <Viz title="星期分布" empty={insights.weekday.buckets.length === 0}>
          <EChart option={buildWeekdayOption(insights.weekday)} height={220} />
        </Viz>
        <Viz title="时段分布（24 小时）" empty={insights.hourOfDay.buckets.length === 0}>
          <EChart option={buildHourOption(insights.hourOfDay)} height={220} />
        </Viz>
      </div>

      <div className="card">
        <div className="card-title">
          <span>字段填写率</span>
          <small>共 {insights.fields.length} 个字段</small>
        </div>
        {insights.fields.length === 0 ? (
          <div className="viz-empty">该模板还没有定义字段</div>
        ) : (
          <div className="memo-values">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>字段</th>
                  <th>有值</th>
                  <th>缺失</th>
                  <th>填写率</th>
                </tr>
              </thead>
              <tbody>
                {insights.fields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      {field.label} <span className="muted small mono">{field.key}</span>
                    </td>
                    <td>{formatCount(field.filled)}</td>
                    <td>{formatCount(field.missing)}</td>
                    <td>{formatRatio(field.fillRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {insights.fields.map((field) => (
        <FieldInsightCard
          key={field.key}
          insight={field}
          def={template.fields.find((def) => def.key === field.key)}
        />
      ))}
    </div>
  );
}
