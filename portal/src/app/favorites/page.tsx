import { AppShell } from '@/components/app-shell';
import { DocumentTable, EmptyState, PageTitle } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getFavorites } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Favorites' };

export default async function FavoritesPage() {
  const session = await requireSession();
  const documents = await withMayan(() => getFavorites(session.token));

  return (
    <AppShell session={session} section="favorites">
      <PageTitle>Favorites</PageTitle>
      {documents.length === 0 ? (
        <EmptyState title="You have no favorite documents yet." icon="star">
          <p className="text-lg text-muted">
            Open a document and choose <strong>Add to favorites</strong> to find it here quickly.
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="text-lg text-muted">Documents you marked, most recent first.</p>
          <DocumentTable documents={documents} showDepartment caption="Favorite documents" />
        </>
      )}
    </AppShell>
  );
}
