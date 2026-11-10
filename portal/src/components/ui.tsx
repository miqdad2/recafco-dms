import Link from 'next/link';
import { Icon } from '@/components/icons';
import type { DocumentState, DocumentSummary } from '@/lib/mayan';

/** Shared building blocks. Every control is at least 48px tall. */

export const buttonPrimary =
  'inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60';

export const buttonSecondary =
  'inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-ink bg-white px-6 text-lg font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60';

export const buttonSmall =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-line bg-white px-4 text-base font-semibold text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-60';

export const fieldClass =
  'block min-h-14 w-full rounded-xl border-2 border-line bg-white px-4 text-lg text-ink focus:border-ink';

export const panelClass = 'rounded-2xl border border-line bg-white p-5 sm:p-6';

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{children}</h1>;
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-12 items-center self-start text-lg font-semibold text-brand underline-offset-4 hover:underline">
      <span aria-hidden="true" className="mr-2">←</span>
      {children}
    </Link>
  );
}

export function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-lg">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 && <Icon name="chevronRight" className="size-4 text-muted" />}
            {item.href ? (
              <Link href={item.href} className="inline-flex min-h-12 items-center font-semibold text-brand underline-offset-4 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-muted break-all">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Notice({
  tone = 'info',
  children,
  role,
}: {
  tone?: 'info' | 'ok' | 'error' | 'wait';
  children: React.ReactNode;
  role?: 'status' | 'alert';
}) {
  const styles = {
    info: 'border-line bg-white text-ink',
    ok: 'border-ok bg-ok-soft text-ok',
    error: 'border-brand bg-brand-soft text-brand-strong',
    wait: 'border-wait bg-wait-soft text-wait',
  }[tone];
  return (
    <div role={role} className={`rounded-xl border-2 px-4 py-3 text-lg font-semibold ${styles}`}>
      {children}
    </div>
  );
}

export function SampleBadge() {
  return (
    <span className="inline-flex rounded-full border border-wait bg-wait-soft px-2.5 py-0.5 text-sm font-semibold text-wait">
      Sample name
    </span>
  );
}

const stateText: Record<DocumentState, { label: string; short: string; className: string }> = {
  ready: { label: 'Ready', short: 'Ready', className: 'bg-ok-soft text-ok' },
  processing: { label: 'Preparing preview', short: 'Preparing', className: 'bg-wait-soft text-wait' },
  delayed: { label: 'Preview is taking longer than usual', short: 'Taking longer', className: 'bg-wait-soft text-wait' },
  no_preview: { label: 'No preview – download to open', short: 'No preview', className: 'bg-canvas text-muted' },
};

export function StateBadge({ state, compact = false }: { state: DocumentState; compact?: boolean }) {
  const { label, short, className } = stateText[state];
  return (
    <span title={compact ? label : undefined} className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-base font-semibold ${className}`}>
      {compact ? short : label}
    </span>
  );
}

export function ConfidentialBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-base font-semibold text-white">
      <Icon name="lock" className="size-4" />
      Confidential
    </span>
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kuwait',
  }).format(new Date(iso));
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kuwait',
  }).format(new Date(iso));
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

const MIME_NAMES: [RegExp, string][] = [
  [/pdf/, 'PDF'],
  [/wordprocessingml|msword/, 'Word'],
  [/spreadsheetml|ms-excel|csv/, 'Excel'],
  [/presentationml|ms-powerpoint/, 'PowerPoint'],
  [/^image\//, 'Image'],
  [/^text\//, 'Text'],
];

/** Plain-language file type: "PDF", "Word", "Image", or the extension. */
export function fileType(file: DocumentSummary['file']): string {
  if (!file) return '—';
  const mime = file.mimetype ?? '';
  for (const [pattern, name] of MIME_NAMES) if (pattern.test(mime)) return name;
  const extension = /\.([a-z0-9]{1,6})$/i.exec(file.filename)?.[1];
  return extension ? extension.toUpperCase() : 'File';
}

function downloadHref(document: DocumentSummary): string | null {
  return document.file ? `/api/documents/${document.id}/files/${document.file.id}/download` : null;
}

/**
 * Document rows: a table on wide screens, stacked cards on phones. Every row
 * offers Open (preview page) and Download.
 */
export function DocumentTable({
  documents,
  showDepartment = false,
  caption,
}: {
  documents: DocumentSummary[];
  showDepartment?: boolean;
  caption: string;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-white lg:block">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-canvas text-base text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Title</th>
              <th scope="col" className={`${showDepartment ? 'w-56' : 'w-40'} px-4 py-3 font-semibold`}>{showDepartment ? 'Department · Category' : 'Category'}</th>
              <th scope="col" className="w-40 px-4 py-3 font-semibold">Uploaded by</th>
              <th scope="col" className="w-32 px-4 py-3 font-semibold">Date</th>
              <th scope="col" className="w-20 px-4 py-3 font-semibold">Type</th>
              <th scope="col" className="w-36 px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="w-[17.5rem] px-4 py-3 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {documents.map((document) => (
              <tr key={document.id} className="align-top hover:bg-canvas/60">
                <td className="px-4 py-3">
                  <Link href={`/documents/${document.id}`} className="text-lg font-semibold break-words text-ink underline-offset-4 hover:text-brand hover:underline">
                    {document.label}
                  </Link>
                  {document.access === 'confidential' && (
                    <span className="mt-1 block">
                      <ConfidentialBadge />
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-base break-words">
                  {showDepartment ? [document.department, document.category].filter(Boolean).join(' · ') : document.category ?? '—'}
                </td>
                <td className="px-4 py-3 text-base break-words">{document.uploaded_by?.full_name ?? '—'}</td>
                <td className="px-4 py-3 text-base">{formatDay(document.datetime_created)}</td>
                <td className="px-4 py-3 text-base">{fileType(document.file)}</td>
                <td className="px-4 py-3">
                  <StateBadge state={document.state} compact />
                </td>
                <td className="px-4 py-3">
                  <RowActions document={document} nowrap />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 lg:hidden" aria-label={caption}>
        {documents.map((document) => (
          <li key={document.id} className="rounded-2xl border border-line bg-white p-4">
            <Link href={`/documents/${document.id}`} className="block text-xl font-semibold break-words underline-offset-4 hover:underline">
              {document.label}
            </Link>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-base">
              {showDepartment && document.department && (
                <>
                  <dt className="text-muted">Department</dt>
                  <dd className="break-words">{document.department}</dd>
                </>
              )}
              <dt className="text-muted">Category</dt>
              <dd className="break-words">{document.category ?? '—'}</dd>
              <dt className="text-muted">Uploaded by</dt>
              <dd className="break-words">{document.uploaded_by?.full_name ?? '—'}</dd>
              <dt className="text-muted">Date</dt>
              <dd>{formatDay(document.datetime_created)}</dd>
              <dt className="text-muted">Type</dt>
              <dd>{fileType(document.file)}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {document.access === 'confidential' && <ConfidentialBadge />}
              <StateBadge state={document.state} />
            </div>
            <div className="mt-3">
              <RowActions document={document} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RowActions({ document, nowrap = false }: { document: DocumentSummary; nowrap?: boolean }) {
  const href = downloadHref(document);
  return (
    <div className={`flex gap-2 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      <Link href={`/documents/${document.id}`} className={buttonSmall} aria-label={`Open ${document.label}`}>
        <Icon name="eye" className="size-5" />
        Open
      </Link>
      {href && (
        <a href={href} download className={buttonSmall} aria-label={`Download ${document.label}`}>
          <Icon name="download" className="size-5" />
          Download
        </a>
      )}
    </div>
  );
}

export function Pagination({
  page,
  count,
  pageSize,
  hrefFor,
}: {
  page: number;
  count: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-lg text-muted">
        Page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonSecondary} rel="prev">
            ← Newer
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonSecondary} rel="next">
            Older →
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function EmptyState({
  title,
  children,
  icon = 'document',
}: {
  title: string;
  children?: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border-2 border-dashed border-line bg-white p-6 sm:flex-row sm:items-center sm:gap-5">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-canvas text-muted">
        <Icon name={icon} className="size-8" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-xl font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}
