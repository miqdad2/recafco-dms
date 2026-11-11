import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ConfidentialBadge, Notice, Pagination, buttonSecondary, fieldClass, formatDay } from '@/components/ui';
import { type AdminCategory, type AdminDepartment, adminGet, requireAdmin } from '@/lib/admin';
import type { DocumentSummary, Page, UserRef } from '@/lib/mayan';
import { AdminShell, NotAuthorized, adminTable, adminTd, adminTh, sectionAllowed } from '../admin-shell';
import { DoneNotice } from '../done-notice';
import { BulkBar, SelectAll } from './bulk-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents – Administration' };

type AdminListDocument = DocumentSummary & { in_trash: boolean; trashed_at: string | null };
type Group = { id: number; name: string; is_active: boolean };

export default async function AdminDocumentsPage({ searchParams }: PageProps<'/admin/documents'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'documents')) return <NotAuthorized session={session} />;
  const params = await searchParams;
  const value = (name: string) => String(params[name] ?? '').trim().slice(0, 200);
  const trash = value('status') === 'trash';
  const filters = {
    q: value('q'),
    department: value('department'),
    category: value('category'),
    access: value('access'),
    status: trash ? 'trash' : '',
  };
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const query = (extra: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [key, item] of Object.entries({ ...filters, ...extra })) if (item) search.set(key, item);
    return search.toString();
  };
  const reclassified = /^[0-9]{1,12}$/.test(value('reclassified')) ? value('reclassified') : null;

  const [data, departments, categories, groups, people] = await Promise.all([
    adminGet<Page<AdminListDocument>>(session, `/documents/?${query({ page: String(page) })}`),
    adminGet<{ results: AdminDepartment[] }>(session, '/departments/'),
    adminGet<{ results: AdminCategory[] }>(session, '/categories/'),
    adminGet<{ results: Group[] }>(session, '/confidential-groups/'),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
  ]);

  const can = access.can;
  const actions = trash
    ? [can('documents.recycle') && 'restore', can('documents.purge') && 'purge']
    : [
        can('documents.manage') && 'move',
        can('documents.manage') && 'responsible',
        can('documents.manage') && 'access',
        can('documents.recycle') && 'trash',
      ];

  return (
    <AdminShell access={access} section="documents" title="Documents" crumbs={[{ label: 'Documents' }]}>
      {reclassified && (
        <Notice tone="ok" role="status">
          Document {reclassified} now has new access. You can no longer open it, so it is no longer listed here.
        </Notice>
      )}
      <DoneNotice params={params} />
      {value('purged') === '1' && (
        <Notice tone="ok" role="status">
          The document was permanently deleted, including its stored files.
        </Notice>
      )}

      <nav aria-label="Document lists" className="flex gap-2">
        <Link href="/admin/documents" aria-current={trash ? undefined : 'page'} className={`${buttonSecondary} ${trash ? '' : 'border-ink bg-hover'}`}>
          Documents
        </Link>
        <Link
          href="/admin/documents?status=trash"
          aria-current={trash ? 'page' : undefined}
          className={`${buttonSecondary} ${trash ? 'border-ink bg-hover' : ''}`}
        >
          <Icon name="document" className="size-5" />
          Recycle bin
        </Link>
      </nav>

      <form role="search" action="/admin/documents" className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem_auto] xl:items-end">
        {trash && <input type="hidden" name="status" value="trash" />}
        <div>
          <label htmlFor="document-search" className="mb-1.5 block text-sm font-semibold">
            Title or number
          </label>
          <input id="document-search" name="q" type="search" defaultValue={filters.q} className={fieldClass} />
        </div>
        <Filter id="filter-department" name="department" label="Department" value={filters.department} empty="All departments">
          <option value="none">No department</option>
          {departments.results.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.is_active ? '' : ' (deactivated)'}
            </option>
          ))}
        </Filter>
        <Filter id="filter-category" name="category" label="Category" value={filters.category} empty="All categories">
          {categories.results.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Filter>
        <Filter id="filter-access" name="access" label="Access" value={filters.access} empty="All">
          <option value="general">General</option>
          <option value="confidential">Any confidential group</option>
          {groups.results.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Filter>
        <div className="flex gap-2">
          <button type="submit" className={`${buttonSecondary} flex-1`}>
            <Icon name="search" className="size-5" />
            Filter
          </button>
          <Link href={trash ? '/admin/documents?status=trash' : '/admin/documents'} className={buttonSecondary}>
            Clear
          </Link>
        </div>
      </form>

      <BulkBar
        mode={trash ? 'trash' : 'active'}
        returnQuery={query({})}
        actions={actions.filter((item): item is string => Boolean(item))}
        departments={departments.results.filter((item) => item.is_active).map(({ id, name }) => ({ id, name }))}
        categories={categories.results.filter((item) => item.is_active).map(({ id, name }) => ({ id, name }))}
        groups={groups.results.filter((group) => group.is_active).map(({ id, name }) => ({ id, name }))}
        people={people.results.filter((person) => person.is_active).map((person) => ({ id: person.id, name: `${person.full_name} (${person.username})` }))}
      />

      <p className="text-base text-muted" aria-live="polite">
        {data.count.toLocaleString('en-GB')} {trash ? 'in the recycle bin' : 'documents'}
        {trash && ' · Documents here are hidden from employees. Restore them or delete them permanently.'}
      </p>

      {data.results.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-base">{trash ? 'The recycle bin is empty.' : 'No documents found.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className={adminTable}>
            <caption className="sr-only">{trash ? 'Documents in the recycle bin' : 'Documents'}</caption>
            <thead className="border-b border-line bg-canvas">
              <tr>
                <th scope="col" className={`${adminTh} w-12`}>
                  <SelectAll />
                </th>
                <th scope="col" className={adminTh}>Title</th>
                <th scope="col" className={adminTh}>Department · Category</th>
                <th scope="col" className={adminTh}>Uploaded by</th>
                <th scope="col" className={adminTh}>{trash ? 'Moved to the bin' : 'Date'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.results.map((document) => (
                <tr key={document.id}>
                  <td className={adminTd}>
                    <input
                      type="checkbox"
                      name="ids"
                      value={document.id}
                      form="bulk-documents"
                      aria-label={`Select ${document.label}`}
                      className="size-5"
                    />
                  </td>
                  <td className={adminTd}>
                    <Link href={`/admin/documents/${document.id}`} dir="auto" className="font-semibold wrap-anywhere text-brand underline-offset-4 hover:underline">
                      {document.label}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                      No. {document.id}
                      {document.access === 'confidential' && <ConfidentialBadge />}
                      {document.confidential_group && <span>{document.confidential_group.name}</span>}
                    </span>
                  </td>
                  <td className={`${adminTd} text-sm wrap-anywhere`}>
                    {document.department_ref ? document.department : <span className="text-muted">{document.department ? `${document.department} (deleted)` : 'No department'}</span>}
                    {' · '}
                    {document.category ?? '—'}
                  </td>
                  <td className={`${adminTd} text-sm wrap-anywhere`}>{document.uploaded_by?.full_name ?? '—'}</td>
                  <td className={`${adminTd} text-sm`}>{formatDay(trash && document.trashed_at ? document.trashed_at : document.datetime_created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} count={data.count} pageSize={data.page_size} hrefFor={(p) => `/admin/documents?${query({ page: String(p) })}`} />
    </AdminShell>
  );
}

function Filter({
  id,
  name,
  label,
  value,
  empty,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className={fieldClass}>
        <option value="">{empty}</option>
        {children}
      </select>
    </div>
  );
}
