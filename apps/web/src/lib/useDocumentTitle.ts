/**
 * 设置 document.title（中文文案）。
 */
import { useEffect } from 'react';

const APP_NAME = '浮墨增强版';

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title === undefined || title === '' ? APP_NAME : `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
