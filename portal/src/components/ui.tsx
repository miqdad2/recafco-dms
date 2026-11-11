import Link from 'next/link';
import { Icon } from '@/components/icons';
import type { DocumentState, DocumentSummary } from '@/lib/mayan';

/*
 * Shared building blocks (design tokens live in app/globals.css).
 * Controls are 48px high (44px for compact row actions); one radius
 * (rounded-lg); red only for the primary action and errors.
 */

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60';

export const buttonPrimary = `${buttonBase} min-h-12 bg-brand px-5 text-base text-white hover:bg-brand-strong`;

export const buttonSecondary = `${buttonBase} min-h-12 border border-line-strong bg-surface px-5 text-base text-ink hover:bg-hover`;

/** Compact secondary button for row actions and toolbars (44px). */
export const buttonSmall = `${buttonBase} min-h-11 border border-line-strong bg-surface px-3 text-base text-ink hover:bg-hover`;

export const fieldClass =
  'block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-info';

export const labelClass = 'mb-1.5 block text-base font-semibold';
export const helpClass = 'mt-1.5 text-sm text-muted';
export const errorTextClass = 'mt-1.5 text-base font-semibold text-brand-strong';

export const panelClass = 'rounded-lg border border-line bg-surface p-4 sm:p-6';
export const linkClass = 'font-semibold text-brand underline underline-offset-4 hover:text-brand-strong';

