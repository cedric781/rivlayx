import { MfaForm } from './mfa-form';

export const metadata = { title: 'Two-factor — RivlayX Admin' };

export default function MfaPage() {
  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Two-factor verification</h1>
      <p>Enter your 6-digit code to access privileged actions.</p>
      <MfaForm />
      <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.6 }}>
        Mock mode — any 6-digit numeric code is accepted. Real TOTP / WebAuthn lands in a later
        sprint via Privy.
      </p>
    </main>
  );
}
