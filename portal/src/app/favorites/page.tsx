import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { DocumentTable, EmptyState, PageHeader, buttonSecondary } from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getFavorites } from '@/lib/mayan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Favorites' };

export default async function FavoritesPage() {
  const session = await requireSession();
  const documents = await withMayan(() => getFavorites(session.token));

  return (
    <AppShell session={session} section="favorites">
      <PageHeader
        title="Favorites"
        description={documents.length > 0 ? 'Documents you marked, most recent first.' : undefined}
      />
      {documents.length === 0 ? (
        <EmptyState title="You have no favorite documents yet." icon="star">
          <p className="text-base text-muted">
            Open a document and choose <strong>Add to favorites</strong> to find it here quickly.
          </p>
          <div>
            <Link href="/" className={buttonSecondary}>
              <Icon name="folder" className="size-5" />
              Browse departments
            </Link>
          </div>
        </EmptyState>
      ) : (
        <DocumentTable documents={documents} showDepartment caption="Favorite documents" />
      )}
    </AppShell>
  );
}
