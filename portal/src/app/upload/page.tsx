import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Breadcrumb, Notice, PageHeader, buttonSecondary } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { config } from '@/lib/config';
import { getOptions } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { UploadForm } from './upload-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload documents' };

export default async function UploadPage({ searchParams }: PageProps<'/upload'>) {
  const session = await requireSession();
  const requestedId = parseId(String((await searchParams).department ?? ''));

  if (!session.canUpload) {
    return (
      <AppShell session={session} section="departments">
        <Breadcrumb items={[{ href: '/', label: 'Departments' }, { label: 'Upload documents' }]} />
        <PageHeader title="Upload documents" />
        <p className="text-base">Your account cannot upload documents. Ask IT if you need this.</p>
        <Link href="/" className={`${buttonSecondary} self-start`}>
          Back to Departments
        </Link>
      </AppShell>
    );
  }
  const options = await withMayan(() => getOptions(session.token));
  // Preselect only an active department; the server validates it again.
  const preselected = options.departments.find((department) => department.id === requestedId);

  return (
    <AppShell session={session} section="departments">
      <Breadcrumb
        items={[
          { href: '/', label: 'Departments' },
          ...(preselected ? [{ href: `/departments/${preselected.id}`, label: preselected.name }] : []),
          { label: 'Upload documents' },
        ]}
      />
      <div className="flex w-full max-w-[52rem] flex-col gap-5">
        <PageHeader title="Upload documents" description="Add one document at a time. You can find it again under My uploads." />
        {requestedId !== null && !preselected && (
          <Notice tone="wait" role="status">
            That department is not available for new documents. Choose a department below.
          </Notice>
        )}
        <UploadForm
          departments={options.departments}
          categories={options.categories}
          defaultDepartment={preselected?.name ?? ''}
          confidentialGroups={options.confidential_groups}
          maxBytes={config.maxUploadBytes}
          cancelHref={preselected ? `/departments/${preselected.id}` : '/'}
        />
      </div>
    </AppShell>
  );
}
