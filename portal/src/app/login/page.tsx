import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth-layout';
import { Icon } from '@/components/icons';
import { getSession } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  if (await getSession()) redirect('/');
  const params = await searchParams;
  const notice = params.signedout
    ? { icon: 'check', text: 'You have signed out.', tone: 'border-ok/30 bg-ok-soft text-ok' }
    : params.ended
      ? { icon: 'info', text: 'Please sign in to continue.', tone: 'border-info/30 bg-info-soft text-info' }
      : null;

  return (
    <AuthLayout>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-base text-muted">Sign in to RECAFCO Documents.</p>
      {notice && (
        <p
          role="status"
          className={`mt-4 inline-flex items-center gap-2 self-start rounded-lg border px-3 py-1.5 text-sm font-semibold ${notice.tone}`}
        >
          <Icon name={notice.icon} className="size-4 shrink-0" />
          {notice.text}
        </p>
      )}
      <div className="mt-7">
        <LoginForm />
      </div>
      <p className="mt-7 border-t border-line pt-5 text-sm text-muted">For account help, contact your system administrator.</p>
    </AuthLayout>
  );
}
