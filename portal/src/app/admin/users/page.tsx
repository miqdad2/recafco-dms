import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Notice, Pagination, buttonPrimary, fieldClass } from '@/components/ui';
import { type AdminDepartment, type AdminUser, adminGet, requireAdmin } from '@/lib/admin';
import type { Page } from '@/lib/mayan';
import { AdminShell, NotAuthorized, sectionAllowed, adminTable, adminTd, adminTh } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users – Administration' };

export default async function AdminUsersPage({ searchParams }: PageProps<'/admin/users'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'users')) return <NotAuthorized session={session} />;
  const params = await searchParams;
  const q = String(params.q ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const deleted = params.deleted === '1';
  const [users, departments] = await Promise.all([
    adminGet<Page<AdminUser>>(session, `/users/?${new URLSearchParams({ q, page: String(page) })}`),
    adminGet<{ results: AdminDepartment[] }>(session, '/departments/'),
  ]);
  const names = new Map(departments.results.map((d) => [d.id, d.name]));
  const list = (values: number[]) => values.map((id) => names.get(id)).filter(Boolean).join(', ');

  return (
    <AdminShell access={access} section="users" title="Users" crumbs={[{ label: 'Users' }]}>
      {deleted && (
        <Notice tone="ok" role="status">
          The account was deleted. Its documents and activity history are kept with the person’s name.
        </Notice>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form role="search" className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end" action="/admin/users">
          <div className="sm:flex-1">
            <label htmlFor="user-search" className="mb-1.5 block text-base font-semibold">
              Find a person
            </label>
            <input id="user-search" name="q" type="search" defaultValue={q} placeholder="Name, username or email" className={fieldClass} />
          </div>
          <button type="submit" className={buttonPrimary}>
            <Icon name="search" className="size-6" /> Find
          </button>
        </form>
        <Link href="/admin/users/new" className={buttonPrimary}>
          Create user
        </Link>
      </div>
      <p className="text-base text-muted">Mayan system accounts (superusers and staff) are managed by IT and are not listed.</p>

      {users.results.length === 0 ? (
        <p className="rounded-lg bg-surface p-5 text-lg">No people found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className={adminTable}>
            <caption className="sr-only">Users</caption>
            <thead className="border-b border-line bg-canvas">
              <tr>
                <th scope="col" className={adminTh}>Person</th>
                <th scope="col" className={adminTh}>Roles</th>
                <th scope="col" className={adminTh}>Department</th>
                <th scope="col" className={adminTh}>Controller for</th>
                <th scope="col" className={adminTh}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.results.map((user) => (
                <tr key={user.id}>
                  <td className={adminTd}>
                    <Link href={`/admin/users/${user.id}`} className="text-lg font-semibold text-brand underline-offset-4 hover:underline">
                      {user.full_name}
                    </Link>
                    <span className="block text-muted">{user.username}</span>
                  </td>
                  <td className={adminTd}>
                    {[
                      user.is_employee && 'Employee',
                      user.is_administrator && 'System Administrator',
                      user.controller_department_ids.length > 0 && 'Controller',
                      ...user.roles.map((role) => role.name),
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                  <td className={adminTd}>{list(user.department_ids) || '—'}</td>
                  <td className={adminTd}>{list(user.controller_department_ids) || '—'}</td>
                  <td className={adminTd}>
                    <span className={`inline-flex rounded-full px-3 py-1 font-semibold ${user.is_active ? 'bg-ok-soft text-ok' : 'bg-canvas text-muted'}`}>
                      {user.is_active ? 'Active' : 'Deactivated'}
                    </span>
                    {user.is_active && user.must_change_password && (
                      <span className="mt-1 block text-base text-muted">Temporary password</span>
                    )}
                    {user.locked_out && <span className="mt-1 block text-base font-semibold text-brand-strong">Sign-in locked</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        count={users.count}
        pageSize={users.page_size}
        hrefFor={(p) => `/admin/users?${new URLSearchParams({ q, page: String(p) })}`}
      />
    </AdminShell>
  );
}
