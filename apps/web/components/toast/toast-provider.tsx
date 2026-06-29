'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  title?: string;
  /** Override auto-dismiss duration in ms. Use 0 to disable auto-dismiss. */
  durationMs?: number;
}

interface ToastRecord {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  durationMs: number;
}

interface ToastApi {
  notify: (opts: ToastOptions) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  dismiss: (id: number) => void;
}

/** Auto-dismiss timing per type. Errors persist longer than the rest. */
const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 9000,
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((opts: ToastOptions) => {
    const type = opts.type ?? 'info';
    nextId += 1;
    const record: ToastRecord = {
      id: nextId,
      type,
      message: opts.message,
      title: opts.title,
      durationMs: opts.durationMs ?? DEFAULT_DURATION_MS[type],
    };
    setToasts((prev) => [...prev, record]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (message, title) => notify({ type: 'success', message, title }),
      error: (message, title) => notify({ type: 'error', message, title }),
      warning: (message, title) => notify({ type: 'warning', message, title }),
      info: (message, title) => notify({ type: 'info', message, title }),
      dismiss,
    }),
    [notify, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const viewport: React.CSSProperties = {
  position: 'fixed',
  bottom: 'var(--rx-space-5)',
  right: 'var(--rx-space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--rx-space-3)',
  zIndex: 1000,
  maxWidth: 'min(360px, calc(100vw - 2rem))',
  pointerEvents: 'none',
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div aria-live="polite" aria-atomic="false" style={viewport}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/** Per-tone leading glyph; inherits the toast's foreground color. */
function ToastGlyph({ type }: { type: ToastType }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { flexShrink: 0, marginTop: 1 },
  };
  if (type === 'success') {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6M9 9l6 6" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

const PALETTE: Record<ToastType, { bg: string; fg: string }> = {
  success: { bg: 'var(--rx-color-success-surface)', fg: 'var(--rx-color-success-fg)' },
  error: { bg: 'var(--rx-color-danger-surface)', fg: 'var(--rx-color-danger-fg)' },
  warning: { bg: 'var(--rx-color-warning-surface)', fg: 'var(--rx-color-warning-fg)' },
  info: { bg: 'var(--rx-color-info-surface)', fg: 'var(--rx-color-info-fg)' },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  const { id, type, title, message, durationMs } = toast;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (durationMs <= 0) return;
    clearTimer();
    timer.current = setTimeout(() => onDismiss(id), durationMs);
  }, [durationMs, id, onDismiss, clearTimer]);

  // Start the auto-dismiss countdown; pause-on-hover restarts it via handlers.
  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const palette = PALETTE[type];

  return (
    <div
      role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      style={{
        pointerEvents: 'auto',
        background: palette.bg,
        color: palette.fg,
        border: '1px solid var(--rx-color-border)',
        borderRadius: 'var(--rx-radius-lg)',
        boxShadow: 'var(--rx-shadow-md)',
        padding: 'var(--rx-space-3) var(--rx-space-4)',
        display: 'flex',
        gap: 'var(--rx-space-3)',
        alignItems: 'flex-start',
      }}
    >
      <ToastGlyph type={type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <div
            style={{
              fontWeight: 600,
              fontSize: 'var(--rx-font-size-sm)',
              marginBottom: 2,
            }}
          >
            {title}
          </div>
        ) : null}
        <div style={{ fontSize: 'var(--rx-font-size-sm)', lineHeight: 'var(--rx-line-normal)' }}>
          {message}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 'var(--rx-font-size-md)',
          lineHeight: 1,
          opacity: 0.8,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
