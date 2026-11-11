import Link from 'next/link';
import { Icon } from '@/components/icons';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { Notice, buttonPrimary, buttonSecondary, fieldClass, formatDate } from '@/components/ui';
import { type AdminDepartment, type AdminRole, type AdminUser, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import type { UserRef } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { PasswordInput } from '@/components/password-input';
import { deleteUser, resetUserPassword, setUserActive, setUserRoles, updateUser } from '../../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../../admin-shell';
import { USER_LABELS, UserFields } from '../user-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User – Administration' };

export default async function AdminUserPage({ params, searchParams }: PageProps<'/admin/users/[id]'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'users')) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [user, departments, roles, choices] = await Promise.all([
    adminGetOrNull<AdminUser>(session, `/users/${id}/`),
    adminGet<{ results: AdminDepartment[] }>(session, '/departments/'),
    access.isSystemAdmin ? adminGet<{ results: AdminRole[] }>(session, '/roles/') : Promise.resolve({ results: [] as AdminRole[] }),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
  ]);
  if (!user) notFound();
  const created = (await searchParams).created === '1';
  const isSelf = user.username === session.username;
  // Only System Administrators may change a System Administrator's account.
  const locked = user.is_administrator && !access.isSystemAdmin;
  const customRoles = roles.results.filter((role) => !role.is_protected);

  return (
    <AdminShell
      access={access}
      section="users"
      title={user.full_name}
      crumbs={[{ href: '/admin/users', label: 'Users and roles' }, { label: user.full_name }]}
    >
      {created && (
        <Notice tone="ok" role="status">
          The account “{user.username}” was created.
        </Notice>
      )}
      <p className="text-lg text-muted">
        Username <strong className="text-ink">{user.username}</strong> · {user.is_active ? 'Active' : 'Deactivated'} · Last
        sign-in {user.last_login ? formatDate(user.last_login) : 'never'}
      </p>
      {user.must_change_password && (
        <Notice tone="info" role="status">
          This person has a temporary password and must choose their own at their next sign-in.
        </Notice>
      )}
      {locked && (
        <Notice tone="info" role="status">
          This is a System Administrator. Only System Administrators can change, reset or delete this account.
        </Notice>
      )}
      {user.locked_out && (
        <Notice tone="error" role="status">
          Sign-in is locked after too many wrong passwords. It unlocks by itself after 15 minutes, or reset the password
          below to unlock it now.
        </Notice>
      )}

      <section aria-labelledby="details" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="details" className="mb-4 text-lg font-bold">
          Name, roles and departments
        </h2>
        <ActionForm
          action={updateUser.bind(null, user.id)}
          className="flex max-w-4xl flex-col gap-5"
          submit="Save changes"
          submitClassName={buttonPrimary}
          labels={USER_LABELS}
        >
          <UserFields departments={departments.results} user={user} canSetAdministrator={access.isSystemAdmin} />
        </ActionForm>
      </section>

      {access.isSystemAdmin && (
        <section aria-labelledby="roles" className="rounded-lg border border-wait/40 bg-surface p-4 sm:p-6">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
            <Icon name="lock" className="size-4" />
            Access change
          </p>
          <h2 id="roles" className="text-lg font-bold">
            Roles
          </h2>
          <p className="mt-1 text-base text-muted">
            Roles open parts of this administration area. Only System Administrators can assign them.
          </p>
          <ActionForm
            action={setUserRoles.bind(null, user.id)}
            className="mt-3 flex flex-col gap-3"
            submit="Save roles"
            submitClassName={buttonSecondary}
          >
            <label className="flex min-h-11 items-start gap-3 text-base">
              <input
                type="checkbox"
                name="system_administrator"
                defaultChecked={user.is_administrator}
                disabled={isSelf}
                className="mt-1 size-5 shrink-0"
              />
              <span>
                <strong>System Administrator</strong> (protected role)
                <span className="block text-sm text-muted">
                  Every permission, including every confidential document and roles.
                  {isSelf && ' You cannot remove your own System Administrator role.'}
                </span>
              </span>
            </label>
            {isSelf && user.is_administrator && <input type="hidden" name="system_administrator" value="on" />}
            {customRoles.length === 0 ? (
              <p className="text-base text-muted">
                No other roles yet. <Link href="/admin/roles" className="font-semibold text-brand underline underline-offset-4">Create a role</Link>.
              </p>
            ) : (
              customRoles.map((role) => (
                <label key={role.id} className="flex min-h-11 items-start gap-3 text-base">
                  <input
                    type="checkbox"
                    name="role_ids"
                    value={role.id}
                    defaultChecked={user.roles.some((item) => item.id === role.id)}
                    className="mt-1 size-5 shrink-0"
                  />
                  <span>
                    <strong>{role.name}</strong>
                    {role.description && <span className="block text-sm text-muted">{role.description}</span>}
                  </span>
                </label>
              ))
            )}
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="confidential" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="confidential" className="text-lg font-bold">
          Confidential access
        </h2>
        {user.confidential_groups.length === 0 ? (
          <p className="mt-2 text-lg text-muted">Not a member of any confidential group.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {user.confidential_groups.map((group) => (
              <li key={group.id}>
                <Link href={`/admin/confidential-groups/${group.id}`} className="inline-flex min-h-12 items-center rounded-lg border border-line px-4 text-base font-semibold hover:border-line-strong hover:bg-hover">
                  {group.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-base text-muted">Membership is changed on each confidential group’s page.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="password" className="rounded-lg border border-wait/40 bg-surface p-4 sm:p-6">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
            <Icon name="lock" className="size-4" />
            Access change
          </p>
          <h2 id="password" className="text-lg font-bold">
            Reset password
          </h2>
          {isSelf ? (
            <p className="mt-2 text-lg text-muted">
              To change your own password, use{' '}
              <Link href="/change-password" className="font-semibold text-brand underline underline-offset-4">
                Change password
              </Link>
              .
            </p>
          ) : (
            <ActionForm
              action={resetUserPassword.bind(null, user.id)}
              resetOnSuccess
              className="mt-2 flex flex-col gap-4"
              submit="Reset password"
              submitClassName={buttonSecondary}
              labels={USER_LABELS}
              confirm={`Reset the password of ${user.full_name}? They are signed out everywhere at once.`}
            >
              <p className="text-lg text-muted">
                Use this when someone forgot their password. They are signed out everywhere and must choose a new password
                when they sign in with the temporary one.
              </p>
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-base font-semibold">
                  Temporary password
                </label>
                <PasswordInput id="new-password" name="password" autoComplete="off" describedBy="new-password-hint" />
                <p id="new-password-hint" className="mt-1 text-base text-muted">
                  Anything simple, for example “123”. Tell it to the person privately.
                </p>
              </div>
            </ActionForm>
          )}
        </section>

        <section aria-labelledby="status" className="rounded-lg border border-wait/40 bg-surface p-4 sm:p-6">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
            <Icon name="lock" className="size-4" />
            Access change
          </p>
          <h2 id="status" className="text-lg font-bold">
            {user.is_active ? 'Deactivate account' : 'Reactivate account'}
          </h2>
          {isSelf ? (
            <p className="mt-2 text-lg text-muted">You cannot deactivate your own account.</p>
          ) : (
            <ActionForm
              action={setUserActive.bind(null, user.id, !user.is_active)}
              className="mt-2 flex flex-col gap-4"
              submit={user.is_active ? 'Deactivate account' : 'Reactivate account'}
              submitClassName={buttonSecondary}
              confirm={user.is_active ? `Deactivate ${user.full_name}? They are signed out at once. Their documents and history are kept.` : undefined}
            >
              <p className="text-lg text-muted">
                {user.is_active
                  ? 'The person can no longer sign in and is signed out everywhere. Their documents stay, with their name as uploader.'
                  : 'The person can sign in again with their password.'}
              </p>
            </ActionForm>
          )}
        </section>
      </div>

      {!isSelf && !locked && (
        <section aria-labelledby="delete-account" className="rounded-lg border border-brand/40 bg-surface p-4 sm:p-6">
          <h2 id="delete-account" className="text-lg font-bold">
            Delete account
          </h2>
          <p className="mt-1 text-base text-muted">
            Removes the account. Documents stay; their uploader and the activity log keep this person’s name.
          </p>
          <div className="mt-3">
            <DialogForm
              action={deleteUser.bind(null, user.id)}
              formId="delete-user"
              trigger="Delete account…"
              title={`Delete the account of ${user.full_name}`}
              confirmLabel="Delete account"
              danger
              irreversible
              summary={
                <ul className="list-disc pl-5">
                  <li>
                    Uploaded documents: <strong>{user.usage?.uploaded_documents ?? 0}</strong> (kept, uploader name kept)
                  </li>
                  <li>
                    Documents this person is responsible for: <strong>{user.usage?.responsible_for ?? 0}</strong>
                  </li>
                  <li>
                    Activity log entries by this person: <strong>{user.usage?.activity_entries ?? 0}</strong> (kept)
                  </li>
                  <li>They are signed out everywhere at once.</li>
                </ul>
              }
            >
              <div>
                <label htmlFor="transfer_to" className="mb-1.5 block text-base font-semibold">
                  Transfer responsibility to <span className="font-normal text-muted">(optional)</span>
                </label>
                <select id="transfer_to" name="transfer_to" defaultValue="" className={fieldClass}>
                  <option value="">Nobody: fall back to each document’s original uploader</option>
                  {choices.results
                    .filter((item) => item.id !== user.id && item.is_active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.full_name} ({item.username})
                      </option>
                    ))}
                </select>
              </div>
            </DialogForm>
          </div>
        </section>
      )}
    </AdminShell>
  );
}
