import Link from 'next/link';

/**
 * Global site footer. Presentational only — static links to the legal/support
 * pages plus a wordmark line. Styling uses the shared design tokens.
 */

const footer: React.CSSProperties = {
  borderTop: '1px solid var(--rx-color-border)',
  padding: 'var(--rx-space-5)',
  marginTop: 'var(--rx-space-8)',
};

const inner: React.CSSProperties = {
  maxWidth: 960,
  margin: '0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--rx-space-4)',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const brand: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-sm)',
  color: 'var(--rx-color-text-muted)',
};

const nav: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--rx-space-4)',
};

const link: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-sm)',
  color: 'var(--rx-color-text-muted)',
  textDecoration: 'none',
};

export function SiteFooter() {
  return (
    <footer style={footer}>
      <div style={inner}>
        <span style={brand}>© RivlayX</span>
        <nav style={nav} aria-label="Legal">
          <Link href="/terms" style={link}>
            Terms
          </Link>
          <Link href="/privacy" style={link}>
            Privacy
          </Link>
          <Link href="/rules" style={link}>
            Rules
          </Link>
        </nav>
      </div>
    </footer>
  );
}
