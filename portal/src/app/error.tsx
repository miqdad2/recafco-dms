'use client';

import Link from 'next/link';

/** Shown when the document system cannot answer (any page). */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-lg">The document system did not answer. Your documents are safe. Please try again in a moment.</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-12 items-center rounded-lg bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-strong"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-12 items-center rounded-lg border border-line-strong px-6 text-lg font-semibold">
          Go to Departments
        </Link>
      </div>
    </main>
  );
}
