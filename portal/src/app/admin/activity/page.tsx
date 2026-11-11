import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Pagination, buttonSecondary, fieldClass } from '@/components/ui';
import { ACTION_TEXT, type AuditEntry, adminGet, requireAdmin } from '@/lib/admin';
import type { Page } from '@/lib/mayan';
import { ActivityList } from '../activity-list';
import { AdminShell, NotAuthorized, sectionAllowed } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity log' };

const FILTERS = ['q', 'action', 'target_type', 'outcome', 'actor', 'date_from', 'date_to'] as const;

export default async function ActivityPage({ searchParams }: PageProps<'/admin/activity'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'activity')) return <NotAuthorized session={session} />;
  const params = await searchParams;
  const filters = Object.fromEntries(FILTERS.map((name) => [name, String(params[name] ?? '').trim().slice(0, 200)])) as Record<
    (typeof FILTERS)[number],
    string
  >;
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const query = (extra: Record<string, string> = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...extra })) if (value) search.set(key, value);
    return search.toString();
  };
  const data = await adminGet<Page<AuditEntry> & { actions: string[]; target_types: string[] }>(
    session,
    `/audit/?${query({ page: String(page) })}`,
  );

  return (
    <AdminShell access={access} section="activity" title="Activity log" crumbs={[{ label: 'Activity log' }]}>
      <p className="max-w-3xl text-base text-muted">
        Every administrator action, newest first, with its outcome and reason. Entries cannot be edited or removed, and they
        stay after the person or item is deleted.
      </p>

      <form role="search" action="/admin/activity" className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="activity-q" label="Search" className="lg:col-span-2">
          <input id="activity-q" name="q" type="search" defaultValue={filters.q} placeholder="Name, item or reason" className={fieldClass} />
        </Field>
        <Field id="activity-actor" label="Done by (username)">
          <input id="activity-actor" name="actor" defaultValue={filters.actor} autoCapitalize="none" className={fieldClass} />
        </Field>
        <Field id="activity-outcome" label="Outcome">
          <select id="activity-outcome" name="outcome" defaultValue={filters.outcome} className={fieldClass}>
            <option value="">Any</option>
            <option value="success">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
        <Field id="activity-action" label="Action">
          <select id="activity-action" name="action" defaultValue={filters.action} className={fieldClass}>
            <option value="">Any action</option>
            {data.actions.map((action) => (
              <option key={action} value={action}>
                {ACTION_TEXT[action] ? `${ACTION_TEXT[action]} (${action})` : action}
              </option>
            ))}
          </select>
        </Field>
        <Field id="activity-target" label="Item type">
          <select id="activity-target" name="target_type" defaultValue={filters.target_type} className={fieldClass}>
            <option value="">Any</option>
            {data.target_types.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field id="activity-from" label="From">
          <input id="activity-from" name="date_from" type="date" defaultValue={filters.date_from} className={fieldClass} />
        </Field>
        <Field id="activity-to" label="To">
          <input id="activity-to" name="date_to" type="date" defaultValue={filters.date_to} className={fieldClass} />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className={buttonSecondary}>
            <Icon name="search" className="size-5" />
            Filter
          </button>
          <Link href="/admin/activity" className={buttonSecondary}>
            Clear
          </Link>
          <a href={`/api/admin/activity/export?${query()}`} className={buttonSecondary} download>
            <Icon name="download" className="size-5" />
            Export CSV
          </a>
        </div>
      </form>

      <p className="text-base text-muted" aria-live="polite">
        {data.count.toLocaleString('en-GB')} {data.count === 1 ? 'entry' : 'entries'}
      </p>
      <ActivityList entries={data.results} />
      <Pagination page={page} count={data.count} pageSize={data.page_size} hrefFor={(p) => `/admin/activity?${query({ page: String(p) })}`} />
    </AdminShell>
  );
}

function Field({ id, label, className = '', children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