/** Page title with an optional one-line description and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  titleDir,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  titleDir?: 'auto';
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 dir={titleDir} className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">
          {title}
        </h1>
        {description && <div className="mt-1 text-base text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">{children}</h1>;
}

export function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1 text-base">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <Icon name="chevronRight" className="size-4 shrink-0 text-muted" />}
            {item.href ? (
              <Link href={item.href} className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" dir="auto" className="text-muted wrap-anywhere">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const NOTICE_ICONS = { info: 'info', ok: 'check', error: 'alert', wait: 'clock' } as const;

/** Message box. Tone is shown by an icon and wording, not only by color. */
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
    info: 'border-info/30 bg-info-soft text-info',
    ok: 'border-ok/30 bg-ok-soft text-ok',
    error: 'border-brand/40 bg-brand-soft text-brand-strong',
    wait: 'border-wait/30 bg-wait-soft text-wait',
  }[tone];
  return (
    <div role={role} className={`flex gap-3 rounded-lg border px-4 py-3 text-base font-semibold ${styles}`}>
      <Icon name={NOTICE_ICONS[tone]} className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small neutral label for placeholder (sample) names. */
export function SampleBadge() {
  return (
    <span className="inline-flex items-center rounded border border-line px-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
      Sample
    </span>
  );
}

const stateText: Record<DocumentState, { label: string; short: string; icon: string; className: string }> = {
  ready: { label: 'Ready', short: 'Ready', icon: 'check', className: 'text-ok' },
  processing: { label: 'Preparing preview', short: 'Preparing', icon: 'clock', className: 'text-wait' },
  delayed: { label: 'Preview is taking longer than usual', short: 'Taking longer', icon: 'clock', className: 'text-wait' },
  no_preview: { label: 'No preview – download to open', short: 'No preview', icon: 'document', className: 'text-muted' },
};

/** Processing status as icon + words (never color alone). */
export function StateBadge({ state, compact = false }: { state: DocumentState; compact?: boolean }) {
  const { label, short, icon, className } = stateText[state];
  return (
    <span title={compact ? label : undefined} className={`inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${className}`}>
      <Icon name={icon} className="size-4 shrink-0" />
      {compact ? short : label}
      {compact && short !== label && <span className="sr-only">: {label}</span>}
    </span>
  );
}

export function ConfidentialBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-ink px-2 py-0.5 text-sm font-semibold whitespace-nowrap text-white">
      <Icon name="lock" className="size-3.5" />
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

/** "PDF · 240 KB" */
function fileLine(document: DocumentSummary): string {
  return [fileType(document.file), formatSize(document.file?.size)].filter((part) => part && part !== '—').join(' · ');
}

/**
 * Document list: a table on wide screens, readable cards on phones and
 * tablets. The title is the strongest element; every row offers Open and
 * Download.
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
      <div className="hidden overflow-hidden rounded-lg border border-line bg-surface xl:block">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-canvas text-sm text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Title</th>
              <th scope="col" className={`${showDepartment ? 'w-48' : 'w-36'} px-3 py-2.5 font-semibold`}>
                {showDepartment ? 'Department · Category' : 'Category'}
              </th>
              <th scope="col" className="w-40 px-3 py-2.5 font-semibold">Uploaded by · Date</th>
              <th scope="col" className="w-32 px-3 py-2.5 font-semibold">Status</th>
              <th scope="col" className="w-[17rem] px-3 py-2.5 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {documents.map((document) => (
              <tr key={document.id} className="align-top hover:bg-canvas">
                <td className="px-4 py-3">
                  <Link href={`/documents/${document.id}`} dir="auto" className="block text-base font-semibold text-ink wrap-anywhere underline-offset-4 hover:text-brand hover:underline">
                    {document.label}
                  </Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                    {fileLine(document)}
                    {document.access === 'confidential' && <ConfidentialBadge />}
                  </span>
                </td>
                <td className="px-3 py-3 text-sm wrap-anywhere">
                  {showDepartment ? [document.department, document.category].filter(Boolean).join(' · ') || '—' : document.category ?? '—'}
                </td>
                <td className="px-3 py-3 text-sm">
                  <span className="block wrap-anywhere">{document.uploaded_by?.full_name ?? 'Not recorded'}</span>
                  <span className="block text-muted">{formatDay(document.datetime_created)}</span>
                </td>
                <td className="px-3 py-3">
                  <StateBadge state={document.state} compact />
                </td>
                <td className="px-3 py-2">
                  <RowActions document={document} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 md:grid-cols-2 xl:hidden" aria-label={caption}>
        {documents.map((document) => (
          <li key={document.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
            <Link href={`/documents/${document.id}`} dir="auto" className="block text-lg font-semibold wrap-anywhere underline-offset-4 hover:underline">
              {document.label}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span>{fileLine(document)}</span>
              <StateBadge state={document.state} compact />
              {document.access === 'confidential' && <ConfidentialBadge />}
            </p>
            <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              {showDepartment && document.department && (
                <>
                  <dt className="text-muted">Department</dt>
                  <dd className="wrap-anywhere">{document.department}</dd>
                </>
              )}
              <dt className="text-muted">Category</dt>
              <dd className="wrap-anywhere">{document.category ?? '—'}</dd>
              <dt className="text-muted">Uploaded by</dt>
              <dd className="wrap-anywhere">{document.uploaded_by?.full_name ?? '—'}</dd>
              <dt className="text-muted">Date</dt>
              <dd>{formatDay(document.datetime_created)}</dd>
            </dl>
            <div className="mt-auto pt-3">
              <RowActions document={document} wrap />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RowActions({ document, wrap = false }: { document: DocumentSummary; wrap?: boolean }) {
  const href = downloadHref(document);
  return (
    <div className={`flex gap-2 ${wrap ? 'flex-wrap' : 'flex-nowrap'}`}>
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
      <p className="text-base text-muted">
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
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-5 sm:flex-row sm:gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted">
        <Icon name={icon} className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-lg font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

const ACCENTS = [
  'bg-accent-1-soft text-accent-1',
  'bg-accent-2-soft text-accent-2',
  'bg-accent-3-soft text-accent-3',
  'bg-accent-4-soft text-accent-4',
  'bg-accent-5-soft text-accent-5',
  'bg-accent-6-soft text-accent-6',
];

/** Stable, subtle accent for a department's icon tile. */
export function departmentAccent(id: number): string {
  return ACCENTS[Math.abs(id) % ACCENTS.length];
}

export function DepartmentIcon({ id, icon, size = 'md' }: { id: number; icon: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-10' : 'size-12';
  const glyph = size === 'sm' ? 'size-5' : 'size-6';
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-lg ${departmentAccent(id)}`}>
      <Icon name={icon} className={glyph} />
    </span>
  );
}
