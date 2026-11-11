import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import {
  Breadcrumb,
  DepartmentIcon,
  SampleBadge,
  buttonPrimary,
  buttonSecondary,
  fieldClass,
  labelClass,
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

      <div className="flex items-center gap-4">
        <DepartmentIcon id={department.id} icon={department.icon} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">{department.name}</h1>
          {(department.is_sample || !department.is_active) && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted">
              {!department.is_active && 'This department is no longer in use. Its documents are kept and can still be opened.'}
              {department.is_sample && <SampleBadge />}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 lg:flex-row lg:items-end">
        <form role="search" action={`/departments/${id}`} className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end">
          <div>
            <label htmlFor="department-search" className={labelClass}>
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
            <label htmlFor="category" className={labelClass}>
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
          <div className="flex gap-2">
            <button type="submit" className={`${buttonSecondary} flex-1 md:flex-none`}>
              <Icon name="search" className="size-5" />
              Search
            </button>
            {filtered && (
              <Link href={`/departments/${id}`} className={`${buttonSecondary} flex-1 md:flex-none`}>
                Clear
              </Link>
            )}
          </div>
        </form>
        {department.can_upload && session.canUpload ? (
          <Link href={uploadHref} className={`${buttonPrimary} lg:ml-2`}>
            <Icon name="upload" className="size-5" />
            Upload to this department
          </Link>
        ) : (
          <p className="text-sm text-muted lg:max-w-56">
            {department.is_active ? 'Your account cannot upload documents.' : 'New documents cannot be added here.'}
          </p>
        )}
      </div>

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
