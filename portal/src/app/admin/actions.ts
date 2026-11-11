'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession, withMayan } from '@/lib/auth';
import { errorsFrom, type FormState } from '@/lib/form-state';
import { mayanJson, mayanSend } from '@/lib/mayan';

/**
 * Administration actions. Each one calls a /recafco/admin/ endpoint with the
 * signed-in user's own token; the extension refuses non-administrators.
 * A success message is shown only after the extension confirmed the change.
 */

type Method = 'POST' | 'PATCH' | 'DELETE';

/**
 * `ok` must be a non-empty message: callers test `result.errors`, and the
 * browser shows `ok` as the confirmation.
 * `redirects`: on success the caller sends the browser to a result page
 * (FormState.next), which loads fresh data anyway, so no refresh() here.
 */
async function call(path: string, method: Method, body: unknown, ok: string, redirects = false): Promise<FormState & { body?: unknown }> {
  const session = await requireSession();
  const result = await withMayan(() => mayanSend(session.token, `/recafco/admin${path}`, method, body));
  if (result.status === 403) {
    return { errors: { form: 'You do not have permission to do this.' }, at: Date.now() };
  }
  if (result.status === 404) return { errors: { form: 'This item no longer exists.' }, at: Date.now() };
  if (!result.ok) return { errors: errorsFrom(result.body), at: Date.now() };
  if (!redirects) refresh();
  return { ok, at: Date.now(), body: result.body };
}

/** Like call(), but returns only the message to the browser. */
async function send(path: string, method: Method, body: unknown, ok: string, redirects = false): Promise<FormState> {
  const result = await call(path, method, body, ok, redirects);
  return { ok: result.ok, errors: result.errors, at: result.at };
}

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const checked = (data: FormData, name: string) => data.get(name) === 'on';
const ids = (data: FormData, name: string) =>
  data
    .getAll(name)
    .map(String)
    .filter((value) => /^[0-9]{1,12}$/.test(value))
    .map(Number);

// ------------------------------------------------------------ departments

export async function createDepartment(_state: FormState, data: FormData): Promise<FormState> {
  return send(
    '/departments/',
    'POST',
    { name: text(data, 'name'), icon: text(data, 'icon') || 'folder', is_sample: checked(data, 'is_sample') },
    `Department “${text(data, 'name')}” was added.`,
  );
}

export async function updateDepartment(id: number, _state: FormState, data: FormData): Promise<FormState> {
  return send(
    `/departments/${id}/`,
    'PATCH',
    { name: text(data, 'name'), icon: text(data, 'icon'), is_sample: checked(data, 'is_sample') },
    'Saved.',
  );
}

export async function setDepartmentActive(id: number, value: boolean): Promise<FormState> {
  return send(`/departments/${id}/`, 'PATCH', { is_active: value }, value ? 'Reactivated.' : 'Deactivated. Its documents are kept.');
}

export async function moveDepartment(id: number, direction: -1 | 1): Promise<void> {
  const session = await requireSession();
  const list = await withMayan(() =>
    mayanJson<{ results: { id: number }[] }>(session.token, '/recafco/admin/departments/'),
  );
  const order = list.results.map((department) => department.id);
  const index = order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  await withMayan(() => mayanSend(session.token, '/recafco/admin/departments/order/', 'POST', { ids: order }));
  refresh();
}

// ------------------------------------------------------------- categories

export async function createCategory(_state: FormState, data: FormData): Promise<FormState> {
  return send('/categories/', 'POST', { name: text(data, 'name') }, `Category “${text(data, 'name')}” was added.`);
}

export async function updateCategory(id: number, _state: FormState, data: FormData): Promise<FormState> {
  return send(`/categories/${id}/`, 'PATCH', { name: text(data, 'name') }, 'Saved.');
}

export async function setCategoryActive(id: number, value: boolean): Promise<FormState> {
  return send(`/categories/${id}/`, 'PATCH', { is_active: value }, value ? 'Reactivated.' : 'Deactivated. Documents keep this category.');
}

