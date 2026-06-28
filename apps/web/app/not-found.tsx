import Link from 'next/link';

export const metadata = { title: 'Page not found — RivlayX' };

const wrap: React.CSSProperties = {
  maxWidth: 560,
  margin: '6rem auto',
  padding: '0 1.5rem',
  textAlign: 'center',
};
const eyebrow: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--rx-letter-spacing-wide)',
  color: 'var(--rx-color-text-muted)',
  margin: 0,
};
const action: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 'var(--rx-space-5)',
  padding: '0.6rem 1.4rem',
  borderRadius: 'var(--rx-radius-lg)',
  background: 'var(--rx-color-primary)',
  color: 'var(--rx-color-primary-contrast)',
  fontWeight: 600,
  textDecoration: 'none',
};

export default function NotFound() {
  return (
    <main style={wrap}>
      <p style={eyebrow}>RivlayX</p>
      <h1 style={{ fontSize: 'var(--rx-font-size-2xl)', margin: '0.5rem 0 0' }}>Page not found</h1>
      <p style={{ color: 'var(--rx-color-text-muted)', marginTop: '0.75rem' }}>
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <Link href="/" style={action}>
        Back to home →
      </Link>
    </main>
  );
}
