import { LoginForm } from './login-form';

export const metadata = { title: 'Admin sign-in — RivlayX' };

export default function AdminLoginPage() {
  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Admin sign-in</h1>
      <p>Restricted to moderator, admin, and super_admin roles.</p>
      <LoginForm />
      <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.6 }}>
        Mock mode — your email must be linked to an account with a privileged role. Use the
        bootstrap super_admin (configured via <code>BOOTSTRAP_ADMIN_EMAIL</code>) after running
        <code> pnpm db:seed</code>.
      </p>
    </main>
  );
}
