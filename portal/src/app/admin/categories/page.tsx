import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { Notice, buttonPrimary, buttonSmall, fieldClass } from '@/components/ui';
import { type AdminCategory, adminGet, requireAdmin } from '@/lib/admin';
import { createCategory, deleteCategory, setCategoryActive, updateCategory } from '../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../admin-shell';
import { DoneNotice } from '../done-notice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categories – Administration' };

export default async function AdminCategoriesPage({ searchParams }: PageProps<'/admin/categories'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'categories')) return <NotAuthorized session={session} />;
  const { results: categories } = await adminGet<{ results: AdminCategory[] }>(session, '/categories/');

  return (
    <AdminShell access={access} section="categories" title="Categories" crumbs={[{ label: 'Categories' }]}>
      <DoneNotice params={await searchParams} />
      <Notice>
        A category says what kind of document it is (for example a purchase order or an invoice). It does not decide who can
        open it: confidential access is set separately.
      </Notice>

      <section aria-labelledby="add-category" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="add-category" className="text-lg font-bold">
          Add a category
        </h2>
        <ActionForm
          action={createCategory}
          resetOnSuccess
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
          submit="Add category"
          submitClassName={buttonPrimary}
          labels={{ name: 'Name' }}
        >
          <div className="sm:flex-1">
            <label htmlFor="new-category" className="mb-1.5 block text-base font-semibold">
              Name
            </label>
            <input id="new-category" name="name" required maxLength={100} className={fieldClass} />
          </div>
        </ActionForm>
      </section>

      <ul className="flex flex-col gap-3">
        {categories.map((category) => (
          <li key={category.id} className={`rounded-lg border bg-surface p-4 sm:p-5 ${category.is_active ? 'border-line' : 'border-dashed border-line'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-bold wrap-anywhere">{category.name}</p>
                <p className="text-base text-muted">
                  {category.is_active ? 'Active' : 'Deactivated'} · {category.usage.documents} documents
                  {category.usage.documents_in_recycle_bin > 0 && ` · ${category.usage.documents_in_recycle_bin} in the recycle bin`}
                </p>
              </div>
              <DeleteCategory category={category} others={categories.filter((item) => item.id !== category.id && item.is_active)} />
            </div>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer content-center text-base font-semibold text-brand">Change {category.name}</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
                <ActionForm
                  action={updateCategory.bind(null, category.id)}
                  className="flex flex-col gap-4 sm:flex-row sm:items-end"
                  submit="Rename"
                  submitClassName={buttonPrimary}
                  labels={{ name: 'Name' }}
                >
                  <div className="sm:flex-1">
                    <label htmlFor={`category-${category.id}`} className="mb-1.5 block text-base font-semibold">
                      Name
                    </label>
                    <input id={`category-${category.id}`} name="name" defaultValue={category.name} required maxLength={100} className={fieldClass} />
                  </div>
                </ActionForm>
                <ActionForm
                  action={setCategoryActive.bind(null, category.id, !category.is_active)}
                  submit={category.is_active ? 'Deactivate' : 'Reactivate'}
                  submitClassName={buttonSmall}
                  confirm={category.is_active ? `Deactivate “${category.name}”? It can no longer be chosen for new uploads. Existing documents keep it.` : undefined}
                >
                  <p className="text-base text-muted">
                    {category.is_active ? 'Stop offering this category for new uploads.' : 'Offer this category again.'}
                  </p>
                </ActionForm>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </AdminShell>
  );
}

function DeleteCategory({ category, others }: { category: AdminCategory; others: AdminCategory[] }) {
  const total = category.usage.documents + category.usage.documents_in_recycle_bin;
  return (
    <DialogForm
      action={deleteCategory.bind(null, category.id)}
      formId={`delete-category-${category.id}`}
      trigger="Delete or merge…"
      triggerClassName={buttonSmall}
      title={`Delete “${category.name}”`}
      confirmLabel="Delete category"
      danger
      summary={
        total === 0 ? (
          <p>No documents use this category. It will be removed from lists and from Upload.</p>
        ) : (
          <p>
            <strong>{total}</strong> document{total === 1 ? '' : 's'} use this category
            {category.usage.documents_in_recycle_bin > 0 && ` (${category.usage.documents_in_recycle_bin} in the recycle bin)`}. They
            move to the category you choose; then this category is deleted.
          </p>
        )
      }
    >
      {total > 0 && (
        <div>
          <label htmlFor={`category-target-${category.id}`} className="mb-1.5 block text-base font-semibold">
            Move the documents to
          </label>
          <select id={`category-target-${category.id}`} name="target_id" required defaultValue="" className={fieldClass}>
            <option value="" disabled>
              Choose a category
            </option>
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </DialogForm>
  );
}