// ------------------------------------------------------------------ users

export async function createUser(_state: FormState, data: FormData): Promise<FormState> {
  const result = await call(
    '/users/',
    'POST',
    {
      username: text(data, 'username'),
      password: String(data.get('password') ?? ''),
      first_name: text(data, 'first_name'),
      last_name: text(data, 'last_name'),
      email: text(data, 'email'),
      is_employee: checked(data, 'is_employee'),
      ...(data.has('can_set_administrator') ? { is_administrator: checked(data, 'is_administrator') } : {}),
      department_ids: ids(data, 'department_ids'),
      controller_department_ids: ids(data, 'controller_department_ids'),
    },
    'Created.',
  );
  const created = result.body as { id?: number } | undefined;
  if (result.ok && created?.id) redirect(`/admin/users/${created.id}?created=1`);
  return { errors: result.errors, at: result.at };
}

export async function updateUser(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const username = text(data, 'username');
  return send(
    `/users/${id}/`,
    'PATCH',
    {
      ...(username ? { username } : {}),
      first_name: text(data, 'first_name'),
      last_name: text(data, 'last_name'),
      email: text(data, 'email'),
      is_employee: checked(data, 'is_employee'),
      ...(data.has('can_set_administrator') ? { is_administrator: checked(data, 'is_administrator') } : {}),
      department_ids: ids(data, 'department_ids'),
      controller_department_ids: ids(data, 'controller_department_ids'),
    },
    'Saved.',
  );
}

export async function setUserActive(id: number, value: boolean): Promise<FormState> {
  return send(
    `/users/${id}/`,
    'PATCH',
    { is_active: value },
    value ? 'The account is active again.' : 'The account is deactivated and signed out. Their documents are kept.',
  );
}

/**
 * Sets a temporary password. Mayan ends the person's sessions everywhere and
 * makes them choose their own password at the next sign-in. The temporary
 * password is not echoed back; the administrator tells the person directly.
 */
export async function resetUserPassword(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const password = String(data.get('password') ?? '');
  if (!password) return { errors: { password: 'Enter a temporary password.' }, at: Date.now() };
  return send(
    `/users/${id}/password/`,
    'POST',
    { password },
    'Password reset. The person was signed out everywhere and must choose a new password when they next sign in.',
  );
}

// --------------------------------------------------- confidential groups

export async function createConfidentialGroup(_state: FormState, data: FormData): Promise<FormState> {
  const result = await call('/confidential-groups/', 'POST', { name: text(data, 'name') }, 'Created.');
  const created = result.body as { id?: number } | undefined;
  if (result.ok && created?.id) redirect(`/admin/confidential-groups/${created.id}?created=1`);
  return { errors: result.errors, at: result.at };
}

export async function renameConfidentialGroup(id: number, _state: FormState, data: FormData): Promise<FormState> {
  return send(`/confidential-groups/${id}/`, 'PATCH', { name: text(data, 'name') }, 'Saved.');
}

export async function addConfidentialMember(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const userId = Number(text(data, 'user_id'));
  if (!userId) return { errors: { user_id: 'Choose a person.' }, at: Date.now() };
  return send(`/confidential-groups/${id}/members/`, 'POST', { user_id: userId, is_member: true }, 'Added. They can now open this group’s documents.');
}

export async function removeConfidentialMember(id: number, userId: number): Promise<FormState> {
  return send(`/confidential-groups/${id}/members/`, 'POST', { user_id: userId, is_member: false }, 'Removed.');
}

// -------------------------------------------------------------- documents

export async function setResponsiblePerson(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const userId = Number(text(data, 'user_id'));
  if (!userId) return { errors: { user_id: 'Choose a person.' }, at: Date.now() };
  return send(
    `/documents/${id}/responsible/`,
    'POST',
    { user_id: userId },
    'Responsibility was transferred. The original uploader stays recorded.',
  );
}

/**
 * Make a document confidential (or move it to another group). The extension
 * requires administrator authority AND current access to the document.
 * If the administrator is not in the target group, they lose access at once:
 * go back to the document list.
 */
