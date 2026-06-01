import { useEffect, useRef, useState } from 'react';
import type { ToastPayload } from '@shared/ipc';

interface ToastState extends ToastPayload {
  id: number;
}

const DISMISS_MS = 3500;

export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = window.ledge.onToast((payload) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      idRef.current += 1;
      setToast({ ...payload, id: idRef.current });
      timerRef.current = setTimeout(() => {
        setToast((current) => (current?.id === idRef.current ? null : current));
      }, DISMISS_MS);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!toast) {
    return null;
  }

  return (
    <div className={`toast-host is-${toast.kind}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}
