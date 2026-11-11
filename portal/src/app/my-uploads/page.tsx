import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { DocumentTable, EmptyState, PageHeader, buttonPrimary } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getMyUploads } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My uploads' };

export default async function MyUploadsPage() {
  const session = await requireSession();
  const documents = await withMayan(() => getMyUploads(session.token));
  const upload = session.canUpload ? (
    <Link href="/upload" className={buttonPrimary}>
      <Icon name="upload" className="size-5" />
      Upload documents
    </Link>
  ) : null;

  return (
    <AppShell session={session} section="uploads">
      <PageHeader
        title="My uploads"
        description={documents.length > 0 ? `Your latest ${documents.length} uploads, newest first.` : undefined}
        actions={documents.length > 0 ? upload : undefined}
      />
      {documents.length === 0 ? (
        <EmptyState title="You have not uploaded any documents yet." icon="upload">
          <p className="text-base text-muted">Documents you upload are listed here, newest first.</p>
          {upload && <div>{upload}</div>}
        </EmptyState>
      ) : (
        <DocumentTable documents={documents} showDepartment caption="My uploads" />
      )}
    </AppShell>
  );
}
