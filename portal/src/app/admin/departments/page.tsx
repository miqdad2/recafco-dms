import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { Notice, SampleBadge, buttonPrimary, buttonSmall, fieldClass, DepartmentIcon } from '@/components/ui';
import { type AdminDepartment, adminGet, requireAdmin } from '@/lib/admin';
import { createDepartment, deleteDepartment, moveDepartment, setDepartmentActive, updateDepartment } from '../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../admin-shell';
import { DoneNotice } from '../done-notice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments – Administration' };

const ICON_LABELS: Record<string, string> = {
  folder: 'Folder',
  finance: 'Money (finance)',
  purchasing: 'Cart (purchasing)',
  projects: 'Building (projects)',
  factory: 'Factory (production)',
  people: 'People (HR)',
  truck: 'Truck (logistics)',
  quality: 'Badge (quality)',
  tools: 'Tools (maintenance)',
  computer: 'Computer (IT)',
  legal: 'Scales (legal)',
  sales: 'Chart (sales)',
  safety: 'Shield (safety)',
  warehouse: 'Warehouse (stores)',
};

function IconSelect({ id, value, icons }: { id: string; value: string; icons: string[] }) {
  return (
    <select id={id} name="icon" defaultValue={value} className={fieldClass}>
      {icons.map((icon) => (
        <option key={icon} value={icon}>
          {ICON_LABELS[icon] ?? icon}
        </option>
      ))}
    </select>
  );
}

