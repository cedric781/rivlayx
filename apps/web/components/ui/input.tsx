'use client';
import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * RivlayX shared Input primitive (web).
 *
 * Label + helper/error text with proper id / aria-describedby / aria-invalid
 * wiring, token-driven styling, and disabled/required/error states. `hideLabel`
 * keeps the label for assistive tech while hiding it visually (e.g. inline
 * fields). All native input props pass through unchanged.
 */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  fullWidth?: boolean;
  /** Visually hide the label (kept for screen readers). */
  hideLabel?: boolean;
  id?: string;
  /** Style for the wrapping element (e.g. flex sizing in inline rows). */
  containerStyle?: CSSProperties;
}

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const LABEL: CSSProperties = {
  display: 'block',
  marginBottom: 'var(--rx-space-1)',
  fontSize: 'var(--rx-font-size-sm)',
  fontWeight: 600,
  color: 'var(--rx-color-paper-ink)',
};

const INPUT_BASE: CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  borderRadius: 'var(--rx-radius-lg)',
  border: '1px solid var(--rx-color-paper-border)',
  fontSize: 'var(--rx-font-size-base)',
  fontFamily: 'inherit',
  background: 'var(--rx-color-paper)',
  color: 'var(--rx-color-paper-ink)',
  boxSizing: 'border-box',
};

export function Input({
  label,
  helperText,
  error,
  required,
  fullWidth = true,
  hideLabel = false,
  id,
  containerStyle,
  style,
  disabled,
  ...rest
}: InputProps) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const helperId = helperText ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

  return (
    <div style={{ width: fullWidth ? '100%' : undefined, ...containerStyle }}>
      <label htmlFor={inputId} style={hideLabel ? SR_ONLY : LABEL}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        {...rest}
        id={inputId}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        style={{
          ...INPUT_BASE,
          ...(error ? { borderColor: 'var(--rx-color-danger)' } : {}),
          ...(disabled ? { opacity: 'var(--rx-disabled-opacity)' as unknown as number } : {}),
          ...style,
        }}
      />
      {error ? (
        <p id={errorId} role="alert" style={{ margin: 'var(--rx-space-1) 0 0', fontSize: 'var(--rx-font-size-sm)', color: 'var(--rx-color-danger)' }}>
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} style={{ margin: 'var(--rx-space-1) 0 0', fontSize: 'var(--rx-font-size-sm)', color: 'var(--rx-color-text-faint)' }}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
