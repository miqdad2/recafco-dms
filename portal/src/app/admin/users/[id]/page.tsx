import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Notice, buttonPrimary, buttonSecondary, fieldClass, formatDate } from '@/components/ui';
import { type AdminDepartment, type AdminUser, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import { parseId } from '@/lib/route-helpers';
import { setUserActive, setUserPassword, updateUser } from '../../actions';
import { AdminShell, NotAuthorized } from '../../admin-shell';
import { USER_LABELS, UserFields } from '../user-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User – Administration' };

export default async function AdminUserPage({ params, searchParams }: PageProps<'/admin/users/[id]'>) {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [user, departments] = await Promise.all([
    adminGetOrNull<AdminUser>(session, `/users/${id}/`),
    adminGet<{ results: AdminDepartment[] }>(session, '/departments/'),
  ]);
  if (!user) notFound();
  const created = (await searchParams).created === '1';
  const isSelf = user.username === session.username;

  return (
    <AdminShell
      session={session}
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

      <section aria-labelledby="details" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 id="details" className="mb-4 text-xl font-bold">
          Name, roles and departments
        </h2>
        <ActionForm
          action={updateUser.bind(null, user.id)}
          className="flex max-w-4xl flex-col gap-5"
          submit="Save changes"
          submitClassName={buttonPrimary}
          labels={USER_LABELS}
        >
          <UserFields departments={departments.results} user={user} />
        </ActionForm>
      </section>

      <section aria-labelledby="confidential" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 id="confidential" className="text-xl font-bold">
          Confidential access
        </h2>
        {user.confidential_groups.length === 0 ? (
          <p className="mt-2 text-lg text-muted">Not a member of any confidential group.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {user.confidential_groups.map((group) => (
              <li key={group.id}>
                <Link href={`/admin/confidential-groups/${group.id}`} className="inline-flex min-h-12 items-center rounded-xl border-2 border-line px-4 text-base font-semibold hover:border-ink">
                  {group.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-base text-muted">Membership is changed on each confidential group’s page.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="password" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h2 id="password" className="text-xl font-bold">
            Set a new password
          </h2>
          <ActionForm
            action={setUserPassword.bind(null, user.id)}
            resetOnSuccess
            className="mt-4 flex flex-col gap-4"
            submit="Save new password"
            submitClassName={buttonSecondary}
            labels={USER_LABELS}
          >
            <div>
              <label htmlFor="new-password" className="mb-2 block text-lg font-semibold">
                New password
              </label>
              <input id="new-password" name="password" type="password" required minLength={10} autoComplete="new-password" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="new-password-again" className="mb-2 block text-lg font-semibold">
                Type it again
              </label>
              <input id="new-password-again" name="password_again" type="password" required minLength={10} autoComplete="new-password" className={fieldClass} />
            </div>
          </ActionForm>
        </section>

        <section aria-labelledby="status" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h2 id="status" className="text-xl font-bold">
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
    </AdminShell>
  );
}
