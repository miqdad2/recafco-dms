import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth-layout';
import { Icon } from '@/components/icons';
import { getSession } from '@/lib/auth';
import { SIGNED_OUT_COOKIE } from '@/lib/config';
import { ClearSignedOut } from './clear-signed-out';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  if (await getSession()) redirect('/');
  const params = await searchParams;
  // "Signed out" only after a real sign-out (one-time cookie set by the
  // sign-out action), never just because ?signedout=1 is in the address.
  const signedOut = (await cookies()).get(SIGNED_OUT_COOKIE)?.value === '1';
  const notice = signedOut
    ? { icon: 'check', text: 'You have signed out.', tone: 'border-ok/30 bg-ok-soft text-ok' }
    : params.ended
      ? { icon: 'info', text: 'Please sign in to continue.', tone: 'border-info/30 bg-info-soft text-info' }
      : null;

  return (
    <AuthLayout>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-base text-muted">Sign in to RECAFCO Documents.</p>
      {/* Rendered with the page (no layout shift); announced politely. */}
      {notice && (
        <p
          role="status"
          className={`mt-4 inline-flex items-center gap-2 self-start rounded-lg border px-3 py-1.5 text-sm font-semibold ${notice.tone}`}
        >
          <Icon name={notice.icon} className="size-4 shrink-0" />
          {notice.text}
        </p>
      )}
      {(signedOut || params.signedout) && <ClearSignedOut cookie={SIGNED_OUT_COOKIE} />}
      <div className="mt-6">
        <LoginForm />
      </div>
      <p className="mt-6 text-[0.9375rem] leading-relaxed text-muted">Need help? Contact your system administrator.</p>
    </AuthLayout>
  );
}
