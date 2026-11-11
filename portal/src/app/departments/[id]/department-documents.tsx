import Link from 'next/link';
import { DocumentTable, EmptyState, Notice, Pagination, buttonPrimary, linkClass } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { DEPARTMENT_PAGE_SIZE, getDepartmentDocuments } from '@/lib/mayan';

export function departmentHref(id: number, filters: { q: string; category?: number; page: number }): string {
  const next = new URLSearchParams();
  if (filters.q) next.set('q', filters.q);
  if (filters.category) next.set('category', String(filters.category));
  if (filters.page > 1) next.set('page', String(filters.page));
  const text = next.toString();
  return `/departments/${id}${text ? `?${text}` : ''}`;
}

/**
 * The department's document list. Rendered inside <Suspense>, so the page
 * header and search form appear at once while this loads.
 */
export async function DepartmentDocuments({
  department,
  canUploadHere,
  filters,
  categoryName,
}: {
  department: { id: number; name: string };
  canUploadHere: boolean;
  filters: { q: string; category?: number; page: number };
  categoryName?: string;
}) {
  const { q, category, page } = filters;
  // Read the session here rather than taking the token as a prop.
  const session = await requireSession();
  const documents = await withMayan(() => getDepartmentDocuments(session.token, department.id, filters));
  const filtered = Boolean(q || category);
  const hrefFor = (target: number) => departmentHref(department.id, { ...filters, page: target });

  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="documents-heading" className="text-lg font-bold" aria-live="polite">
          {filtered
            ? `${documents.count} ${documents.count === 1 ? 'result' : 'results'}${q ? ` for “${q}”` : ''}${categoryName ? ` in ${categoryName}` : ''}`
            : 'Recently uploaded'}
        </h2>
        <p className="text-sm text-muted">
          {filtered ? 'Only this department is searched. ' : 'Newest first. '}
          <Link href={`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`} className={linkClass}>
            Search all departments
          </Link>
        </p>
      </div>

      {documents.results.some((document) => document.state === 'processing' || document.state === 'delayed') && (
        <Notice tone="wait" role="status">
          Some documents are still being prepared. You can already download them; previews appear in a minute or two.
        </Notice>
      )}

      {documents.count === 0 ? (
        filtered ? (
          <EmptyState title="No documents match your search." icon="search">
            <p className="text-base text-muted">Check the spelling, choose another category, or try fewer words.</p>
            <Link href={`/departments/${department.id}`} className={`${linkClass} self-start`}>
              Show all documents in {department.name}
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title="This department has no documents yet.">
            {canUploadHere && (
              <Link href={`/upload?department=${department.id}`} className={`${buttonPrimary} self-start`}>
                Upload the first document
              </Link>
            )}
          </EmptyState>
        )
      ) : documents.results.length === 0 ? (
        <EmptyState title="There are no more documents on this page.">
          <Link href={hrefFor(1)} className={`${linkClass} self-start`}>
            Go to the first page
          </Link>
        </EmptyState>
      ) : (
        <DocumentTable documents={documents.results} caption={`Documents in ${department.name}`} />
      )}

      <Pagination page={page} count={documents.count} pageSize={DEPARTMENT_PAGE_SIZE} hrefFor={hrefFor} />
    </section>
  );
}

export function DocumentsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p role="status" className="text-base font-semibold">
        Loading documents…
      </p>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-14 animate-pulse rounded-lg bg-surface ring-1 ring-line" />
      ))}
    </div>
  );
}
