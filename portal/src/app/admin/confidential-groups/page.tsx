import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Notice, buttonPrimary, fieldClass } from '@/components/ui';
import { type ConfidentialGroup, adminGet, requireAdmin } from '@/lib/admin';
import { createConfidentialGroup } from '../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confidential groups – Administration' };

export default async function ConfidentialGroupsPage({ searchParams }: PageProps<'/admin/confidential-groups'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'confidential')) return <NotAuthorized session={session} />;
  const { results: groups } = await adminGet<{ results: ConfidentialGroup[] }>(session, '/confidential-groups/');

  return (
    <AdminShell access={access} section="confidential" title="Confidential groups" crumbs={[{ label: 'Confidential groups' }]}>
      {(await searchParams).deleted === '1' && (
        <Notice tone="ok" role="status">
          The confidential group was deleted.
        </Notice>
      )}
      <Notice>
        General documents are open to every employee. A confidential group has its own protected document area: only its
        members (and System Administrators) can find, open or count its documents. A deactivated group takes no new
        documents; its members keep access.
      </Notice>

      <ul className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <li key={group.id}>
            <Link href={`/admin/confidential-groups/${group.id}`} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-surface p-4 hover:border-line-strong hover:bg-hover">
              <span className="text-lg font-bold wrap-anywhere">{group.name}</span>
              <span className="text-base text-muted">
                {group.is_active ? 'Active' : 'Deactivated'} · {group.member_count} {group.member_count === 1 ? 'member' : 'members'} ·{' '}
                {group.usage.documents} documents
                {group.usage.documents_in_recycle_bin > 0 && ` · ${group.usage.documents_in_recycle_bin} in the recycle bin`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="new-group" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="new-group" className="text-lg font-bold">
          Create a confidential group
        </h2>
        <p className="mt-1 text-base text-muted">
          This creates a separate protected area in the document system. Groups can be renamed, deactivated or deleted later.
        </p>
        <ActionForm
          action={createConfidentialGroup}
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
          submit="Create group"
          pendingText="Creating…"
          submitClassName={buttonPrimary}
          labels={{ name: 'Name' }}
        >
          <div className="sm:flex-1">
            <label htmlFor="group-name" className="mb-1.5 block text-base font-semibold">
              Name
            </label>
            <input id="group-name" name="name" required maxLength={60} placeholder="For example: HR files" className={fieldClass} />
          </div>
        </ActionForm>
      </section>
    </AdminShell>
  );
}
