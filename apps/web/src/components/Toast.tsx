'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
  error: boolean;
}

type Push = (message: string, opts?: { error?: boolean }) => void;
const ToastContext = createContext<Push>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));

  const push = useCallback<Push>((message, opts) => {
    const id = Date.now() + Math.random();
    const error = !!opts?.error;
    setItems((l) => [...l, { id, message, error }]);
    // 오류 토스트는 닫기 전까지 유지, 일반 토스트는 4초
    if (!error) setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            <span>{t.message}</span>
            {t.error && (
              <button className="btn ghost sm icon" aria-label="닫기" onClick={() => dismiss(t.id)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
