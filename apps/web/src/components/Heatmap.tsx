/**
 * GitHub 风格热力图（最近 N 周，5 档颜色，悬浮提示，点击某天回调）。
 * 格子尺寸由 `size` 决定（写入内联 CSS 变量 `--heat-cell`，样式表按变量排版）。
 */
import { buildHeatmapGrid } from '../lib/heatmap';

export interface HeatmapProps {
  days: ReadonlyArray<{ date: string; count: number }>;
  /** 周数，默认 12（首页侧栏） */
  weeks?: number;
  /** 今天（便于测试/固定区间） */
  today?: string;
  /** 格子边长（px），默认 12 */
  size?: number;
  onSelectDay?: (dayKey: string) => void;
}

const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日'];
const LEVEL_COLORS = ['#ededed', '#c9f0dd', '#8fe0b4', '#4fcf8b', '#30cf79'];

export default function Heatmap({
  days,
  weeks = 12,
  today,
  size = 12,
  onSelectDay,
}: HeatmapProps): JSX.Element {
  const grid = buildHeatmapGrid(days, today === undefined ? { weeks } : { weeks, today });

  return (
    <div className={`heatmap size-${size}`} style={{ ['--heat-cell' as string]: `${size}px` }}>
      <div className="heatmap-months" aria-hidden="true">
        {grid.weeks.map((_, column) => {
          const label = grid.monthLabels.find((item) => item.column === column);
          return (
            <span key={column} className="heatmap-month">
              {label?.label ?? ''}
            </span>
          );
        })}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="heatmap-grid">
          {grid.weeks.map((column, columnIndex) => (
            <div className="heatmap-col" key={columnIndex}>
              {column.map((cell) =>
                cell.inGrid ? (
                  <button
                    key={cell.date}
                    type="button"
                    className={`heatmap-cell l${cell.level}`}
                    title={cell.title}
                    aria-label={cell.title}
                    onClick={() => {
                      if (onSelectDay !== undefined) onSelectDay(cell.date);
                    }}
                  />
                ) : (
                  <span key={cell.date} className="heatmap-cell is-empty" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>少</span>
        {LEVEL_COLORS.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
        <span>多</span>
        <span className="spacer" />
        <span>
          {grid.activeDays} 天有记录 · {grid.total} 条
        </span>
      </div>
    </div>
  );
}
