import Link from 'next/link';
import { Icon } from '@/components/icons';
import { formatDate } from '@/components/ui';
import { ACTION_TEXT, type AuditEntry } from '@/lib/admin';

const GONE = /\.(deleted|merged|purged)$/;

/** Where the target lives now; none if it was deleted by this or a later entry. */
function targetHref(entry: AuditEntry): string | null {
  if (GONE.test(entry.action)) return null;
  switch (entry.target_type) {
    case 'user':
      return `/admin/users/${entry.target_id}`;
    case 'document':
      return `/admin/documents/${entry.target_id}`;
    case 'confidential_group':
      return `/admin/confidential-groups/${entry.target_id}`;
    case 'role':
      return `/admin/roles/${entry.target_id}`;
    case 'department':
      return '/admin/departments';
    case 'category':
      return '/admin/categories';
    default:
      return null;
  }
}

function describeChanges(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(details)) {
    if (Array.isArray(value) && value.length === 2) {
      const [from, to] = value.map((item) => (Array.isArray(item) ? item.join(', ') || 'none' : String(item ?? 'none')));
      parts.push(`${field.replaceAll('_', ' ')}: ${from} → ${to}`);
    } else if (['user', 'target', 'mode', 'transferred_to'].includes(field) && value) {
      parts.push(`${field.replaceAll('_', ' ')}: ${String(value)}`);
    } else if (['documents', 'documents_in_recycle_bin', 'files_deleted', 'transferred_documents'].includes(field) && typeof value === 'number' && value > 0) {
      parts.push(`${field.replaceAll('_', ' ')}: ${value}`);
    } else if (field === 'error') {
      parts.push(`error: ${String(value)}`);
    }
  }
  return parts.join(' · ');
}

export function ActivityList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-lg border border-line bg-surface p-5 text-base text-muted">No matching activity.</p>;
  }
  return (
    <ol className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {entries.map((entry) => {
        const href = targetHref(entry);
        const changes = describeChanges(entry.details);
        const failed = entry.outcome === 'failed';
        return (
          <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <div className="min-w-0 text-base wrap-anywhere">
              {failed && (
                <span className="mr-2 inline-flex items-center gap-1 rounded bg-brand-soft px-1.5 text-sm font-semibold text-brand-strong">
                  <Icon name="alert" className="size-3.5" />
                  Failed
                </span>
              )}
              <strong>{entry.actor?.full_name ?? 'Unknown'}</strong> {ACTION_TEXT[entry.action] ?? entry.action}{' '}
              {href ? (
                <Link href={href} className="font-semibold text-brand underline-offset-4 hover:underline">
                  {entry.target_label}
                </Link>
              ) : (
                <strong>{entry.target_label}</strong>
              )}
              {changes && <span className="block text-sm text-muted">{changes}</span>}
              {entry.reason && <span className="block text-sm text-muted">Reason: {entry.reason}</span>}
            </div>
            <time dateTime={entry.datetime} className="shrink-0 text-sm text-muted">
              {formatDate(entry.datetime)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
