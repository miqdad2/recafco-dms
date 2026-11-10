import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { Breadcrumb, DocumentTable, EmptyState, PageTitle, buttonPrimary, buttonSecondary, fieldClass } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { searchDocuments, type SearchResult } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search all documents' };

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const session = await requireSession();
  const params = await searchParams;
  const query = String(params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(50, Number(params.page) || 1));

  let result: SearchResult | null = null;
  if (query) result = await withMayan(() => searchDocuments(session.token, query, page));
  const hasMore = result ? result.count > page * 20 : false;

  return (
    <AppShell session={session} section="departments">
      <Breadcrumb items={[{ href: '/', label: 'Departments' }, { label: 'Search all documents' }]} />
      <PageTitle>Search all documents</PageTitle>
      <form role="search" action="/search" className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:p-5">
        <label htmlFor="q" className="sr-only">
          Search all documents
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Name, number or words in the document"
          autoFocus={!query}
          className={`${fieldClass} sm:flex-1`}
        />
        <button type="submit" className={buttonPrimary}>
          <Icon name="search" className="size-6" />
          Search
        </button>
      </form>

      {result && (
        <section aria-labelledby="results-heading" className="flex flex-col gap-4">
          <h2 id="results-heading" className="text-2xl font-bold" aria-live="polite">
            {result.count === 0
              ? `No documents found for “${query}”.`
              : `${result.count} ${result.count === 1 ? 'document' : 'documents'} found in all departments`}
          </h2>
          {result.count === 0 ? (
            <EmptyState title="Nothing matched." icon="search">
              <p className="text-lg text-muted">Check the spelling, or try fewer or different words.</p>
            </EmptyState>
          ) : (
            <DocumentTable documents={result.results} showDepartment caption={`Search results for ${query}`} />
          )}
          {hasMore && (
            <Link className={`${buttonSecondary} self-start`} href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}>
              Show more results
            </Link>
          )}
        </section>
      )}
    </AppShell>
  );
}
