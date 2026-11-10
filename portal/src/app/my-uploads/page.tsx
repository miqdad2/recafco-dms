import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { DocumentTable, EmptyState, PageTitle, buttonPrimary } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getMyUploads } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My uploads' };

export default async function MyUploadsPage() {
  const session = await requireSession();
  const documents = await withMayan(() => getMyUploads(session.token));

  return (
    <AppShell session={session} section="uploads">
      <PageTitle>My uploads</PageTitle>
      {documents.length === 0 ? (
        <EmptyState title="You have not uploaded any documents yet." icon="upload">
          {session.canUpload && (
            <Link href="/upload" className={`${buttonPrimary} self-start`}>
              Upload documents
            </Link>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="text-lg text-muted">Your latest {documents.length} uploads, newest first.</p>
          <DocumentTable documents={documents} showDepartment caption="My uploads" />
        </>
      )}
    </AppShell>
  );
}