export default async function AdminDepartmentsPage({ searchParams }: PageProps<'/admin/departments'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'departments')) return <NotAuthorized session={session} />;
  const data = await adminGet<{ icons: string[]; results: AdminDepartment[] }>(session, '/departments/');
  const departments = data.results;

  return (
    <AdminShell access={access} section="departments" title="Departments" crumbs={[{ label: 'Departments' }]}>
      <DoneNotice params={await searchParams} />
      <Notice>
        Departments organize documents; they never limit who can open a general document. A deactivated department
        disappears from the home page and from Upload, but its documents stay where they are.
      </Notice>

      <section aria-labelledby="add-department" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="add-department" className="text-lg font-bold">
          Add a department
        </h2>
        <ActionForm
          action={createDepartment}
          resetOnSuccess
          className="mt-4 grid gap-4 md:grid-cols-[1fr_16rem] md:items-end"
          submit="Add department"
          submitClassName={buttonPrimary}
          labels={{ name: 'Name', icon: 'Icon' }}
        >
          <div>
            <label htmlFor="new-name" className="mb-1.5 block text-base font-semibold">
              Name
            </label>
            <input id="new-name" name="name" required maxLength={100} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="new-icon" className="mb-1.5 block text-base font-semibold">
              Icon
            </label>
            <IconSelect id="new-icon" value="folder" icons={data.icons} />
          </div>
          <label className="flex min-h-12 items-center gap-3 text-lg md:col-span-2">
            <input type="checkbox" name="is_sample" className="size-6" />
            Sample name (placeholder until the real name is confirmed)
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="department-list" className="flex flex-col gap-3">
        <h2 id="department-list" className="text-lg font-bold">
          Order on the home page
        </h2>
        <ol className="flex flex-col gap-3">
          {departments.map((department, index) => (
            <li key={department.id} className={`rounded-lg border bg-surface p-4 sm:p-5 ${department.is_active ? 'border-line' : 'border-dashed border-line opacity-90'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DepartmentIcon id={department.id} icon={department.icon} />
                  <div className="min-w-0">
                    <p className="text-lg font-bold wrap-anywhere">{department.name}</p>
                    <p className="flex flex-wrap items-center gap-2 text-base text-muted">
                      {department.is_active ? 'Active' : 'Deactivated'} · {department.total_documents} documents
                      {department.is_sample && <SampleBadge />}
                    </p>
                    <p className="text-base text-muted">
                      Controllers:{' '}
                      {department.controllers.length ? department.controllers.map((user) => user.full_name).join(', ') : 'none'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={moveDepartment.bind(null, department.id, -1)}>
                    <button type="submit" className={buttonSmall} disabled={index === 0} aria-label={`Move ${department.name} up`}>
                      ↑ Up
                    </button>
                  </form>
                  <form action={moveDepartment.bind(null, department.id, 1)}>
                    <button
                      type="submit"
                      className={buttonSmall}
                      disabled={index === departments.length - 1}
                      aria-label={`Move ${department.name} down`}
                    >
                      ↓ Down
                    </button>
                  </form>
                  <DeleteDepartment department={department} others={departments.filter((item) => item.id !== department.id && item.is_active)} />
                </div>
              </div>

              <details className="mt-3">
                <summary className="min-h-12 cursor-pointer content-center text-lg font-semibold text-brand">
                  Change {department.name}
                </summary>
                <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
                  <ActionForm
                    action={updateDepartment.bind(null, department.id)}
                    className="grid gap-4 md:grid-cols-[1fr_16rem] md:items-end"
                    submit="Save"
                    submitClassName={buttonPrimary}
                    labels={{ name: 'Name', icon: 'Icon' }}
                  >
                    <div>
                      <label htmlFor={`name-${department.id}`} className="mb-1.5 block text-base font-semibold">
                        Name
                      </label>
                      <input id={`name-${department.id}`} name="name" defaultValue={department.name} required maxLength={100} className={fieldClass} />
                    </div>
                    <div>
                      <label htmlFor={`icon-${department.id}`} className="mb-1.5 block text-base font-semibold">
                        Icon
                      </label>
                      <IconSelect id={`icon-${department.id}`} value={department.icon} icons={data.icons} />
                    </div>
                    <label className="flex min-h-12 items-center gap-3 text-lg md:col-span-2">
                      <input type="checkbox" name="is_sample" defaultChecked={department.is_sample} className="size-6" />
                      Sample name
                    </label>
                  </ActionForm>
                  <ActionForm
                    action={setDepartmentActive.bind(null, department.id, !department.is_active)}
                    className="flex flex-col gap-3 lg:max-w-72"
                    submit={department.is_active ? 'Deactivate' : 'Reactivate'}
                    submitClassName={buttonSmall}
                    confirm={
                      department.is_active
                        ? `Deactivate “${department.name}”? It will no longer appear on the home page or in Upload. Its documents are kept.`
                        : undefined
                    }
                  >
                    <p className="text-base text-muted">
                      {department.is_active
                        ? 'Hide this department from the home page and from Upload.'
                        : 'Show this department again and allow uploads.'}
                    </p>
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </AdminShell>
  );
}

function DeleteDepartment({ department, others }: { department: AdminDepartment; others: AdminDepartment[] }) {
  const { documents, documents_in_recycle_bin: inBin } = department.usage;
  const total = documents + inBin;
  return (
    <DialogForm
      action={deleteDepartment.bind(null, department.id)}
      formId={`delete-department-${department.id}`}
      trigger="Delete or merge…"
      triggerClassName={buttonSmall}
      title={`Delete “${department.name}”`}
      confirmLabel="Delete department"
      danger
      summary={
        total === 0 ? (
          <p>This department has no documents. It will be removed from lists and from Upload.</p>
        ) : (
          <p>
            It holds <strong>{documents}</strong> document{documents === 1 ? '' : 's'}
            {inBin > 0 && (
              <>
                {' '}
                and <strong>{inBin}</strong> in the recycle bin
              </>
            )}
            . Choose what happens to them. No file is deleted.
          </p>
        )
      }
    >
      {total > 0 && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-base font-semibold">Documents</legend>
          <label className="flex items-start gap-3 text-base">
            <input type="radio" name="mode" value="move" defaultChecked className="mt-1 size-5 shrink-0" />
            <span>Move them to another department, then delete (merge)</span>
          </label>
          <label htmlFor={`target-${department.id}`} className="sr-only">
            Department to move them to
          </label>
          <select id={`target-${department.id}`} name="target_id" defaultValue="" className={fieldClass}>
            <option value="" disabled>
              Choose a department
            </option>
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label className="flex items-start gap-3 text-base">
            <input type="radio" name="mode" value="trash" className="mt-1 size-5 shrink-0" />
            <span>
              Delete the department and move its documents to the recycle bin
              <span className="block text-sm text-muted">They can be restored later and given a department again.</span>
            </span>
          </label>
        </fieldset>
      )}
    </DialogForm>
  );
}
