import { fieldClass } from '@/components/ui';
import type { AdminRole, AppPermissionInfo } from '@/lib/admin';

/** Name, description and the grantable permissions of an application role. */
export function RoleFields({ permissions, role }: { permissions: AppPermissionInfo[]; role?: AdminRole }) {
  const granted = new Set(role?.permissions ?? []);
  const prefix = role ? `role-${role.id}` : 'new-role';
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-name`} className="mb-1.5 block text-base font-semibold">
            Name
          </label>
          <input id={`${prefix}-name`} name="name" defaultValue={role?.name} required maxLength={60} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${prefix}-description`} className="mb-1.5 block text-base font-semibold">
            Description <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={`${prefix}-description`} name="description" defaultValue={role?.description} maxLength={255} className={fieldClass} />
        </div>
      </div>
      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-base font-semibold">Permissions</legend>
        <p className="mb-2 text-sm text-muted">
          Permissions open parts of the administration area. Document actions apply only to documents the person can already
          open. Managing roles is reserved for System Administrators.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {permissions
            .filter((permission) => permission.grantable)
            .map((permission) => (
              <label key={permission.key} className="flex min-h-11 items-start gap-3 text-base">
                <input
                  type="checkbox"
                  name="permissions"
                  value={permission.key}
                  defaultChecked={granted.has(permission.key)}
                  className="mt-1 size-5 shrink-0"
                />
                <span>
                  <strong>{permission.label}</strong>
                  <span className="block text-sm text-muted">{permission.description}</span>
                </span>
              </label>
            ))}
        </div>
      </fieldset>
    </>
  );
}
