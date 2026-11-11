import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import {
  ConfidentialBadge,
  DepartmentIcon,
  Notice,
  SampleBadge,
  buttonPrimary,
  fieldClass,
  formatDay,
  linkClass,
} from '@/components/ui';
import { refreshRoles, requireSession, withMayan } from '@/lib/auth';
import { type Department, type DocumentSummary, getDepartments, getRecentDocuments } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments' };

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const session = await requireSession();
  const welcome = (await searchParams).welcome === '1';
  const [me, data, recent] = await Promise.all([
    refreshRoles(session),
    withMayan(() => getDepartments(session.token)),
    withMayan(() => getRecentDocuments(session.token, 6)),
  ]);
  const myDepartments = new Set([...me.department_ids, ...me.controller_department_ids]);
  const hasSamples = data.departments.some((department) => department.is_sample);

  return (
    <AppShell session={session} section="departments">
      {welcome && (
        <Notice tone="ok" role="status">
          Your password is saved. Use it the next time you sign in.
        </Notice>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <h1 id="departments-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Departments
          </h1>
          <p className="mt-1 text-base text-muted">Every employee can open general documents in every department.</p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <form role="search" action="/search" className="flex flex-1 gap-2">
            <label htmlFor="home-search" className="sr-only">
              Search all documents
            </label>
            <div className="relative flex-1">
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
              <input
                id="home-search"
                name="q"
                type="search"
                required
                placeholder="Name, number or words inside"
                className={`${fieldClass} pl-10`}
              />
            </div>
            <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-ink bg-ink px-5 text-base font-semibold text-white hover:bg-black">
              Search
            </button>
          </form>
          {session.canUpload && (
            <Link href="/upload" className={buttonPrimary}>
              <Icon name="upload" className="size-5" />
              Upload documents
            </Link>
          )}
        </div>
      </div>

      <section aria-labelledby="departments-heading" className="flex flex-col gap-3">
        {hasSamples && (
          <p className="text-sm text-muted">
            <SampleBadge /> marks placeholder names used until RECAFCO confirms the department list.
          </p>
        )}
        {data.departments.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-5 text-base">No departments have been set up yet. Please contact IT.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.departments.map((department) => (
              <li key={department.id}>
                <DepartmentCard department={department} mine={myDepartments.has(department.id)} />
              </li>
            ))}
          </ul>
        )}
        {data.inactive_departments.length > 0 && (
          <p className="text-sm text-muted">
            Looking for documents from a department that is no longer in use?{' '}
            <Link href="/search" className={linkClass}>
              Search documents
            </Link>{' '}
            and choose it under Department.
          </p>
        )}
      </section>

      <RecentlyUploaded documents={recent.results} />
    </AppShell>
  );
}

function DepartmentCard({ department, mine }: { department: Department; mine: boolean }) {
  const count = department.document_count ?? 0;
  const countText = count === 0 ? 'No documents yet' : `${count.toLocaleString('en-GB')} ${count === 1 ? 'document' : 'documents'}`;
  return (
    <Link
      href={`/departments/${department.id}`}
      className="group flex h-full items-center gap-4 rounded-lg border border-line bg-surface p-4 hover:border-line-strong hover:bg-hover"
    >
      <DepartmentIcon id={department.id} icon={department.icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-lg font-semibold wrap-anywhere">{department.name}</span>
        <span className="text-sm text-muted">{countText}</span>
        {(department.is_sample || mine) && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {mine && (
              <span className="inline-flex items-center rounded border border-line px-1.5 text-xs font-semibold text-ink">Your department</span>
            )}
            {department.is_sample && <SampleBadge />}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-muted group-hover:text-ink">
        Open
        <Icon name="chevronRight" className="size-5" />
      </span>
    </Link>
  );
}

function RecentlyUploaded({ documents }: { documents: DocumentSummary[] }) {
  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
      <h2 id="recent-heading" className="text-lg font-bold">
        Recently uploaded
      </h2>
      {documents.length === 0 ? (
        <p className="text-base text-muted">No documents have been uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                href={`/documents/${document.id}`}
                className="flex flex-col gap-0.5 px-4 py-3 hover:bg-hover sm:flex-row sm:items-center sm:gap-4"
              >
                <span dir="auto" className="min-w-0 flex-1 text-base font-semibold wrap-anywhere">
                  {document.label}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted sm:justify-end">
                  {document.access === 'confidential' && <ConfidentialBadge />}
                  <span>{[document.department, document.category].filter(Boolean).join(' · ')}</span>
                  <span>{document.uploaded_by?.full_name ?? 'Uploader not recorded'}</span>
                  <span className="whitespace-nowrap">{formatDay(document.datetime_created)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
