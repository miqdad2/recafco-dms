import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Notice, buttonPrimary, buttonSmall, fieldClass } from '@/components/ui';
import { type ConfidentialGroup, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import type { UserRef } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import { addConfidentialMember, removeConfidentialMember, renameConfidentialGroup } from '../../actions';
import { AdminShell, NotAuthorized } from '../../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confidential group – Administration' };

export default async function ConfidentialGroupPage({ params, searchParams }: PageProps<'/admin/confidential-groups/[id]'>) {
  const { session, allowed } = await requireAdmin();
  if (!allowed) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [group, choices] = await Promise.all([
    adminGetOrNull<ConfidentialGroup>(session, `/confidential-groups/${id}/`),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
  ]);
  if (!group) notFound();
  const memberIds = new Set((group.members ?? []).map((member) => member.id));
  const candidates = choices.results.filter((user) => !memberIds.has(user.id) && user.is_active);
  const created = (await searchParams).created === '1';

  return (
    <AdminShell
      session={session}
      section="confidential"
      title={group.name}
      crumbs={[{ href: '/admin/confidential-groups', label: 'Confidential groups' }, { label: group.name }]}
    >
      {created && (
        <Notice tone="ok" role="status">
          The group was created. Add the people who may open its documents.
        </Notice>
      )}

      <section aria-labelledby="members" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 id="members" className="text-xl font-bold">
          Members ({group.members?.length ?? 0})
        </h2>
        <p className="mt-1 text-base text-muted">Only these people can find, open, download or count this group’s documents.</p>
        {group.members && group.members.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y divide-line">
            {group.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-lg">
                  <strong>{member.full_name}</strong> <span className="text-muted">({member.username})</span>
                  {!member.is_active && <span className="text-muted"> · deactivated</span>}
                </span>
                <ActionForm
                  action={removeConfidentialMember.bind(null, group.id, member.id)}
                  className="flex flex-col items-end gap-2"
                  submit="Remove"
                  pendingText="Removing…"
                  submitClassName={buttonSmall}
                  confirm={`Remove ${member.full_name}? They will no longer be able to open this group’s documents.`}
                >
                  {null}
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-lg">Nobody is a member yet.</p>
        )}

        <ActionForm
          action={addConfidentialMember.bind(null, group.id)}
          className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end"
          submit="Add member"
          submitClassName={buttonPrimary}
          labels={{ user_id: 'Person' }}
        >
          <div className="sm:flex-1">
            <label htmlFor="member" className="mb-2 block text-lg font-semibold">
              Add a person
            </label>
            <select id="member" name="user_id" defaultValue="" required className={fieldClass}>
              <option value="" disabled>
                Choose a person
              </option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name} ({user.username})
                </option>
              ))}
            </select>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="rename" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 id="rename" className="text-xl font-bold">
          Rename
        </h2>
        <p className="mt-1 text-base text-muted">
          Changes the name shown here. The protected area in the document system keeps its original name: {group.document_type}.
        </p>
        <ActionForm
          action={renameConfidentialGroup.bind(null, group.id)}
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
          submit="Rename"
          submitClassName={buttonSmall}
          labels={{ name: 'Name' }}
        >
          <div className="sm:flex-1">
            <label htmlFor="rename-group" className="mb-2 block text-lg font-semibold">
              Name
            </label>
            <input id="rename-group" name="name" defaultValue={group.name} required maxLength={60} className={fieldClass} />
          </div>
        </ActionForm>
      </section>
    </AdminShell>
  );
}
