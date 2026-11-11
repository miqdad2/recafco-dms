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
    ? { icon: 'check', text: 'You have signed out.', tone: 'text-ok' }
    : params.ended
      ? { icon: 'info', text: 'Please sign in to continue.', tone: 'text-info' }
      : null;

  return (
    <AuthLayout>
      {notice && (
        <p role="status" className={`mb-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold ${notice.tone}`}>
          <Icon name={notice.icon} className="size-4 shrink-0" />
          {notice.text}
        </p>
      )}
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-base text-muted">Use your RECAFCO account.</p>
      <LoginForm />
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Need help signing in? Contact your system administrator.
      </p>
    </AuthLayout>
  );
}
