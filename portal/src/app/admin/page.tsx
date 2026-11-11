import Link from 'next/link';
import { type AuditEntry, adminGet, requireAdmin } from '@/lib/admin';
import { AdminShell, NotAuthorized } from './admin-shell';
import { ActivityList } from './activity-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administration' };

type Overview = {
  counts: Record<
    | 'active_users'
    | 'administrators'
    | 'categories'
    | 'confidential_groups'
    | 'controllers'
    | 'departments'
    | 'employees'
    | 'inactive_users',
    number
  >;
  recent_activity: AuditEntry[];
};

export default async function AdminHome() {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const data = await adminGet<Overview>(session, '/overview/');
  const c = data.counts;

  const tiles = [
    { href: '/admin/departments', label: 'Departments', value: c.departments, note: 'active' },
    { href: '/admin/categories', label: 'Categories', value: c.categories, note: 'active' },
    { href: '/admin/users', label: 'Users', value: c.active_users, note: `active · ${c.inactive_users} deactivated` },
    { href: '/admin/users', label: 'Department controllers', value: c.controllers, note: 'people' },
    { href: '/admin/users', label: 'Administrators', value: c.administrators, note: 'people' },
    { href: '/admin/confidential-groups', label: 'Confidential groups', value: c.confidential_groups, note: 'groups' },
  ];

  return (
    <AdminShell session={session} section="overview" title="Administration">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link href={tile.href} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-surface p-4 hover:border-line-strong hover:bg-hover">
              <span className="text-lg font-semibold text-muted">{tile.label}</span>
              <span className="text-2xl font-bold tabular-nums">{tile.value}</span>
              <span className="text-base text-muted">{tile.note}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recent" className="text-xl font-bold">
            Recent changes
          </h2>
          <Link href="/admin/activity" className="text-lg font-semibold text-brand underline-offset-4 hover:underline">
            Full activity log
          </Link>
        </div>
        <ActivityList entries={data.recent_activity} />
      </section>

      <section aria-labelledby="elsewhere" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="elsewhere" className="text-lg font-bold">
          Not done here
        </h2>
        <p className="mt-2 text-lg text-muted">
          Server, backup, database and Mayan system settings are handled by IT outside this area. Nothing here can delete
          documents, departments, categories or accounts: they are deactivated instead, and their history is kept.
        </p>
      </section>
    </AdminShell>
  );
}
