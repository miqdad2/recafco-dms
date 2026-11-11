import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { Notice, buttonPrimary } from '@/components/ui';
import { type AdminRole, type AppPermissionInfo, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import { parseId } from '@/lib/route-helpers';
import { deleteRole, updateRole } from '../../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../../admin-shell';
import { RoleFields } from '../role-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Role – Administration' };

export default async function AdminRolePage({ params, searchParams }: PageProps<'/admin/roles/[id]'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'roles')) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [role, catalog] = await Promise.all([
    adminGetOrNull<AdminRole>(session, `/roles/${id}/`),
    adminGet<{ permissions: AppPermissionInfo[] }>(session, '/roles/'),
  ]);
  if (!role) notFound();
  const created = (await searchParams).created === '1';

  return (
    <AdminShell access={access} section="roles" title={role.name} crumbs={[{ href: '/admin/roles', label: 'Roles' }, { label: role.name }]}>
      {created && (
        <Notice tone="ok" role="status">
          The role was created. Assign it on each person’s page under Users.
        </Notice>
      )}
      {role.is_protected ? (
        <Notice>
          System Administrator is the protected built-in role. It has every permission, including every confidential document
          and role management, and cannot be changed or deleted. Give or remove it on each person’s page.
        </Notice>
      ) : (
        <section aria-labelledby="edit-role" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
          <h2 id="edit-role" className="mb-3 text-lg font-bold">
            Name and permissions
          </h2>
          <ActionForm
            action={updateRole.bind(null, role.id)}
            className="flex flex-col gap-4"
            submit="Save role"
            submitClassName={buttonPrimary}
            labels={{ name: 'Name', permissions: 'Permissions', description: 'Description' }}
          >
            <RoleFields permissions={catalog.permissions} role={role} />
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="members" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="members" className="text-lg font-bold">
          Members ({role.member_count})
        </h2>
        {role.members.length === 0 ? (
          <p className="mt-2 text-base text-muted">Nobody has this role yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {role.members.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/admin/users/${member.id}`}
                  className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-base font-semibold hover:bg-hover"
                >
                  {member.full_name}
                  {!member.is_active && <span className="ml-1 font-normal text-muted">(deactivated)</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!role.is_protected && (
        <section aria-labelledby="delete-role" className="rounded-lg border border-brand/40 bg-surface p-4 sm:p-6">
          <h2 id="delete-role" className="text-lg font-bold">
            Delete role
          </h2>
          <div className="mt-3">
            <DialogForm
              action={deleteRole.bind(null, role.id)}
              formId="delete-role-form"
              trigger="Delete role…"
              title={`Delete the role “${role.name}”`}
              confirmLabel="Delete role"
              danger
              summary={
                <p>
                  <strong>{role.member_count}</strong> {role.member_count === 1 ? 'person loses' : 'people lose'} the permissions
                  of this role at once. Their accounts are not changed otherwise.
                </p>
              }
            />
          </div>
        </section>
      )}
    </AdminShell>
  );
}
