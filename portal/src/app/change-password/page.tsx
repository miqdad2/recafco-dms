import { logout } from '@/app/actions';
import { AppShell } from '@/components/app-shell';
import { AuthLayout } from '@/components/auth-layout';
import { PageTitle, buttonSecondary, panelClass } from '@/components/ui';
import { requireSessionAllowingPasswordChange } from '@/lib/auth';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change password' };

export default async function ChangePasswordPage() {
  const session = await requireSessionAllowingPasswordChange();

  if (session.mustChange) {
    // Signed in with a temporary password: nothing but this form and
    // "Sign out" is offered (Mayan refuses every other request too).
    return (
      <AuthLayout>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Choose your password</h1>
        <p className="mt-1 text-base text-muted">
          Welcome, <strong className="text-ink">{session.fullName}</strong>. You signed in with a temporary password. Choose
          your own password to continue.
        </p>
        <ChangePasswordForm temporary />
        <form id="signout-form" action={logout} className="mt-6 border-t border-line pt-4">
          <button type="submit" className={`${buttonSecondary} w-full`}>
            Sign out
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AppShell session={session}>
      <PageTitle>Change password</PageTitle>
      <section className={`${panelClass} max-w-xl`} aria-label="Change password">
        <p className="text-lg">
          Changing your password signs you out on your other devices. If you forgot your password, ask a RECAFCO
          administrator to reset it.
        </p>
        <ChangePasswordForm temporary={false} />
      </section>
    </AppShell>
  );
}
