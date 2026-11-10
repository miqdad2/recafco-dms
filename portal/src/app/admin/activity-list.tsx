import Link from 'next/link';
import { formatDate } from '@/components/ui';
import { ACTION_TEXT, type AuditEntry } from '@/lib/admin';

function targetHref(entry: AuditEntry): string | null {
  switch (entry.target_type) {
    case 'user':
      return `/admin/users/${entry.target_id}`;
    case 'document':
      return `/admin/documents/${entry.target_id}`;
    case 'confidential_group':
      return `/admin/confidential-groups/${entry.target_id}`;
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
    } else if (field === 'user') {
      parts.push(String(value));
    }
  }
  return parts.join(' · ');
}

export function ActivityList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-2xl bg-white p-5 text-lg text-muted">No changes have been recorded yet.</p>;
  }
  return (
    <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white">
      {entries.map((entry) => {
        const href = targetHref(entry);
        const changes = describeChanges(entry.details);
        return (
          <li key={entry.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <p className="text-base break-words">
              <strong>{entry.actor.full_name}</strong> {ACTION_TEXT[entry.action] ?? entry.action}{' '}
              {href ? (
                <Link href={href} className="font-semibold text-brand underline-offset-4 hover:underline">
                  {entry.target_label}
                </Link>
              ) : (
                <strong>{entry.target_label}</strong>
              )}
              {changes && <span className="block text-muted">{changes}</span>}
            </p>
            <time dateTime={entry.datetime} className="shrink-0 text-base text-muted">
              {formatDate(entry.datetime)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
