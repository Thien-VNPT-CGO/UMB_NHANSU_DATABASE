import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type PushToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<PushToast>(() => undefined);

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(item => item.id !== id));
  }, []);

  const push = useCallback<PushToast>((message, tone = 'success') => {
    const id = nextId.current++;
    setToasts(current => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === 'error' ? 6500 : 4200);
  }, [dismiss]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(item => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            <span className="toast-icon">
              {item.tone === 'success' ? <CheckCircle2 size={18} /> : item.tone === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
            </span>
            <span className="toast-message">{item.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="Đóng thông báo">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
