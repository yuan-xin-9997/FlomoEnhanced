/**
 * 全局 toast（网络错误统一提示）。
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastKind = 'info' | 'ok' | 'error';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastValue {
  push: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const serial = useRef(0);

  const push = useCallback((message: string, kind: ToastKind = 'info'): void => {
    if (message.trim() === '') return;
    serial.current += 1;
    const id = serial.current;
    setItems((previous) => [...previous, { id, message, kind }]);
    window.setTimeout(() => {
      setItems((previous) => previous.filter((item) => item.id !== id));
    }, 4_200);
  }, []);

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (message: string) => push(message, 'ok'),
      error: (message: string) => push(message, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 读取 toast 能力（必须在 ToastProvider 内使用） */
export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (value === null) throw new Error('useToast 必须在 ToastProvider 内部使用');
  return value;
}
