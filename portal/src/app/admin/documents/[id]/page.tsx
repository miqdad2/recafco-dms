import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateDetails } from '@/app/documents/[id]/actions';
import { ActionForm } from '@/components/action-form';
import { ConfidentialBadge, buttonPrimary, fieldClass, formatDate } from '@/components/ui';
import { type AdminDocument, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import { withMayan } from '@/lib/auth';
import { getOptions, type UserRef } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { ActivityList } from '../../activity-list';
import { setDocumentOwner } from '../../actions';
import { AdminShell, NotAuthorized } from '../../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document – Administration' };

export default async function AdminDocumentPage({ params }: PageProps<'/admin/documents/[id]'>) {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [document, options, users] = await Promise.all([
    adminGetOrNull<AdminDocument>(session, `/documents/${id}/`),
    withMayan(() => getOptions(session.token)),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
  ]);
  if (!document) notFound();

  return (
    <AdminShell
      session={session}
      section="documents"
      title={document.label}
      crumbs={[{ href: '/admin/documents', label: 'Documents' }, { label: document.label }]}
    >
      <div className="flex flex-wrap items-center gap-3">
        {document.access === 'confidential' && <ConfidentialBadge />}
        <Link href={`/documents/${document.id}`} className="text-lg font-semibold text-brand underline-offset-4 hover:underline">
          Open the document page
        </Link>
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-2xl border border-line bg-white p-5 sm:grid-cols-[max-content_1fr]">
        {(
          [
            ['Document number', String(document.id)],
            ['Department', document.department],
            ['Category', document.category],
            ['Uploaded by', document.uploaded_by ? `${document.uploaded_by.full_name} (${document.uploaded_by.username})` : 'Not recorded'],
            ['Upload date', formatDate(document.datetime_created)],
            ['File', document.file?.filename ?? null],
          ] as [string, string | null][]
        )
          .filter(([, value]) => value)
          .map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-base font-semibold text-muted">{term}</dt>
              <dd className="text-lg break-words">{value}</dd>
            </div>
          ))}
      </dl>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="correct" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h2 id="correct" className="text-xl font-bold">
            Correct the details
          </h2>
          <ActionForm
            action={updateDetails.bind(null, document.id)}
            className="mt-4 flex flex-col gap-4"
            submit="Save details"
            submitClassName={buttonPrimary}
            labels={{ label: 'Title', department_id: 'Department', category_id: 'Category' }}
          >
            <div>
              <label htmlFor="label" className="mb-2 block text-lg font-semibold">
                Title
              </label>
              <input id="label" name="label" defaultValue={document.label} required maxLength={255} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="department" className="mb-2 block text-lg font-semibold">
                Department
              </label>
              <select id="department" name="department_id" defaultValue={document.department_ref ? String(document.department_ref.id) : ''} className={fieldClass}>
                {document.department_ref && !options.departments.some((d) => d.id === document.department_ref!.id) && (
                  <option value="">{document.department_ref.name} (keep – deactivated)</option>
                )}
                {options.departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="category" className="mb-2 block text-lg font-semibold">
                Category
              </label>
              <select id="category" name="category_id" defaultValue={document.category_ref ? String(document.category_ref.id) : ''} className={fieldClass}>
                {document.category_ref && !options.categories.some((c) => c.id === document.category_ref!.id) && (
                  <option value="">{document.category_ref.name} (keep – deactivated)</option>
                )}
                {options.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </ActionForm>
        </section>

        <section aria-labelledby="owner" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h2 id="owner" className="text-xl font-bold">
            Uploader (owner)
          </h2>
          <p className="mt-1 text-base text-muted">
            Use this only to correct a mistake, for example a document uploaded on someone else’s behalf. The change is
            recorded.
          </p>
          <ActionForm
            action={setDocumentOwner.bind(null, document.id)}
            className="mt-4 flex flex-col gap-4"
            submit="Change uploader"
            submitClassName={buttonPrimary}
            labels={{ user_id: 'Person' }}
          >
            <div>
              <label htmlFor="owner-select" className="mb-2 block text-lg font-semibold">
                Uploaded by
              </label>
              <select id="owner-select" name="user_id" defaultValue={document.uploaded_by ? String(document.uploaded_by.id) : ''} required className={fieldClass}>
                <option value="" disabled>
                  Choose a person
                </option>
                {users.results.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.username}){user.is_active ? '' : ' – deactivated'}
                  </option>
                ))}
              </select>
            </div>
          </ActionForm>
        </section>
      </div>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-xl font-bold">
          Change history
        </h2>
        <ActivityList entries={document.history} />
      </section>
    </AdminShell>
  );
}
