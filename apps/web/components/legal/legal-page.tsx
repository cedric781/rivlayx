import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared presentational shell for the static legal/support pages (terms,
 * privacy, rules). Content-only — no data fetching or app logic. Styling uses
 * the shared design tokens so the pages match the rest of the app.
 */

const container: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: 'var(--rx-space-8) var(--rx-space-5)',
};

const backLink: React.CSSProperties = {
  color: 'var(--rx-color-primary)',
  textDecoration: 'none',
  fontSize: 'var(--rx-font-size-sm)',
  fontWeight: 500,
};

const titleStyle: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-2xl)',
  fontWeight: 700,
  margin: 'var(--rx-space-4) 0 0',
};

const introStyle: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-base)',
  color: 'var(--rx-color-text-muted)',
  lineHeight: 'var(--rx-line-normal)',
  margin: 'var(--rx-space-2) 0 0',
};

const disclaimerStyle: React.CSSProperties = {
  marginTop: 'var(--rx-space-4)',
  padding: 'var(--rx-space-3) var(--rx-space-4)',
  background: 'var(--rx-color-warning-surface)',
  border: '1px solid var(--rx-color-border)',
  borderRadius: 'var(--rx-radius-lg)',
  color: 'var(--rx-color-warning-fg)',
  fontSize: 'var(--rx-font-size-sm)',
  lineHeight: 'var(--rx-line-normal)',
};

const headingStyle: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-lg)',
  fontWeight: 700,
  color: 'var(--rx-color-text)',
  margin: 'var(--rx-space-6) 0 var(--rx-space-2)',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-base)',
  color: 'var(--rx-color-text-muted)',
  lineHeight: 'var(--rx-line-normal)',
  margin: '0 0 var(--rx-space-3)',
};

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main style={container}>
      <Link href="/" style={backLink}>
        ← Back to home
      </Link>
      <h1 style={titleStyle}>{title}</h1>
      <p style={introStyle}>{intro}</p>
      <p style={disclaimerStyle}>
        This page is a plain-language summary provided for transparency. It is a working draft
        pending review by legal counsel and does not constitute legal advice. Where this summary and
        any future definitive agreement differ, the definitive agreement governs.
      </p>
      {children}
    </main>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={headingStyle}>{heading}</h2>
      {children}
    </section>
  );
}

export function Para({ children }: { children: ReactNode }) {
  return <p style={bodyStyle}>{children}</p>;
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ ...bodyStyle, paddingLeft: 'var(--rx-space-5)' }}>
      {items.map((item) => (
        <li key={item} style={{ marginBottom: 'var(--rx-space-2)' }}>
          {item}
        </li>
      ))}
    </ul>
  );
}
