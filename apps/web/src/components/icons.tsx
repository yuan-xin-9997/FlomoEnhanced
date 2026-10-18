/**
 * 线性图标集（统一 24×24 viewBox、`currentColor` 描边）。
 * 用法：`<Icon name="search" />`，尺寸由 CSS 的 `width/height` 或 `size` 决定。
 */
export type IconName =
  | 'pen'
  | 'grid'
  | 'chart'
  | 'settings'
  | 'search'
  | 'filter'
  | 'send'
  | 'hash'
  | 'chevron-down'
  | 'logout'
  | 'refresh'
  | 'plus'
  | 'tag';

const PATHS: Record<IconName, JSX.Element> = {
  pen: (
    <>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20Z" />
      <path d="M13.5 6.5 17.5 10.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6" />
      <path d="M12 20V6" />
      <path d="M17 20v-9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.6l1.9 1.1M17.2 15.3l1.9 1.1M4.9 16.4l1.9-1.1M17.2 8.7l1.9-1.1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  filter: <path d="M4 6h16l-6.2 7.3V19l-3.6-2v-3.7L4 6Z" />,
  send: <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />,
  hash: (
    <>
      <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />
    </>
  ),
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  logout: (
    <>
      <path d="M15 5.5V4.8A1.8 1.8 0 0 0 13.2 3H6.3A1.8 1.8 0 0 0 4.5 4.8v14.4A1.8 1.8 0 0 0 6.3 21h6.9a1.8 1.8 0 0 0 1.8-1.8v-.7" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 0 0 6.3 6.6L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 12.5a8 8 0 0 0 13.7 4.9L20 15" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  tag: (
    <>
      <path d="M4.5 10.8V4.5h6.3l9 9-6.3 6.3-9-9Z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** 像素尺寸（宽高相同），默认 16 */
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
