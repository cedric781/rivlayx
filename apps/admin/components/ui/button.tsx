'use client';
import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

/**
 * RivlayX shared Button primitive (admin).
 *
 * Token-driven, accessible, visual-parity with the admin console's existing
 * inline buttons (admin "primary" = `--rx-color-primary` blue, "danger" =
 * `--rx-color-danger-button`). Built-in hover/active/disabled/loading states.
 * Behaviour is a plain <button> — callers own onClick/type/form semantics.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '0.4rem 0.9rem', fontSize: 'var(--rx-font-size-sm)', borderRadius: 'var(--rx-radius-sm)' },
  md: { padding: '0.55rem 1.1rem', fontSize: 'var(--rx-font-size-base)', borderRadius: 'var(--rx-radius-md)' },
  lg: { padding: '0.7rem 1.4rem', fontSize: 'var(--rx-font-size-md)', borderRadius: 'var(--rx-radius-lg)' },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--rx-color-primary)',
    color: 'var(--rx-color-primary-contrast)',
    border: 'none',
  },
  secondary: {
    background: 'var(--rx-color-surface-2)',
    color: 'var(--rx-color-text)',
    border: '1px solid var(--rx-color-border)',
  },
  danger: {
    background: 'var(--rx-color-danger-button)',
    color: 'var(--rx-color-primary-contrast)',
    border: 'none',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--rx-color-primary)',
    border: '1px solid transparent',
  },
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--rx-space-2)',
  fontFamily: 'inherit',
  fontWeight: 600,
  lineHeight: 1,
  boxSizing: 'border-box',
  cursor: 'pointer',
};

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const isDisabled = disabled || loading;

  const stateStyle: CSSProperties = isDisabled
    ? {
        background: 'var(--rx-color-disabled-bg-dark)',
        borderColor: 'var(--rx-color-disabled-bg-dark)',
        cursor: 'not-allowed',
      }
    : { filter: active ? 'brightness(0.95)' : hover ? 'brightness(1.08)' : 'none' };

  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      style={{ ...BASE, ...SIZES[size], ...VARIANTS[variant], ...stateStyle, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}
