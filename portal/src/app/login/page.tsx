import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  if (await getSession()) redirect('/');
  const params = await searchParams;
  const notice = params.signedout
    ? 'You have signed out.'
    : params.ended
      ? 'Please sign in to continue.'
      : null;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-3xl border-t-8 border-brand bg-white p-6 shadow-sm sm:p-8">
        <Image src="/recafco-logo.png" alt="RECAFCO" width={120} height={120} priority className="mx-auto" />
        <h1 className="mt-4 text-center text-3xl font-bold">Documents</h1>
        <p className="mt-1 text-center text-lg text-muted">Sign in with your RECAFCO account</p>
        {notice && (
          <p role="status" className="mt-6 rounded-xl bg-canvas px-4 py-3 text-lg">
            {notice}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
