import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Icon } from '@/components/icons';
import { Notice, buttonPrimary } from '@/components/ui';
import { type AdminRole, type AppPermissionInfo, adminGet, requireAdmin } from '@/lib/admin';
import { createRole } from '../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../admin-shell';
import { RoleFields } from './role-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Roles – Administration' };

export default async function AdminRolesPage({ searchParams }: PageProps<'/admin/roles'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'roles')) return <NotAuthorized session={session} />;
  const data = await adminGet<{ permissions: AppPermissionInfo[]; results: AdminRole[] }>(session, '/roles/');
  const deleted = (await searchParams).deleted === '1';
  const labels = new Map(data.permissions.map((permission) => [permission.key, permission.label]));

  return (
    <AdminShell access={access} section="roles" title="Roles" crumbs={[{ label: 'Roles' }]}>
      {deleted && (
        <Notice tone="ok" role="status">
          The role was deleted and removed from its members.
        </Notice>
      )}
      <p className="max-w-3xl text-base text-muted">
        A role is a set of permissions for this administration area. Assign roles on each person’s page. Only System
        Administrators can manage roles or give anyone administrative authority.
      </p>

      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {data.results.map((role) => (
          <li key={role.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <Link href={`/admin/roles/${role.id}`} className="text-lg font-semibold text-brand underline-offset-4 hover:underline">
                {role.name}
              </Link>
              {role.is_protected && (
                <span className="ml-2 inline-flex items-center gap-1 rounded border border-line px-1.5 text-xs font-semibold text-muted uppercase">
                  <Icon name="lock" className="size-3" />
                  Protected
                </span>
              )}
              {role.description && <p className="text-sm text-muted">{role.description}</p>}
              <p className="mt-1 text-sm text-muted wrap-anywhere">
                {role.is_protected
                  ? 'All permissions'
                  : role.permissions.map((key) => labels.get(key) ?? key).join(' · ') || 'No permissions yet'}
              </p>
            </div>
            <p className="shrink-0 text-sm text-muted">
              {role.member_count} {role.member_count === 1 ? 'member' : 'members'}
            </p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="new-role" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="new-role" className="mb-3 text-lg font-bold">
          Create a role
        </h2>
        <ActionForm
          action={createRole}
          className="flex flex-col gap-4"
          submit="Create role"
          submitClassName={buttonPrimary}
          labels={{ name: 'Name', permissions: 'Permissions', description: 'Description' }}
        >
          <RoleFields permissions={data.permissions} />
        </ActionForm>
      </section>
    </AdminShell>
  );
}
