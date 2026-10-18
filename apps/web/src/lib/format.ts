/**
 * 前端展示格式化工具（A4 可直接复用/扩展）。
 * 说明：字段级格式化（金额、百分比、选择项 label）请优先使用 `@flomo/shared` 的 `formatFieldValue`。
 */

/** 数字千分位 + 指定小数位 */
export function formatNumber(value: number | null | undefined, precision = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const digits = Math.min(Math.max(precision, 0), 6);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** 0..1 的比率 → 百分数字符串（默认 1 位小数） */
export function formatRatio(ratio: number | null | undefined, precision = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '';
  return `${formatNumber(ratio * 100, precision)}%`;
}

/** 整数计数（空值显示 0） */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('zh-CN').format(value);
}

/** 本地短日期 `YYYY-MM-DD` → `MM-DD` */
export function formatShortDay(dayKey: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey.slice(5) : dayKey;
}

/** UTC ISO → 本地 `YYYY-MM-DD HH:mm` */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** UTC ISO → 本地相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前） */
export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const diffSec = Math.max(0, Math.floor((now - time) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86_400 * 30) return `${Math.floor(diffSec / 86_400)} 天前`;
  return formatDateTime(iso).slice(0, 10);
}

/** 文件名安全化（导出 CSV / 模板文件用） */
export function safeFileName(name: string, fallback = 'flomo'): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return cleaned === '' ? fallback : cleaned;
}