export async function reclassifyDocument(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const value = text(data, 'confidential_group');
  const groupId = value === 'general' ? null : Number(value);
  if (value !== 'general' && !groupId) return { errors: { confidential_group: 'Choose who can open it.' }, at: Date.now() };
  if (data.get('understood') !== 'on') {
    return { errors: { understood: 'Tick the box to confirm you understand.' }, at: Date.now() };
  }
  const result = await call(
    `/documents/${id}/reclassify/`,
    'POST',
    { confidential_group: groupId, reason: text(data, 'reason') },
    groupId === null ? 'The document is now general: all employees can open it.' : 'The document is now confidential.',
  );
  const body = result.body as { accessible?: boolean } | undefined;
  if (result.ok && body && body.accessible === false) redirect(`/admin/documents?reclassified=${id}`);
  return { ok: result.ok, errors: result.errors, at: result.at };
}

// ----------------------------------------------------- Unit 5: deletion

const reason = (data: FormData) => text(data, 'reason');
const optionalId = (data: FormData, name: string) => {
  const value = Number(text(data, name));
  return Number.isInteger(value) && value > 0 ? value : null;
};

// Deleting removes the row that holds the dialog, so the result is shown by
// the page itself (see done-notice.tsx) after a redirect.
export async function deleteDepartment(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const mode = text(data, 'mode') || null;
  const result = await send(
    `/departments/${id}/`,
    'DELETE',
    { mode, target_id: mode === 'move' ? optionalId(data, 'target_id') : null, reason: reason(data) },
    'Department deleted.',
    true,
  );
  if (!result.ok) return result;
  return { ok: 'Done.', at: Date.now(), next: `/admin/departments?done=${mode === 'move' ? 'department-merged' : mode === 'trash' ? 'department-trashed' : 'department-deleted'}` };
}

export async function deleteCategory(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const result = await send(
    `/categories/${id}/`,
    'DELETE',
    { target_id: optionalId(data, 'target_id'), reason: reason(data) },
    'Category deleted.',
    true,
  );
  if (!result.ok) return result;
  return { ok: 'Done.', at: Date.now(), next: '/admin/categories?done=category-deleted' };
}

export async function deleteUser(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const result = await call(
    `/users/${id}/`,
    'DELETE',
    { transfer_to: optionalId(data, 'transfer_to'), reason: reason(data) },
    'Account deleted.',
  );
  if (result.ok) redirect('/admin/users?deleted=1');
  return { errors: result.errors, at: result.at };
}

export async function setUserRoles(id: number, _state: FormState, data: FormData): Promise<FormState> {
  return send(
    `/users/${id}/roles/`,
    'POST',
    { role_ids: ids(data, 'role_ids'), system_administrator: checked(data, 'system_administrator') },
    'Roles saved. They apply from the next page the person opens.',
  );
}

// ------------------------------------------------------------------ roles

const permissionsFrom = (data: FormData) => data.getAll('permissions').map(String);

export async function createRole(_state: FormState, data: FormData): Promise<FormState> {
  const result = await call(
    '/roles/',
    'POST',
    { name: text(data, 'name'), description: text(data, 'description'), permissions: permissionsFrom(data) },
    'Created.',
  );
  const created = result.body as { id?: number } | undefined;
  if (result.ok && created?.id) redirect(`/admin/roles/${created.id}?created=1`);
  return { errors: result.errors, at: result.at };
}

export async function updateRole(id: number, _state: FormState, data: FormData): Promise<FormState> {
  return send(
    `/roles/${id}/`,
    'PATCH',
    { name: text(data, 'name'), description: text(data, 'description'), permissions: permissionsFrom(data) },
    'Saved. Members get the new permissions on their next page.',
  );
}

export async function deleteRole(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const result = await call(`/roles/${id}/`, 'DELETE', { reason: reason(data) }, 'Role deleted.');
  if (result.ok) redirect('/admin/roles?deleted=1');
  return { errors: result.errors, at: result.at };
}

