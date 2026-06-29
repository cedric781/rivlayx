import { LoginForm } from './login-form';

export const metadata = { title: 'Admin sign-in — RivlayX' };

export default function AdminLoginPage() {
  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Admin sign-in</h1>
      <p>Restricted to moderator, admin, and super_admin roles.</p>
      <LoginForm />
      <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.6 }}>
        Sign in with your provisioned admin email and password. Accounts are created out-of-band;
        the bootstrap super_admin is seeded from <code>BOOTSTRAP_ADMIN_EMAIL</code> /{' '}
        <code>BOOTSTRAP_ADMIN_PASSWORD</code> via <code>pnpm db:seed</code>. Privileged roles
        complete TOTP MFA after this step.
      </p>
    </main>
  );
}
