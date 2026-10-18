/**
 * GitHub 风格热力图（最近 N 周，5 档颜色，悬浮提示，点击某天回调）。
 */
import { buildHeatmapGrid } from '../lib/heatmap';

export interface HeatmapProps {
  days: ReadonlyArray<{ date: string; count: number }>;
  /** 周数，默认 12（首页侧栏） */
  weeks?: number;
  /** 今天（便于测试/固定区间） */
  today?: string;
  onSelectDay?: (dayKey: string) => void;
}

const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日'];

export default function Heatmap({ days, weeks = 12, today, onSelectDay }: HeatmapProps): JSX.Element {
  const grid = buildHeatmapGrid(days, today === undefined ? { weeks } : { weeks, today });

  return (
    <div>
      <div className="heatmap-months" aria-hidden="true">
        {grid.weeks.map((_, column) => {
          const label = grid.monthLabels.find((item) => item.column === column);
          return (
            <span key={column} style={{ width: 12 }}>
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
                  <span key={cell.date} className="heatmap-cell empty" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>少</span>
        <i style={{ background: '#ece7df' }} />
        <i style={{ background: '#c6e3cf' }} />
        <i style={{ background: '#86c99c' }} />
        <i style={{ background: '#43a86a' }} />
        <i style={{ background: '#1f7a45' }} />
        <span>多</span>
        <span className="spacer" />
        <span>
          {grid.activeDays} 天有记录 · {grid.total} 条
        </span>
      </div>
    </div>
  );
}
