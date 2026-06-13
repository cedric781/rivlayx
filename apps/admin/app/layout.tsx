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
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
          background: '#0b0d10',
          color: '#e6e8eb',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            background: '#5c1a1a',
            color: 'white',
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