// --------------------------------------------- confidential group control

export async function setConfidentialGroupActive(id: number, value: boolean, _state: FormState, data: FormData): Promise<FormState> {
  return send(
    `/confidential-groups/${id}/`,
    'PATCH',
    { is_active: value, reason: reason(data) },
    value ? 'The group is active again.' : 'The group is deactivated. Members keep access; no new documents can be added to it.',
  );
}

export async function deleteConfidentialGroup(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const mode = text(data, 'mode') || null;
  const result = await call(
    `/confidential-groups/${id}/`,
    'DELETE',
    { mode, target_id: mode === 'move' ? optionalId(data, 'target_id') : null, reason: reason(data) },
    'Group deleted.',
  );
  if (result.ok) redirect('/admin/confidential-groups?deleted=1');
  return { errors: result.errors, at: result.at };
}

// ------------------------------------------------- documents (bulk, bin)

type BulkResult = { succeeded: number; failed: number; results: { id: number; ok: boolean; error?: string }[] };

const BULK_DONE: Record<string, string> = {
  move: 'moved',
  responsible: 'given a new responsible person',
  access: 'given new access',
  trash: 'moved to the recycle bin',
  restore: 'restored',
  purge: 'permanently deleted',
};

/** Apply one action to the selected documents; reports each failure. */
export async function bulkDocuments(_state: FormState, data: FormData): Promise<FormState> {
  const action = text(data, 'action');
  const selected = ids(data, 'ids');
  if (!selected.length) return { errors: { ids: 'Select at least one document.' }, at: Date.now() };
  const access = text(data, 'confidential_group');
  const result = await call(
    '/documents/bulk/',
    'POST',
    {
      action,
      ids: selected,
      department_id: optionalId(data, 'department_id'),
      category_id: optionalId(data, 'category_id'),
      user_id: optionalId(data, 'user_id'),
      confidential_group: action === 'access' ? (access === 'general' ? 'general' : optionalId(data, 'confidential_group')) : null,
      reason: reason(data),
    },
    'Done.',
    true,
  );
  if (result.errors) return { errors: result.errors, at: result.at };
  const body = result.body as BulkResult;
  // Rows leave the list, so the page shows the result after a redirect
  // back to the same list (see done-notice.tsx).
  const back = new URLSearchParams(returnQuery(data));
  back.set('done', `bulk-${BULK_DONE[action] ? action : 'move'}`);
  back.set('n', String(body.succeeded));
  back.set('of', String(selected.length));
  const failed = body.results.filter((item) => !item.ok).map((item) => item.id);
  if (failed.length) back.set('failed', failed.join(','));
  return { ok: 'Done.', at: Date.now(), next: `/admin/documents?${back}` };
}

/** The list filters to return to after a bulk action (known keys only). */
function returnQuery(data: FormData): string {
  const from = new URLSearchParams(text(data, 'return_query'));
  const kept = new URLSearchParams();
  for (const key of ['q', 'department', 'category', 'access', 'status']) {
    const value = from.get(key);
    if (value) kept.set(key, value.slice(0, 200));
  }
  return kept.toString();
}

/** Single-document recycle bin actions from the document page. */
export async function documentBinAction(id: number, action: 'trash' | 'restore' | 'purge', _state: FormState, data: FormData): Promise<FormState> {
  const result = await call('/documents/bulk/', 'POST', { action, ids: [id], reason: reason(data) }, 'Done.', true);
  if (result.errors) return { errors: result.errors, at: result.at };
  const body = result.body as BulkResult;
  const item = body.results[0];
  if (!item?.ok) return { errors: { form: item?.error ?? 'This did not work.' }, at: Date.now() };
  if (action === 'purge') redirect('/admin/documents?status=trash&purged=1');
  // The page swaps the recycle-bin controls, so the page shows the result.
  return { ok: 'Done.', at: Date.now(), next: `/admin/documents/${id}?done=${action === 'trash' ? 'document-trashed' : 'document-restored'}` };
}
