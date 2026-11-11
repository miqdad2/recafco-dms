import Image from 'next/image';
import { logout } from '@/app/actions';
import { AppShell } from '@/components/app-shell';
import { PageTitle, panelClass } from '@/components/ui';
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
      <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="rounded-lg border-t-8 border-brand bg-surface p-6 shadow-sm sm:p-8">
          <Image src="/recafco-logo.png" alt="RECAFCO" width={96} height={96} priority className="mx-auto" />
          <h1 className="mt-4 text-center text-3xl font-bold">Choose your password</h1>
          <p className="mt-3 text-lg">
            Welcome, <strong>{session.fullName}</strong>. You signed in with a temporary password. Choose your own password
            to continue.
          </p>
          <ChangePasswordForm temporary />
          <form id="signout-form" action={logout} className="mt-6 border-t border-line pt-5">
            <button type="submit" className="min-h-12 w-full rounded-lg border border-line-strong px-4 text-base font-semibold hover:bg-canvas">
              Sign out
            </button>
          </form>
        </div>
      </main>
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
