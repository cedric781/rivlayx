import { getEnv } from '@/lib/env';
import { LoginForm } from './login-form';
import { PrivyLoginButton } from './privy-login-button';

export const metadata = { title: 'Sign in — RivlayX' };

export default function LoginPage() {
  const env = getEnv();
  const hasPrivy = Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID ?? env.PRIVY_APP_ID);

  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Sign in to RivlayX</h1>
      {hasPrivy ? (
        <>
          <p>Sign in with email, Google, or X to get your embedded Solana wallet.</p>
          <PrivyLoginButton />
          <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.6 }}>
            Network: <code>{env.SOLANA_NETWORK}</code>. Embedded wallet auto-created on first
            sign-in.
          </p>
        </>
      ) : (
        <>
          <p>Enter your email to continue.</p>
          <LoginForm />
          <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.6 }}>
            Mock mode — any valid email creates a development account. Configure Privy keys to
            enable the real flow.
          </p>
        </>
      )}
    </main>
  );
}
