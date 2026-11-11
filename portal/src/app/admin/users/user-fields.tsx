import { fieldClass } from '@/components/ui';
import type { AdminDepartment, AdminUser } from '@/lib/admin';

/** Name, roles and department fields shared by "Create user" and "Edit user". */
export function UserFields({ departments, user }: { departments: AdminDepartment[]; user?: AdminUser }) {
  // Inactive departments are listed only when already assigned, so they can be removed.
  const visible = (assigned: number[]) => departments.filter((d) => d.is_active || assigned.includes(d.id));
  const memberOf = user?.department_ids ?? [];
  const controls = user?.controller_department_ids ?? [];

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="first_name" className="mb-1.5 block text-base font-semibold">
            First name
          </label>
          <input id="first_name" name="first_name" defaultValue={user?.first_name} maxLength={150} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="last_name" className="mb-1.5 block text-base font-semibold">
            Last name
          </label>
          <input id="last_name" name="last_name" defaultValue={user?.last_name} maxLength={150} className={fieldClass} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="email" className="mb-1.5 block text-base font-semibold">
            Email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="email" name="email" type="email" defaultValue={user?.email} className={fieldClass} />
        </div>
      </div>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-lg font-semibold">Roles</legend>
        <label className="flex min-h-12 items-start gap-3 text-lg">
          <input type="checkbox" name="is_employee" defaultChecked={user ? user.is_employee : true} className="mt-1 size-6 shrink-0" />
          <span>
            Employee <span className="block text-base text-muted">Can sign in, open general documents and upload.</span>
          </span>
        </label>
        <label className="mt-2 flex min-h-12 items-start gap-3 text-lg">
          <input type="checkbox" name="is_administrator" defaultChecked={user?.is_administrator} className="mt-1 size-6 shrink-0" />
          <span>
            RECAFCO administrator
            <span className="block text-base text-muted">
              Can use this administration area. Does not give access to confidential documents.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-lg font-semibold">Department</legend>
        <p className="mb-2 text-base text-muted">Where this person works. It does not limit what they can open or where they can upload.</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {visible(memberOf).map((department) => (
            <label key={department.id} className="flex min-h-12 items-center gap-3 text-lg">
              <input type="checkbox" name="department_ids" value={department.id} defaultChecked={memberOf.includes(department.id)} className="size-6 shrink-0" />
              <span className="break-words">
                {department.name}
                {!department.is_active && ' (deactivated)'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-lg font-semibold">Department controller for</legend>
        <p className="mb-2 text-base text-muted">
          A controller can correct the title, category and department of documents in these departments, and move them only
          between these departments. Leave empty if this person is not a controller.
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {visible(controls).map((department) => (
            <label key={department.id} className="flex min-h-12 items-center gap-3 text-lg">
              <input
                type="checkbox"
                name="controller_department_ids"
                value={department.id}
                defaultChecked={controls.includes(department.id)}
                className="size-6 shrink-0"
              />
              <span className="break-words">
                {department.name}
                {!department.is_active && ' (deactivated)'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export const USER_LABELS: Record<string, string> = {
  username: 'Username',
  password: 'Password',
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  department_ids: 'Department',
  controller_department_ids: 'Controller for',
  is_active: 'Account',
  is_administrator: 'Administrator',
};
