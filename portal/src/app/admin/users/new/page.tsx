import { ActionForm } from '@/components/action-form';
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
        className="flex max-w-4xl flex-col gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6"
        submit="Create user"
        pendingText="Creating…"
        submitClassName={buttonPrimary}
        labels={USER_LABELS}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="username" className="mb-2 block text-lg font-semibold">
              Username
            </label>
            <input id="username" name="username" required maxLength={150} autoComplete="off" spellCheck={false} className={fieldClass} />
            <p className="mt-1 text-base text-muted">Letters, numbers and . @ + - _ only. Cannot be changed later.</p>
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-lg font-semibold">
              First password
            </label>
            <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={fieldClass} />
            <p className="mt-1 text-base text-muted">At least 10 characters. Give it to the person privately.</p>
          </div>
        </div>
        <UserFields departments={departments.results} />
      </ActionForm>
    </AdminShell>
  );
}
