import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'RivlayX Admin',
  description: 'Internal admin console',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'var(--rx-font-sans)',
          margin: 0,
          background: 'var(--rx-color-bg)',
          color: 'var(--rx-color-text)',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            background: 'var(--rx-color-admin-banner)',
            color: 'var(--rx-color-primary-contrast)',
            padding: '0.4rem 1rem',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          ADMIN CONSOLE — privileged actions are audited.
        </div>
        {children}
      </body>
    </html>
  );
}
