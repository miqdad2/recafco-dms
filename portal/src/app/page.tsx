import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { Notice, SampleBadge, buttonPrimary, fieldClass } from '@/components/ui';
import { refreshRoles, requireSession, withMayan } from '@/lib/auth';
import { type Department, getDepartments } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments' };

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuwait' }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const session = await requireSession();
  const welcome = (await searchParams).welcome === '1';
  const [me, data] = await Promise.all([refreshRoles(session), withMayan(() => getDepartments(session.token))]);
  const firstName = session.fullName.split(' ')[0];
  const myDepartments = new Set([...me.department_ids, ...me.controller_department_ids]);
  const hasSamples = data.departments.some((department) => department.is_sample);

  return (
    <AppShell session={session} section="departments">
      {welcome && (
        <Notice tone="ok" role="status">
          Your password is saved. Use it the next time you sign in.
        </Notice>
      )}
      <section aria-labelledby="welcome" className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-line sm:p-8">
        <p id="welcome" className="text-lg text-muted">
          {greeting()}, {firstName}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Find or add a document</h1>
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <form role="search" action="/search" className="flex flex-1 flex-col gap-3 sm:flex-row">
            <label htmlFor="home-search" className="sr-only">
              Search all documents
            </label>
            <div className="relative flex-1">
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted" />
              <input
                id="home-search"
                name="q"
                type="search"
                required
                placeholder="Search all documents – name, number or words inside"
                className={`${fieldClass} min-h-16 pl-13 text-xl`}
              />
            </div>
            <button type="submit" className={`${buttonPrimary} min-h-16`}>
              Search all documents
            </button>
          </form>
          {session.canUpload && (
            <Link href="/upload" className={`${buttonPrimary} min-h-16 bg-ink hover:bg-black lg:px-8`}>
              <Icon name="upload" className="size-6" />
              Upload documents
            </Link>
          )}
        </div>
        <nav aria-label="Shortcuts" className="mt-4 flex flex-wrap gap-2">
          <Link href="/my-uploads" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-canvas px-4 text-base font-semibold hover:bg-line/60">
            <Icon name="upload" className="size-5" /> My uploads
          </Link>
          <Link href="/favorites" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-canvas px-4 text-base font-semibold hover:bg-line/60">
            <Icon name="star" className="size-5" /> Favorites
          </Link>
        </nav>
      </section>

      <section aria-labelledby="departments-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="departments-heading" className="text-2xl font-bold sm:text-3xl">
            Departments
          </h2>
          <p className="text-base text-muted">Every employee can open general documents in every department.</p>
        </div>
        {hasSamples && (
          <p className="rounded-xl border border-wait bg-wait-soft px-4 py-3 text-base text-wait">
            Department names marked “Sample name” are placeholders until RECAFCO confirms the real list.
          </p>
        )}
        {data.departments.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-lg">No departments have been set up yet. Please contact IT.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.departments.map((department) => (
              <li key={department.id}>
                <DepartmentCard department={department} mine={myDepartments.has(department.id)} />
              </li>
            ))}
          </ul>
        )}

        {data.inactive_departments.length > 0 && (
          <details className="rounded-2xl border border-line bg-white p-4">
            <summary className="min-h-12 cursor-pointer content-center text-lg font-semibold">
              Departments no longer in use ({data.inactive_departments.length})
            </summary>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.inactive_departments.map((department) => (
                <li key={department.id}>
                  <Link href={`/departments/${department.id}`} className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-line px-4 text-base font-semibold hover:border-ink">
                    {department.name}
                    <span className="text-muted">({department.document_count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </AppShell>
  );
}

function DepartmentCard({ department, mine }: { department: Department; mine: boolean }) {
  const count = department.document_count ?? 0;
  return (
    <Link
      href={`/departments/${department.id}`}
      className="group flex h-full min-h-36 flex-col gap-4 rounded-2xl border-2 border-line bg-white p-5 transition-[border-color,box-shadow] hover:border-brand hover:shadow-md focus-visible:border-brand"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon name={department.icon} className="size-8" />
        </span>
        <Icon name="chevronRight" className="mt-1 size-6 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-xl font-bold break-words">{department.name}</span>
        <span className="text-lg text-muted">
          {count === 0 ? 'No documents yet' : `${count.toLocaleString('en-GB')} ${count === 1 ? 'document' : 'documents'}`}
        </span>
      </span>
      {(department.is_sample || mine) && (
        <span className="mt-auto flex flex-wrap gap-2">
          {mine && (
            <span className="inline-flex rounded-full bg-ink px-2.5 py-0.5 text-sm font-semibold text-white">Your department</span>
          )}
          {department.is_sample && <SampleBadge />}
        </span>
      )}
    </Link>
  );
}
