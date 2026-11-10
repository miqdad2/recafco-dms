import Link from 'next/link';
import { buttonPrimary } from '@/components/ui';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Not found</h1>
      <p className="text-lg">This page or document does not exist, or you do not have access to it.</p>
      <Link href="/" className={buttonPrimary}>
        Go to home
      </Link>
    </main>
  );
}
