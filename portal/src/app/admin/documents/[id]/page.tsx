import Link from 'next/link';
import { Icon } from '@/components/icons';
import { notFound } from 'next/navigation';
import { updateDetails } from '@/app/documents/[id]/actions';
import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { ConfidentialBadge, Notice, buttonPrimary, buttonSecondary, buttonSmall, fieldClass, formatDate, formatSize } from '@/components/ui';
import { type AdminDocument, type ConfidentialGroup, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import { withMayan } from '@/lib/auth';
import { getOptions, type UserRef } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { ActivityList } from '../../activity-list';
import { documentBinAction, reclassifyDocument, setResponsiblePerson } from '../../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../../admin-shell';
import { DoneNotice } from '../../done-notice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document – Administration' };

export default async function AdminDocumentPage({ params, searchParams }: PageProps<'/admin/documents/[id]'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'documents')) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [document, options, users, groups] = await Promise.all([
    adminGetOrNull<AdminDocument>(session, `/documents/${id}/`),
    withMayan(() => getOptions(session.token)),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
    adminGet<{ results: ConfidentialGroup[] }>(session, '/confidential-groups/'),
  ]);
  if (!document) notFound();
  const binned = document.in_trash;

  return (
    <AdminShell
      access={access}
      section="documents"
      title={document.label}
      crumbs={[{ href: '/admin/documents', label: 'Documents' }, { label: document.label }]}
    >
      <DoneNotice params={await searchParams} />
      {binned && (
        <Notice tone="wait" role="status">
          This document is in the recycle bin{document.trashed_at ? ` since ${formatDate(document.trashed_at)}` : ''}. Employees cannot
          see it. Restore it, or delete it permanently.
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {document.access === 'confidential' && <ConfidentialBadge />}
        {!binned && (
          <Link href={`/documents/${document.id}`} className="text-base font-semibold text-brand underline underline-offset-4">
            Open the document page (preview)
          </Link>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[max-content_1fr]">
        {(
          [
            ['Document number', String(document.id)],
            ['Department', document.department_ref ? document.department : document.department ? `${document.department} (department deleted)` : 'No department'],
            ['Category', document.category],
            ['Access', document.confidential_group ? `Confidential – ${document.confidential_group.name}` : 'General (all employees)'],
            ['Originally uploaded by', document.uploaded_by ? `${document.uploaded_by.full_name} (${document.uploaded_by.username})` : 'Not recorded'],
            ['Responsible person', document.responsible ? `${document.responsible.full_name}${document.responsible.assigned ? '' : ' (the uploader)'}` : 'Not recorded'],
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

      <section aria-labelledby="files" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="files" className="text-lg font-bold">
          Files and versions ({document.files.length})
        </h2>
        <ul className="mt-2 divide-y divide-line">
          {document.files.map((file) => (
            <li key={file.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span dir="auto" className="block font-semibold wrap-anywhere">
                  {file.filename}
                  {file.is_latest && <span className="ml-2 text-sm font-normal text-muted">(current)</span>}
                </span>
                <span className="text-sm text-muted">
                  {formatDate(file.timestamp)}
                  {file.size ? ` · ${formatSize(file.size)}` : ''}
                </span>
              </span>
              {!binned && (
                <a href={`/api/documents/${document.id}/files/${file.id}/download`} download className={buttonSmall}>
                  <Icon name="download" className="size-5" />
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!binned && (
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="correct" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
          <h2 id="correct" className="text-lg font-bold">
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
              <label htmlFor="label" className="mb-1.5 block text-base font-semibold">
                Title
              </label>
              <input id="label" name="label" defaultValue={document.label} required maxLength={255} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="department" className="mb-1.5 block text-base font-semibold">
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
              <label htmlFor="category" className="mb-1.5 block text-base font-semibold">
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

        <section aria-labelledby="responsible" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
          <h2 id="responsible" className="text-lg font-bold">
            Responsible person
          </h2>
          <p className="mt-1 text-base text-muted">
            Who is responsible for this document now, for example after someone leaves. The original uploader
            {document.uploaded_by ? ` (${document.uploaded_by.full_name})` : ''} stays recorded and never changes.
          </p>
          <ActionForm
            action={setResponsiblePerson.bind(null, document.id)}
            className="mt-4 flex flex-col gap-4"
            submit="Transfer responsibility"
            submitClassName={buttonPrimary}
            labels={{ user_id: 'Person' }}
          >
            <div>
              <label htmlFor="responsible-select" className="mb-1.5 block text-base font-semibold">
                Responsible person
              </label>
              <select id="responsible-select" name="user_id" defaultValue={document.responsible ? String(document.responsible.id) : ''} required className={fieldClass}>
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

      )}

      {!binned && document.can_reclassify && (
        <section aria-labelledby="reclassify" className="rounded-lg border border-wait/40 bg-surface p-4 sm:p-6">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
            <Icon name="lock" className="size-4" />
            Access change
          </p>
          <h2 id="reclassify" className="text-lg font-bold">
            Change who can open it
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-base">
            <li>From the moment you save, only the chosen audience can find, open or download it.</li>
            <li>System Administrators can always open it. Others outside the audience lose access at once.</li>
            <li>
              <strong>Copies already downloaded, printed or emailed cannot be recalled.</strong> This only controls access in the
              document system from now on.
            </li>
            <li>Choosing “All employees” makes a confidential document general: every employee can then open it.</li>
          </ul>
          <ActionForm
            action={reclassifyDocument.bind(null, document.id)}
            className="mt-4 flex flex-col gap-4"
            submit="Change access"
            pendingText="Saving…"
            submitClassName={buttonPrimary}
            labels={{ confidential_group: 'Who can open it', understood: 'Confirmation' }}
            confirm="Change who can open this document now? Copies already downloaded cannot be recalled."
          >
            <div>
              <label htmlFor="reclassify-group" className="mb-1.5 block text-base font-semibold">
                Who can open it
              </label>
              <select id="reclassify-group" name="confidential_group" defaultValue="" required className={fieldClass}>
                <option value="" disabled>
                  Choose
                </option>
                {document.confidential_group && <option value="general">All employees (general)</option>}
                {groups.results
                  .filter((group) => group.id !== document.confidential_group?.id && group.is_active !== false)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </select>
            </div>
            <label className="flex min-h-12 items-start gap-3 text-lg">
              <input type="checkbox" name="understood" required className="mt-1 size-6 shrink-0" />
              I understand that copies already downloaded cannot be recalled.
            </label>
          </ActionForm>
        </section>
      )}

      {(access.can('documents.recycle') || (binned && access.can('documents.purge'))) && (
        <section aria-labelledby="bin" className="rounded-lg border border-brand/40 bg-surface p-4 sm:p-6">
          <h2 id="bin" className="text-lg font-bold">
            Recycle bin
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {!binned && access.can('documents.recycle') && (
              <DialogForm
                action={documentBinAction.bind(null, document.id, 'trash')}
                formId="trash-document"
                trigger="Move to recycle bin…"
                title="Move this document to the recycle bin?"
                confirmLabel="Move to recycle bin"
                summary={<p>Employees will no longer see it. It can be restored from the recycle bin.</p>}
              />
            )}
            {binned && access.can('documents.recycle') && (
              <DialogForm
                action={documentBinAction.bind(null, document.id, 'restore')}
                formId="restore-document"
                trigger="Restore…"
                title="Restore this document?"
                confirmLabel="Restore"
                summary={
                  <p>
                    It becomes visible again to everyone who could open it before.
                    {!document.department_ref && ' Its department was deleted: choose a new department for it afterwards.'}
                  </p>
                }
              />
            )}
            {binned && access.can('documents.purge') && (
              <DialogForm
                action={documentBinAction.bind(null, document.id, 'purge')}
                formId="purge-document"
                trigger="Delete permanently…"
                triggerClassName={buttonSecondary}
                title="Delete this document permanently?"
                confirmLabel="Delete permanently"
                danger
                irreversible
                summary={
                  <p>
                    The document, all {document.files.length} stored file{document.files.length === 1 ? '' : 's'}, its versions and
                    previews are deleted. The activity log keeps a record that it existed.
                  </p>
                }
              />
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-lg font-bold">
          Change history
        </h2>
        <ActivityList entries={document.history} />
      </section>
    </AdminShell>
  );
}
