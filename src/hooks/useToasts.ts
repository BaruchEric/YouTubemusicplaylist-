import { useCallback, useState } from 'react';

export type ToastTone = 'neutral' | 'success' | 'warning';

export interface ToastStat {
  label: string;
  value: number;
  prefix?: string;
  tone?: 'added' | 'missing' | 'reconnected' | 'neutral';
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: string;
  dedupeKey?: string;
  title: string;
  description?: string;
  stats?: ToastStat[];
  tone: ToastTone;
  durationMs: number;
  action?: ToastAction;
  createdAt: number;
}

export interface ToastInput {
  dedupeKey?: string;
  title: string;
  description?: string;
  stats?: ToastStat[];
  tone?: ToastTone;
  durationMs?: number;
  action?: ToastAction;
}

const DEFAULT_DURATION_MS = 4500;

export function useToasts(options?: { maxVisible?: number }) {
  const maxVisible = options?.maxVisible ?? 3;
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (input: ToastInput): string => {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const nextToast: ToastMessage = {
        id,
        dedupeKey: input.dedupeKey,
        title: input.title,
        description: input.description,
        stats: input.stats,
        tone: input.tone ?? 'neutral',
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
        action: input.action,
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        const filtered = input.dedupeKey
          ? prev.filter((item) => item.dedupeKey !== input.dedupeKey)
          : prev;
        return [...filtered, nextToast].slice(-maxVisible);
      });

      return id;
    },
    [maxVisible]
  );

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    pushToast,
    dismissToast,
    clearToasts,
  };
}
