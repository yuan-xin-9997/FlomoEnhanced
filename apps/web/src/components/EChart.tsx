/**
 * ECharts 封装：负责实例生命周期、resize 监听、setOption 更新与 dispose。
 * 仅按需注册用到的图表与组件，避免整包引入。
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { EChartsType } from 'echarts/core';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CalendarComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

type SetOptionArg = Parameters<EChartsType['setOption']>[0];

export interface EChartProps {
  option: EChartsOption;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

export default function EChart({ option, height = 240, className, ariaLabel }: EChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return undefined;

    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => chart.resize());
    observer?.observe(element);
    const onWindowResize = (): void => chart.resize();
    window.addEventListener('resize', onWindowResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null || chart === undefined) return;
    // notMerge = true：切换模板/区间时彻底替换旧配置，避免残留系列
    chart.setOption(option as unknown as SetOptionArg, true);
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={className === undefined ? 'chart' : `chart ${className}`}
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? '统计图表'}
    />
  );
}
