import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { DialogForm } from '@/components/dialog-form';
import { Icon } from '@/components/icons';
import { Notice, buttonPrimary, buttonSmall, fieldClass } from '@/components/ui';
import { type ConfidentialGroup, adminGet, adminGetOrNull, requireAdmin } from '@/lib/admin';
import type { UserRef } from '@/lib/mayan';
import { parseId } from '@/lib/route-helpers';
import {
  addConfidentialMember,
  deleteConfidentialGroup,
  removeConfidentialMember,
  renameConfidentialGroup,
  setConfidentialGroupActive,
} from '../../actions';
import { AdminShell, NotAuthorized, sectionAllowed } from '../../admin-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confidential group – Administration' };

export default async function ConfidentialGroupPage({ params, searchParams }: PageProps<'/admin/confidential-groups/[id]'>) {
  const access = await requireAdmin();
  const { session, allowed } = access;
  if (!allowed || !sectionAllowed(access, 'confidential')) return <NotAuthorized session={session} />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [group, choices, allGroups] = await Promise.all([
    adminGetOrNull<ConfidentialGroup>(session, `/confidential-groups/${id}/`),
    adminGet<{ results: (UserRef & { is_active: boolean })[] }>(session, '/users/choices/'),
    adminGet<{ results: ConfidentialGroup[] }>(session, '/confidential-groups/'),
  ]);
  if (!group) notFound();
  const memberIds = new Set((group.members ?? []).map((member) => member.id));
  const candidates = choices.results.filter((user) => !memberIds.has(user.id) && user.is_active);
  const created = (await searchParams).created === '1';

  return (
    <AdminShell
      access={access}
      section="confidential"
      title={group.name}
      crumbs={[{ href: '/admin/confidential-groups', label: 'Confidential groups' }, { label: group.name }]}
    >
      {created && (
        <Notice tone="ok" role="status">
          The group was created. Add the people who may open its documents.
        </Notice>
      )}

      <section aria-labelledby="members" className="rounded-lg border border-wait/40 bg-surface p-4 sm:p-6">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
          <Icon name="lock" className="size-4" />
          Access change
        </p>
        <h2 id="members" className="text-lg font-bold">
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
            <label htmlFor="member" className="mb-1.5 block text-base font-semibold">
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

      <section aria-labelledby="rename" className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 id="rename" className="text-lg font-bold">
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
            <label htmlFor="rename-group" className="mb-1.5 block text-base font-semibold">
              Name
            </label>
            <input id="rename-group" name="name" defaultValue={group.name} required maxLength={60} className={fieldClass} />
          </div>
        </ActionForm>
      </section>

      <GroupStatus group={group} others={allGroups.results.filter((item) => item.id !== group.id && item.is_active)} />
    </AdminShell>
  );
}

function GroupStatus({ group, others }: { group: ConfidentialGroup; others: ConfidentialGroup[] }) {
  const total = group.usage.documents + group.usage.documents_in_recycle_bin;
  return (
    <section aria-labelledby="group-status" className="rounded-lg border border-brand/40 bg-surface p-4 sm:p-6">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wait">
        <Icon name="lock" className="size-4" />
        Access change
      </p>
      <h2 id="group-status" className="text-lg font-bold">
        Deactivate or delete
      </h2>
      <p className="mt-1 text-base text-muted">
        This group is <strong>{group.is_active ? 'active' : 'deactivated'}</strong> and holds {group.usage.documents} documents
        {group.usage.documents_in_recycle_bin > 0 && ` and ${group.usage.documents_in_recycle_bin} in the recycle bin`}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <DialogForm
          action={setConfidentialGroupActive.bind(null, group.id, !group.is_active)}
          formId="group-active"
          trigger={group.is_active ? 'Deactivate…' : 'Reactivate…'}
          title={group.is_active ? `Deactivate “${group.name}”?` : `Reactivate “${group.name}”?`}
          confirmLabel={group.is_active ? 'Deactivate' : 'Reactivate'}
          summary={
            group.is_active ? (
              <p>No new documents can be uploaded to or moved into this group. Members keep access to its documents.</p>
            ) : (
              <p>Documents can be uploaded to and moved into this group again.</p>
            )
          }
        />
        {group.is_builtin ? (
          <p className="text-base text-muted">The built-in original group cannot be deleted. Rename or deactivate it instead.</p>
        ) : (
          <DialogForm
            action={deleteConfidentialGroup.bind(null, group.id)}
            formId="group-delete"
            trigger="Delete group…"
            title={`Delete “${group.name}”`}
            confirmLabel="Delete group"
            danger
            summary={
              total === 0 ? (
                <p>
                  The group has no documents. Its {group.member_count} {group.member_count === 1 ? 'member loses' : 'members lose'} this
                  membership; their accounts stay.
                </p>
              ) : (
                <p>
                  It holds <strong>{total}</strong> document{total === 1 ? '' : 's'}
                  {group.usage.documents_in_recycle_bin > 0 && ` (${group.usage.documents_in_recycle_bin} in the recycle bin)`}. Decide
                  what happens to them. They are never made general.
                </p>
              )
            }
          >
            {total > 0 && (
              <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <legend className="px-1 text-base font-semibold">Documents</legend>
                <label className="flex items-start gap-3 text-base">
                  <input type="radio" name="mode" value="move" defaultChecked className="mt-1 size-5 shrink-0" />
                  <span>Move them to another confidential group</span>
                </label>
                <label htmlFor="group-target" className="sr-only">
                  Confidential group to move them to
                </label>
                <select id="group-target" name="target_id" defaultValue="" className={fieldClass}>
                  <option value="" disabled>
                    Choose a confidential group
                  </option>
                  {others.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-start gap-3 text-base">
                  <input type="radio" name="mode" value="purge" className="mt-1 size-5 shrink-0" />
                  <span>
                    Delete them permanently, with their files
                    <span className="block text-sm font-semibold text-brand-strong">This cannot be undone.</span>
                  </span>
                </label>
              </fieldset>
            )}
          </DialogForm>
        )}
      </div>
    </section>
  );
}
