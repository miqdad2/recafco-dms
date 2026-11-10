import { Pagination } from '@/components/ui';
import { type AuditEntry, adminGet, requireAdmin } from '@/lib/admin';
import type { Page } from '@/lib/mayan';
import { ActivityList } from '../activity-list';
import { AdminShell, NotAuthorized } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity log' };

export default async function ActivityPage({ searchParams }: PageProps<'/admin/activity'>) {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const page = Math.max(1, Math.min(10000, Number((await searchParams).page) || 1));
  const data = await adminGet<Page<AuditEntry>>(session, `/audit/?page=${page}`);

  return (
    <AdminShell session={session} section="activity" title="Activity log" crumbs={[{ label: 'Activity log' }]}>
      <p className="text-lg text-muted">Every change made in this administration area, newest first. Entries cannot be edited or removed.</p>
      <ActivityList entries={data.results} />
      <Pagination page={page} count={data.count} pageSize={data.page_size} hrefFor={(p) => `/admin/activity?page=${p}`} />
    </AdminShell>
  );
}
