import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ConfidentialBadge, Pagination, buttonPrimary, fieldClass, formatDay } from '@/components/ui';
import { adminGet, requireAdmin } from '@/lib/admin';
import type { DocumentSummary, Page } from '@/lib/mayan';
import { AdminShell, NotAuthorized, adminTable, adminTd, adminTh } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents – Administration' };

export default async function AdminDocumentsPage({ searchParams }: PageProps<'/admin/documents'>) {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const params = await searchParams;
  const q = String(params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const data = await adminGet<Page<DocumentSummary>>(session, `/documents/?${new URLSearchParams({ q, page: String(page) })}`);

  return (
    <AdminShell session={session} section="documents" title="Documents" crumbs={[{ label: 'Documents' }]}>
      <p className="text-lg text-muted">
        Correct a document’s title, department, category or uploader. Only documents you are allowed to open are listed:
        confidential documents appear only if you are a member of their group.
      </p>
      <form role="search" action="/admin/documents" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:flex-1">
          <label htmlFor="document-search" className="mb-2 block text-lg font-semibold">
            Find a document
          </label>
          <input id="document-search" name="q" type="search" defaultValue={q} placeholder="Title or document number" className={fieldClass} />
        </div>
        <button type="submit" className={buttonPrimary}>
          <Icon name="search" className="size-6" /> Find
        </button>
      </form>

      {data.results.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-lg">No documents found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className={adminTable}>
            <caption className="sr-only">Documents</caption>
            <thead className="border-b border-line bg-canvas">
              <tr>
                <th scope="col" className={adminTh}>No.</th>
                <th scope="col" className={adminTh}>Title</th>
                <th scope="col" className={adminTh}>Department · Category</th>
                <th scope="col" className={adminTh}>Uploaded by</th>
                <th scope="col" className={adminTh}>Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.results.map((document) => (
                <tr key={document.id}>
                  <td className={`${adminTd} tabular-nums text-muted`}>{document.id}</td>
                  <td className={adminTd}>
                    <Link href={`/admin/documents/${document.id}`} className="text-lg font-semibold break-words text-brand underline-offset-4 hover:underline">
                      {document.label}
                    </Link>
                    {document.access === 'confidential' && (
                      <span className="mt-1 block">
                        <ConfidentialBadge />
                      </span>
                    )}
                  </td>
                  <td className={adminTd}>{[document.department, document.category].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={adminTd}>{document.uploaded_by?.full_name ?? '—'}</td>
                  <td className={adminTd}>{formatDay(document.datetime_created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        count={data.count}
        pageSize={data.page_size}
        hrefFor={(p) => `/admin/documents?${new URLSearchParams({ q, page: String(p) })}`}
      />
    </AdminShell>
  );
}
