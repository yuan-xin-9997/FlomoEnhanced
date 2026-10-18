/**
 * 高频词标签云（用字号表意，非 ECharts）。
 */
import { wordCloudSizes } from '../lib/chartOptions';

export interface WordCloudProps {
  words: ReadonlyArray<{ word: string; count: number }>;
  min?: number;
  max?: number;
  onSelectWord?: (word: string) => void;
}

export default function WordCloud({ words, min = 12, max = 30, onSelectWord }: WordCloudProps): JSX.Element {
  const sized = wordCloudSizes(words, { min, max });
  if (sized.length === 0) return <div className="viz-empty" style={{ minHeight: 120 }}>该区间内暂无数据</div>;

  return (
    <div className="wordcloud">
      {sized.map((item) => (
        <button
          key={item.word}
          type="button"
          className="wordcloud-word"
          style={{ fontSize: item.fontSize, cursor: onSelectWord === undefined ? 'default' : 'pointer' }}
          title={`${item.word} · ${item.count} 次`}
          onClick={() => {
            if (onSelectWord !== undefined) onSelectWord(item.word);
          }}
        >
          {item.word}
          <span className="muted small"> {item.count}</span>
        </button>
      ))}
    </div>
  );
}
