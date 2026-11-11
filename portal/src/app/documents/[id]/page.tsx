import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ActionForm } from '@/components/action-form';
import { Icon } from '@/components/icons';
import {
  Breadcrumb,
  ConfidentialBadge,
  Notice,
  PageHeader,
  StateBadge,
  buttonPrimary,
  buttonSecondary,
  fieldClass,
  fileType,
  formatDate,
  formatSize,
  labelClass,
} from '@/components/ui';
import { requireSession, withMayan } from '@/lib/auth';
import { getDocument, getOptions } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { toggleFavorite, updateDetails } from './actions';
import { PageImage } from './page-image';
import { StatusWatcher } from './status-watcher';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document' };

export default async function DocumentPage({ params, searchParams }: PageProps<'/documents/[id]'>) {
  const session = await requireSession();
  const id = parseId((await params).id);
  if (id === null) notFound();
  // Same "not found" for missing and not-permitted documents.
  const document = await withMayan(() => getDocument(session.token, id));
  if (!document) notFound();
  const justUploaded = (await searchParams).uploaded === '1';
  const options = document.can_edit_details ? await withMayan(() => getOptions(session.token)) : null;
  const editableDepartments = options?.departments.filter((department) =>
    document.editable_department_ids.includes(department.id),
  );

  const details: [string, string | null][] = [
    ['Department', document.department],
    ['Category', document.category],
    ['Access', document.confidential_group ? `Confidential – only ${document.confidential_group.name}` : 'General – all employees'],
    ['Originally uploaded by', document.uploaded_by?.full_name ?? 'Not recorded'],
    ['Upload date', formatDate(document.datetime_created)],
    ['Responsible person', document.responsible?.assigned ? document.responsible.full_name : null],
  ];
  const fileDetails: [string, string | null][] = document.file
    ? [
        ['File name', document.file.filename],
        ['Type', fileType(document.file)],
        ['Size', formatSize(document.file.size) || null],
        ['Pages', document.version ? String(document.version.page_count) : null],
      ]
    : [];
  const downloadHref = document.file ? `/api/documents/${document.id}/files/${document.file.id}/download` : null;
  const department = document.department_ref;

  return (
    <AppShell session={session} section="departments">
      <Breadcrumb
        items={[
          { href: '/', label: 'Departments' },
          ...(department ? [{ href: `/departments/${department.id}`, label: department.name }] : []),
          { label: document.label },
        ]}
      />

      {justUploaded && (
        <Notice tone="ok" role="status">
          Upload complete. The document is saved.
        </Notice>
      )}

      <PageHeader
        title={document.label}
        titleDir="auto"
        description={
          <span className="flex flex-wrap items-center gap-3">
            {document.access === 'confidential' && <ConfidentialBadge />}
            <StateBadge state={document.state} />
          </span>
        }
        actions={
          <>
            {downloadHref && (
              <a href={downloadHref} className={buttonPrimary} download>
                <Icon name="download" className="size-5" />
                Download
              </a>
            )}
            <form action={toggleFavorite.bind(null, document.id, !document.is_favorite)}>
              <button type="submit" className={buttonSecondary} aria-pressed={document.is_favorite}>
                <Icon name="star" className={`size-5 ${document.is_favorite ? 'fill-current text-brand' : ''}`} />
                {document.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
              </button>
            </form>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section aria-labelledby="preview-heading" className="order-2 flex min-w-0 flex-col gap-3 lg:order-1">
          <h2 id="preview-heading" className="text-lg font-bold">
            Preview
          </h2>
          {(document.state === 'processing' || document.state === 'delayed') && (
            <StatusWatcher documentId={document.id} />
          )}
          {document.state === 'no_preview' && (
            <p className="rounded-lg border border-line bg-surface p-5 text-base">
              This file type cannot be previewed here. Use <strong>Download</strong> to open it.
            </p>
          )}
          {document.state === 'ready' && document.version && (
            <>
              {document.version.page_count > document.version.page_ids.length && (
                <p className="text-base text-muted">
                  Showing the first {document.version.page_ids.length} of {document.version.page_count} pages. Download to see all pages.
                </p>
              )}
              <ol className="flex flex-col gap-4">
                {document.version.page_ids.map((pageId, index) => (
                  <li key={pageId}>
                    <PageImage
                      src={`/api/documents/${document.id}/versions/${document.version!.id}/pages/${pageId}/image`}
                      alt={`Page ${index + 1} of ${document.version!.page_count}`}
                      eager={index === 0}
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <aside className="order-1 flex flex-col gap-4 lg:sticky lg:top-24 lg:order-2" aria-label="Document information">
          <section aria-labelledby="info-heading" className="rounded-lg border border-line bg-surface p-4">
            <h2 id="info-heading" className="text-base font-bold">
              Document information
            </h2>
            <InfoList items={details} />
          </section>

          {fileDetails.length > 0 && (
            <section aria-labelledby="file-heading" className="rounded-lg border border-line bg-surface p-4">
              <h2 id="file-heading" className="text-base font-bold">
                File
              </h2>
              <InfoList items={fileDetails} />
            </section>
          )}

          {document.can_edit_details && options && editableDepartments && (
            <details className="rounded-lg border border-line bg-surface p-4">
              <summary className="min-h-11 cursor-pointer content-center text-base font-semibold">Correct the details</summary>
              <p className="mt-2 text-sm text-muted">
                Changes are recorded with your name. The file itself is not changed.
              </p>
              <ActionForm
                action={updateDetails.bind(null, document.id)}
                className="mt-4 flex flex-col gap-4"
                submit="Save details"
                submitClassName={`${buttonPrimary} w-full`}
                labels={{ label: 'Title', department_id: 'Department', category_id: 'Category' }}
              >
                <div>
                  <label htmlFor="edit-label" className={labelClass}>
                    Title
                  </label>
                  <input id="edit-label" name="label" defaultValue={document.label} maxLength={255} required className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="edit-department" className={labelClass}>
                    Department
                  </label>
                  <select id="edit-department" name="department_id" defaultValue={department ? String(department.id) : ''} className={fieldClass}>
                    {department && !document.editable_department_ids.includes(department.id) && (
                      <option value="">{department.name} (keep)</option>
                    )}
                    {editableDepartments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-category" className={labelClass}>
                    Category
                  </label>
                  <select
                    id="edit-category"
                    name="category_id"
                    defaultValue={document.category_ref ? String(document.category_ref.id) : ''}
                    className={fieldClass}
                  >
                    {document.category_ref && !options.categories.some((item) => item.id === document.category_ref!.id) && (
                      <option value="">{document.category_ref.name} (keep)</option>
                    )}
                    {options.categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </ActionForm>
            </details>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function InfoList({ items }: { items: [string, string | null][] }) {
  return (
    <dl className="mt-3 flex flex-col gap-2.5">
      {items
        .filter(([, value]) => value)
        .map(([term, value]) => (
          <div key={term}>
            <dt className="text-sm text-muted">{term}</dt>
            <dd dir="auto" className="text-base wrap-anywhere">
              {value}
            </dd>
          </div>
        ))}
    </dl>
  );
}
