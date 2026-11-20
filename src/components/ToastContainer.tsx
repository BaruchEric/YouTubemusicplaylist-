import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderSync, X } from 'lucide-react';
import type { ToastMessage, ToastStat } from '../hooks/useToasts';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  hasMiniPlayer?: boolean;
}

function getStatColorClass(tone?: ToastStat['tone']): string {
  switch (tone) {
    case 'added':
      return 'text-[#22C55E]';
    case 'missing':
      return 'text-[#F59E0B]';
    case 'reconnected':
      return 'text-[#60A5FA]';
    default:
      return 'text-[#9CA3AF]';
  }
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef(toast.durationMs);
  const startedAtRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const exitingRef = useRef(false);

  const triggerClose = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setVisible(false);
    exitTimerRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 180);
  }, [onDismiss, toast.id]);

  // Smooth mount entrance
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setVisible(true));
    return () => {
      window.cancelAnimationFrame(raf);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  // Auto-dismiss countdown that pauses cleanly on pointer hover
  useEffect(() => {
    if (toast.durationMs <= 0 || isPaused || exitingRef.current) return;

    startedAtRef.current = Date.now();
    dismissTimerRef.current = window.setTimeout(() => {
      triggerClose();
    }, Math.max(200, remainingRef.current));

    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      if (startedAtRef.current !== null) {
        const elapsed = Date.now() - startedAtRef.current;
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        startedAtRef.current = null;
      }
    };
  }, [isPaused, toast.durationMs, triggerClose]);

  const accentBarClass =
    toast.tone === 'success'
      ? 'bg-[#22C55E]'
      : toast.tone === 'warning'
        ? 'bg-[#F59E0B]'
        : 'bg-white/25';

  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'warning'
        ? AlertTriangle
        : FolderSync;

  const iconColorClass =
    toast.tone === 'success'
      ? 'text-[#22C55E]'
      : toast.tone === 'warning'
        ? 'text-[#F59E0B]'
        : 'text-[#8B92A2]';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`pointer-events-auto relative flex rounded-lg bg-[#151820]/95 backdrop-blur-md border border-white/[0.11] shadow-[0_12px_28px_rgba(0,0,0,0.48)] overflow-hidden transition-all duration-200 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      {/* Subtle tone hairline */}
      <div className={`w-[2.5px] shrink-0 ${accentBarClass}`} aria-hidden="true" />

      <div className="flex-1 min-w-0 px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5 min-w-0">
            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${iconColorClass}`} />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white leading-snug truncate">
                {toast.title}
              </div>

              {toast.description && (
                <div className="text-[11px] text-[#8B92A2] leading-snug truncate mt-0.5">
                  {toast.description}
                </div>
              )}

              {toast.stats && toast.stats.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] font-mono tabular-nums">
                  {toast.stats.map((stat, idx) => (
                    <span key={`${stat.label}-${idx}`} className="inline-flex items-center gap-1">
                      {idx > 0 && (
                        <span className="text-[#4B5563] mr-1" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className={`font-medium ${getStatColorClass(stat.tone)}`}>
                        {stat.prefix ?? ''}
                        {stat.value}
                      </span>
                      <span className="text-[#9CA3AF] font-sans">{stat.label}</span>
                    </span>
                  ))}
                </div>
              )}

              {toast.action && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      triggerClose();
                    }}
                    className="text-[11px] font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
                  >
                    {toast.action.label}
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={triggerClose}
            aria-label="Dismiss notification"
            className="p-0.5 -mr-1 -mt-0.5 rounded text-[#6B7280] hover:text-white transition-colors shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
  hasMiniPlayer = false,
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Background scan notifications"
      className={`fixed right-4 sm:right-6 z-50 flex flex-col gap-2 w-[332px] max-w-[calc(100vw-2rem)] pointer-events-none transition-[bottom] duration-200 ${
        hasMiniPlayer ? 'bottom-[90px]' : 'bottom-5'
      }`}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
