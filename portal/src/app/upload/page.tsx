import { AppShell } from '@/components/app-shell';
import { Breadcrumb, Notice, PageTitle } from '@/components/ui';
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
        <PageTitle>Upload documents</PageTitle>
        <p className="text-lg">Your account cannot upload documents. Ask IT if you need this.</p>
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
      <PageTitle>Upload documents</PageTitle>
      {requestedId !== null && !preselected && (
        <Notice tone="wait" role="status">
          That department is not available for new documents. Choose a department below.
        </Notice>
      )}
      <p className="max-w-3xl text-lg text-muted">
        {options.confidential_groups.length > 0
          ? 'Normally everyone at RECAFCO can find and open what you upload. As an administrator you can instead choose one confidential group below. '
          : 'Everyone at RECAFCO who can sign in will be able to find and open this document. '}
        Your name and the upload date are shown next to it.
      </p>
      <UploadForm
        departments={options.departments}
        categories={options.categories}
        defaultDepartment={preselected?.name ?? ''}
        confidentialGroups={options.confidential_groups}
        maxBytes={config.maxUploadBytes}
      />
    </AppShell>
  );
}
