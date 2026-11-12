import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import {
  DocumentTable,
  EmptyState,
  PageHeader,
  Pagination,
  buttonPrimary,
  buttonSecondary,
  fieldClass,
  labelClass,
  linkClass,
} from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import {
  DEPARTMENT_PAGE_SIZE,
  type DocumentSummary,
  getDepartmentDocuments,
  getDepartments,
  searchDocuments,
} from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search documents' };

const SEARCH_PAGE_SIZE = 20;

function searchHref(filters: { q: string; department?: number; page?: number }): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.department) params.set('department', String(filters.department));
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const text = params.toString();
  return `/search${text ? `?${text}` : ''}`;
}

/**
 * Search across all departments, or within one department, including
 * departments that are no longer in use (their documents are kept). Choosing
 * a department without search words lists its documents, newest first.
 */
export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const session = await requireSession();
  const params = await searchParams;
  const query = String(params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));

  const requested = parseId(String(params.department ?? ''));
  // Without a department, the search does not depend on the department
  // list, so both are fetched at the same time.
  const [departments, allDepartmentsSearch] = await Promise.all([
    withMayan(() => getDepartments(session.token)),
    requested === null && query ? withMayan(() => searchDocuments(session.token, query, Math.min(page, 50))) : null,
  ]);
  const all = [...departments.departments, ...departments.inactive_departments];
  const department = all.find((item) => item.id === requested);

  let results: DocumentSummary[] | null = null;
  let count = 0;
  if (department) {
    const data = await withMayan(() => getDepartmentDocuments(session.token, department.id, { q: query, page }));
    results = data.results;
    count = data.count;
  } else if (query) {
    // An unknown department ID searches all departments, as before.
    const data = allDepartmentsSearch ?? (await withMayan(() => searchDocuments(session.token, query, Math.min(page, 50))));
    results = data.results;
    count = data.count;
  }
  const scope = department ? `in ${department.name}` : 'in all departments';
  const hasMoreSearch = !department && count > page * SEARCH_PAGE_SIZE && page < 50;

  return (
    <AppShell session={session} section="search">
      <PageHeader title="Search documents" description="Find documents by name, number or words inside the file." />

      <form role="search" action="/search" className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-end">
        <div>
          <label htmlFor="q" className={labelClass}>
            Search all documents
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Name, number or words in the document"
            autoFocus={!query && !department}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="department" className={labelClass}>
            Department
          </label>
          <select id="department" name="department" defaultValue={department ? String(department.id) : ''} className={fieldClass}>
            <option value="">All departments</option>
            {departments.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {departments.inactive_departments.length > 0 && (
              <optgroup label="No longer in use">
                {departments.inactive_departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={`${buttonPrimary} flex-1 md:flex-none`}>
            <Icon name="search" className="size-5" />
            Search
          </button>
          {(query || department) && (
            <Link href="/search" className={`${buttonSecondary} flex-1 md:flex-none`}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {results === null ? (
        <p className="text-base text-muted">
          Type a name, number or words from the document, or choose a department to list its documents.
        </p>
      ) : (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-lg font-bold" aria-live="polite">
            {count === 0
              ? query
                ? `No documents found for “${query}” ${scope}.`
                : `No documents found ${scope}.`
              : `${count.toLocaleString('en-GB')} ${count === 1 ? 'document' : 'documents'}${query ? ` for “${query}”` : ''} ${scope}`}
          </h2>
          {department && !department.is_active && (
            <p className="text-sm text-muted">This department is no longer in use. Its documents are kept and can still be opened.</p>
          )}
          {count === 0 ? (
            <EmptyState title="Nothing matched." icon="search">
              <p className="text-base text-muted">Check the spelling, try fewer words, or search all departments.</p>
              {department && (
                <Link href={searchHref({ q: query })} className={`${linkClass} self-start`}>
                  Search all departments
                </Link>
              )}
            </EmptyState>
          ) : (
            <DocumentTable documents={results} showDepartment={!department} caption={`Search results ${scope}`} />
          )}
          {department ? (
            <Pagination
              page={page}
              count={count}
              pageSize={DEPARTMENT_PAGE_SIZE}
              hrefFor={(target) => searchHref({ q: query, department: department.id, page: target })}
            />
          ) : (
            hasMoreSearch && (
              <Link className={`${buttonSecondary} self-start`} href={searchHref({ q: query, page: page + 1 })}>
                Show more results
              </Link>
            )
          )}
        </section>
      )}
    </AppShell>
  );
}
