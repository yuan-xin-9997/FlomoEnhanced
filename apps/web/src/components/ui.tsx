/**
 * 通用小部件：加载态、骨架屏、空状态、错误框、弹层、指标卡。
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';

/** 加载中文字提示 */
export function Loading({ text = '加载中…' }: { text?: string }): JSX.Element {
  return <div className="loading-text">{text}</div>;
}

/** 骨架屏列表 */
export function SkeletonList({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

/** 空状态（中文可读） */
export function EmptyState({ icon = '📭', title, hint }: { icon?: string; title: string; hint?: string }): JSX.Element {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <div>{title}</div>
      {hint !== undefined && <div className="small mt-8">{hint}</div>}
    </div>
  );
}

/** 错误框（可重试） */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry !== undefined && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

/** 弹层（Esc 关闭、点击遮罩关闭） */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size === 'lg' ? 'modal-lg' : 'modal-md'}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
        {footer !== undefined && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** 指标卡 */
export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }): JSX.Element {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub !== undefined && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** 图表容器（标题 + 空状态） */
export function Viz({
  title,
  sub,
  empty,
  span2,
  height = 240,
  children,
}: {
  title: string;
  sub?: string;
  /** 是否显示空状态（为 true 时不渲染 children） */
  empty?: boolean;
  span2?: boolean;
  height?: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={span2 === true ? 'viz viz-span2' : 'viz'}>
      <div className="viz-title">{title}</div>
      {sub !== undefined && <div className="viz-sub">{sub}</div>}
      {empty === true ? (
        <div className="viz-empty" style={{ minHeight: height }}>
          该区间内暂无数据
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** 标签切换组 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
}): JSX.Element {
  return (
    <div className="segmented" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={item.key === value ? 'active' : ''}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
