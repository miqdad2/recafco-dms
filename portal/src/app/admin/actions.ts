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

type Method = 'POST' | 'PATCH';

async function call(path: string, method: Method, body: unknown, ok: string): Promise<FormState & { body?: unknown }> {
  const session = await requireSession();
  const result = await withMayan(() => mayanSend(session.token, `/recafco/admin${path}`, method, body));
  if (result.status === 403) {
    return { errors: { form: 'Only RECAFCO administrators can do this.' }, at: Date.now() };
  }
  if (result.status === 404) return { errors: { form: 'This item no longer exists.' }, at: Date.now() };
  if (!result.ok) return { errors: errorsFrom(result.body), at: Date.now() };
  refresh();
  return { ok, at: Date.now(), body: result.body };
}

/** Like call(), but returns only the message to the browser. */
async function send(path: string, method: Method, body: unknown, ok: string): Promise<FormState> {
  const result = await call(path, method, body, ok);
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
      is_administrator: checked(data, 'is_administrator'),
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
  return send(
    `/users/${id}/`,
    'PATCH',
    {
      first_name: text(data, 'first_name'),
      last_name: text(data, 'last_name'),
      email: text(data, 'email'),
      is_employee: checked(data, 'is_employee'),
      is_administrator: checked(data, 'is_administrator'),
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

export async function setUserPassword(id: number, _state: FormState, data: FormData): Promise<FormState> {
  const password = String(data.get('password') ?? '');
  if (password !== String(data.get('password_again') ?? '')) {
    return { errors: { password: 'The two passwords are not the same.' }, at: Date.now() };
  }
  return send(`/users/${id}/password/`, 'POST', { password }, 'New password saved. The user must sign in again.');
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
  const groupId = Number(text(data, 'confidential_group'));
  if (!groupId) return { errors: { confidential_group: 'Choose a confidential group.' }, at: Date.now() };
  if (data.get('understood') !== 'on') {
    return { errors: { understood: 'Tick the box to confirm you understand.' }, at: Date.now() };
  }
  const result = await call(`/documents/${id}/reclassify/`, 'POST', { confidential_group: groupId }, 'The document is now confidential.');
  const body = result.body as { accessible?: boolean } | undefined;
  if (result.ok && body && body.accessible === false) redirect(`/admin/documents?reclassified=${id}`);
  return { ok: result.ok, errors: result.errors, at: result.at };
}
