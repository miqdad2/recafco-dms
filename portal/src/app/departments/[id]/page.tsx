import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import {
  Breadcrumb,
  SampleBadge,
  buttonPrimary,
  buttonSecondary,
  fieldClass,
} from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getDepartment } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { DepartmentDocuments, DocumentsLoading } from './department-documents';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Department' };

export default async function DepartmentPage({ params, searchParams }: PageProps<'/departments/[id]'>) {
  const session = await requireSession();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const query = await searchParams;
  const q = String(query.q ?? '').trim().slice(0, 200);
  const category = parseId(String(query.category ?? '')) ?? undefined;
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));

  const department = await withMayan(() => getDepartment(session.token, id));
  if (!department) notFound();

  const filtered = Boolean(q || category);
  const categoryName = department.categories.find((item) => item.id === category)?.name;
  const uploadHref = `/upload?department=${department.id}`;

  return (
    <AppShell session={session} section="departments">
      <Breadcrumb items={[{ href: '/', label: 'Departments' }, { label: department.name }]} />

      <div className="flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Icon name={department.icon} className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight break-words sm:text-4xl">{department.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-lg text-muted">
              {department.is_active ? 'Department' : 'This department is no longer in use. Its documents are kept.'}
              {department.is_sample && <SampleBadge />}
            </p>
          </div>
        </div>
        {department.can_upload && session.canUpload ? (
          <Link href={uploadHref} className={`${buttonPrimary} shrink-0`}>
            <Icon name="upload" className="size-6" />
            Upload to this department
          </Link>
        ) : (
          <p className="text-base text-muted sm:max-w-64">
            {department.is_active ? 'Your account cannot upload documents.' : 'New documents cannot be added here.'}
          </p>
        )}
      </div>

      <form role="search" action={`/departments/${id}`} className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:p-5 lg:grid-cols-[1fr_18rem_auto_auto] lg:items-end">
        <div>
          <label htmlFor="department-search" className="mb-2 block text-lg font-semibold">
            Search this department
          </label>
          <input
            id="department-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, number or words inside"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="category" className="mb-2 block text-lg font-semibold">
            Category
          </label>
          <select id="category" name="category" defaultValue={category ? String(category) : ''} className={fieldClass}>
            <option value="">All categories</option>
            {department.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.is_active ? '' : ' (no longer used)'}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonPrimary}>
          <Icon name="search" className="size-6" />
          Search
        </button>
        {filtered ? (
          <Link href={`/departments/${id}`} className={buttonSecondary}>
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
      </form>

      <Suspense key={`${q}|${category ?? ''}|${page}`} fallback={<DocumentsLoading />}>
        <DepartmentDocuments
          department={department}
          canUploadHere={department.can_upload && session.canUpload}
          filters={{ q, category, page }}
          categoryName={categoryName}
        />
      </Suspense>
    </AppShell>
  );
}
