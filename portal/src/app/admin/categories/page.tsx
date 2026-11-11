import { ActionForm } from '@/components/action-form';
import { Notice, buttonPrimary, buttonSmall, fieldClass } from '@/components/ui';
import { type AdminCategory, adminGet, requireAdmin } from '@/lib/admin';
import { createCategory, setCategoryActive, updateCategory } from '../actions';
import { AdminShell, NotAuthorized } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categories – Administration' };

export default async function AdminCategoriesPage() {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const { results: categories } = await adminGet<{ results: AdminCategory[] }>(session, '/categories/');

  return (
    <AdminShell session={session} section="categories" title="Categories" crumbs={[{ label: 'Categories' }]}>
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
            <p className="text-xl font-bold break-words">{category.name}</p>
            <p className="text-base text-muted">
              {category.is_active ? 'Active' : 'Deactivated'} · {category.total_documents} documents
            </p>
            <details className="mt-2">
              <summary className="min-h-12 cursor-pointer content-center text-lg font-semibold text-brand">Change {category.name}</summary>
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
