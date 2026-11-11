import { ActionForm } from '@/components/action-form';
import { PasswordInput } from '@/components/password-input';
import { buttonPrimary, fieldClass } from '@/components/ui';
import { type AdminDepartment, adminGet, requireAdmin } from '@/lib/admin';
import { createUser } from '../../actions';
import { AdminShell, NotAuthorized } from '../../admin-shell';
import { USER_LABELS, UserFields } from '../user-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create user – Administration' };

export default async function NewUserPage() {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const departments = await adminGet<{ results: AdminDepartment[] }>(session, '/departments/');

  return (
    <AdminShell
      session={session}
      section="users"
      title="Create user"
      crumbs={[{ href: '/admin/users', label: 'Users and roles' }, { label: 'Create user' }]}
    >
      <ActionForm
        action={createUser}
        className="flex max-w-4xl flex-col gap-5 rounded-lg border border-line bg-surface p-4 sm:p-6"
        submit="Create user"
        pendingText="Creating…"
        submitClassName={buttonPrimary}
        labels={USER_LABELS}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-base font-semibold">
              Username
            </label>
            <input
              id="username"
              name="username"
              required
              maxLength={150}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="username-hint"
              className={fieldClass}
            />
            <p id="username-hint" className="mt-1 text-base text-muted">
              A name or an employee number, for example “ahmed.k” or “10452”. Saved in small letters; capitals do not matter
              when signing in. Cannot be changed later.
            </p>
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-base font-semibold">
              Temporary password
            </label>
            <PasswordInput id="password" name="password" autoComplete="off" describedBy="password-hint" />
            <p id="password-hint" className="mt-1 text-base text-muted">
              Anything simple, for example “123”. Tell it to the person privately. At their first sign-in they must choose their
              own password (at least 6 characters).
            </p>
          </div>
        </div>
        <UserFields departments={departments.results} />
      </ActionForm>
    </AdminShell>
  );
}
