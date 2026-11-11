import 'server-only';
import { config } from './config';
import { deleteSessionsForToken } from './session-store';

/**
 * Server-side Mayan client. Every call is made with the signed-in
 * employee's own token, so Mayan enforces that employee's permissions.
 * There is no service account.
 */

export class SessionEndedError extends Error {
  constructor() {
    super('The Mayan session is no longer valid.');
  }
}

/**
 * Mayan refused the request because the account signed in with a temporary
 * password and must choose its own first. The token itself still works for
 * changing the password and signing out.
 */
export class PasswordChangeRequiredError extends Error {
  constructor() {
    super('The account must replace its temporary password first.');
  }
}

export class MayanError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Mayan responded ${status}.`);
  }
}

export type DocumentState = 'processing' | 'ready' | 'delayed' | 'no_preview';

export type Ref = { id: number; name: string };
export type UserRef = { id: number; username: string; full_name: string };

export type DocumentSummary = {
  id: number;
  label: string;
  access: 'general' | 'confidential';
  department: string | null;
  department_ref: Ref | null;
  category: string | null;
  category_ref: Ref | null;
  datetime_created: string;
  is_mine: boolean;
  state: DocumentState;
  // Original uploader (never changes); null when not recorded.
  uploaded_by: UserRef | null;
  // Current responsible person: an assigned person, else the original uploader.
  responsible: (UserRef & { assigned: boolean }) | null;
  confidential_group: Ref | null;
  file: { id: number; filename: string; size: number | null; mimetype: string | null } | null;
  version: { id: number; page_count: number; page_ids: number[] } | null;
};

export type DocumentDetail = DocumentSummary & {
  is_favorite: boolean;
  can_edit_details: boolean;
  editable_department_ids: number[];
  can_reclassify: boolean;
};

export type Me = {
  username: string;
  full_name: string;
  can_upload: boolean;
  is_admin: boolean;
  department_ids: number[];
  controller_department_ids: number[];
};

export type Department = {
  id: number;
  name: string;
  icon: string;
  is_active: boolean;
  is_sample: boolean;
  sort_order: number;
  document_count?: number;
};
export type Category = { id: number; name: string; is_active: boolean };

function url(path: string): string {
  return `${config.mayanApiUrl}${path}`;
}

/** Raw request with the employee token. Callers handle the response. */
export async function mayanRaw(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Token ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const request = () => fetch(url(path), { ...init, headers, cache: 'no-store', redirect: 'manual' });
  const method = (init.method ?? 'GET').toUpperCase();
  try {
    return await request();
  } catch (error) {
    // Mayan's Gunicorn recycles workers (every ~500 requests), which can
    // close a reused keep-alive connection. Retry read-only requests once;
    // never retry uploads or other writes.
    if (method !== 'GET' && method !== 'HEAD') throw error;
    return request();
  }
}

async function isPasswordChangeRequired(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body?.code === 'password_change_required';
  } catch {
    return false;
  }
}

/**
 * Mayan answers both "bad token / disabled user" and "no permission" with
 * 401 or 403. On those statuses, ask the auth-only endpoint whether the
 * token itself still works. If it does not, end every portal session that
 * uses it. A pending password change is reported separately: the token is
 * valid but may only be used to change the password or sign out.
 */
async function checkTokenAfterDenied(token: string, response: Response): Promise<void> {
  if (await isPasswordChangeRequired(response)) throw new PasswordChangeRequiredError();
  const probe = await mayanRaw(token, '/recafco/me/');
  if (await isPasswordChangeRequired(probe)) throw new PasswordChangeRequiredError();
  if (probe.status === 401 || probe.status === 403) {
    deleteSessionsForToken(token);
    throw new SessionEndedError();
  }
}

export async function mayanJson<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await mayanRaw(token, path, init);
  if (response.ok) {
    return (response.status === 204 ? null : await response.json()) as T;
  }
  if (response.status === 401 || response.status === 403) {
    await checkTokenAfterDenied(token, response);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  throw new MayanError(response.status, body);
}

/** Use for streamed responses (images, downloads). */
export async function mayanStream(token: string, path: string): Promise<Response> {
  const response = await mayanRaw(token, path, { headers: { Accept: '*/*' } });
  if (response.status === 401 || response.status === 403) {
    await checkTokenAfterDenied(token, response);
  }
  return response;
}

export type SignInResult =
  | {
      ok: true;
      token: string;
      username: string;
      fullName: string;
      mustChange: boolean;
      canUpload: boolean;
      isAdmin: boolean;
    }
  | { ok: false; reason: 'invalid' | 'locked' | 'throttled' | 'unavailable'; message?: string };

/**
 * Signs in through the RECAFCO extension, which checks the password with
 * Django's authenticate() (Mayan's own user table and lockout), compares
 * usernames without regard to case, and says whether the account must
 * replace a temporary password.
 */
export async function signIn(username: string, password: string): Promise<SignInResult> {
  let response: Response;
  try {
    response = await fetch(url('/recafco/auth/login/'), {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.ok && typeof data.token === 'string') {
    return {
      ok: true,
      token: data.token,
      username: String(data.username ?? username),
      fullName: String(data.full_name ?? data.username ?? username),
      mustChange: data.must_change_password === true,
      canUpload: data.can_upload === true,
      isAdmin: data.is_admin === true,
    };
  }
  const message = typeof data.detail === 'string' ? data.detail : undefined;
  if (response.status === 429) {
    return { ok: false, reason: data.code === 'locked' ? 'locked' : 'throttled', message };
  }
  if (response.status === 400) return { ok: false, reason: 'invalid' };
  return { ok: false, reason: 'unavailable' };
}

/** Changes the signed-in person's own password. Returns Mayan's new token. */
export async function changeOwnPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<SendResult<{ token?: string } & Record<string, unknown>>> {
  const response = await mayanRaw(token, '/recafco/auth/password/', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    await checkTokenAfterDenied(token, response);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, body: data };
}

export async function revokeToken(token: string): Promise<boolean> {
  const response = await mayanRaw(token, '/recafco/auth/token/revoke/', {
    method: 'POST',
  });
  return response.status === 204;
}

export const getMe = (token: string) => mayanJson<Me>(token, '/recafco/me/');

/** Active departments and categories, for the upload form. */
export const getOptions = (token: string) =>
  mayanJson<{ departments: Department[]; categories: Category[]; confidential_groups: Ref[] }>(token, '/recafco/options/');

async function orNull<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof MayanError && error.status === 404) return null;
    throw error;
  }
}

export const getDocument = (token: string, id: number) =>
  orNull(mayanJson<DocumentDetail>(token, `/recafco/documents/${id}/`));

/** Department cards. Counts include only documents this employee can view. */
export const getDepartments = (token: string) =>
  mayanJson<{ departments: Department[]; inactive_departments: Department[] }>(
    token,
    '/recafco/departments/',
  );

export const getDepartment = (token: string, id: number) =>
  orNull(
    mayanJson<Department & { can_upload: boolean; categories: Category[] }>(
      token,
      `/recafco/departments/${id}/`,
    ),
  );

export type Page<T> = { count: number; page: number; page_size: number; results: T[] };

export const DEPARTMENT_PAGE_SIZE = 20;

/** Newest first. `q` runs Mayan's search limited to this department. */
export function getDepartmentDocuments(
  token: string,
  id: number,
  filters: { page: number; category?: number; q?: string },
) {
  const params = new URLSearchParams({ page: String(filters.page), page_size: String(DEPARTMENT_PAGE_SIZE) });
  if (filters.category) params.set('category', String(filters.category));
  if (filters.q) params.set('q', filters.q);
  return mayanJson<Page<DocumentSummary>>(token, `/recafco/departments/${id}/documents/?${params}`);
}

export async function getFavorites(token: string): Promise<DocumentSummary[]> {
  return (await mayanJson<{ results: DocumentSummary[] }>(token, '/recafco/favorites/')).results;
}

export const setFavorite = (token: string, id: number, value: boolean) =>
  mayanJson<{ is_favorite: boolean }>(token, `/recafco/documents/${id}/favorite/`, {
    method: value ? 'POST' : 'DELETE',
  });

export type SendResult<T = unknown> = { ok: boolean; status: number; body: T };

/**
 * JSON write (POST/PATCH) as the employee. Returns validation errors to the
 * caller instead of throwing, so forms can show them next to the fields.
 */
export async function mayanSend<T = unknown>(
  token: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<SendResult<T>> {
  const response = await mayanRaw(token, path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    await checkTokenAfterDenied(token, response);
  }
  let data: unknown = null;
  try {
    data = response.status === 204 ? null : await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, body: data as T };
}

/** Newest documents this employee may open, across all departments (small pages only). */
export const getRecentDocuments = (token: string, pageSize = 8) =>
  mayanJson<{ has_more: boolean; page: number; page_size: number; results: DocumentSummary[] }>(
    token,
    `/recafco/documents/recent/?page_size=${pageSize}`,
  );

export async function getMyUploads(token: string): Promise<DocumentSummary[]> {
  const data = await mayanJson<{ results: DocumentSummary[] }>(
    token,
    '/recafco/uploads/mine/?limit=50',
  );
  return data.results;
}

export type SearchResult = { count: number; results: DocumentSummary[] };

/**
 * Mayan's own document search, run as the employee. Mayan filters results by
 * that employee's view permission. The extension then adds department and
 * category to each result, checking access again.
 */
export async function searchDocuments(
  token: string,
  query: string,
  page: number,
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, page: String(page), page_size: '20' });
  const data = await mayanJson<{ count: number; results: { id: number }[] }>(
    token,
    `/search/documents.documentsearchresult/?${params}`,
  );
  if (data.results.length === 0) return { count: data.count, results: [] };
  const ids = new URLSearchParams();
  for (const result of data.results) ids.append('id', String(result.id));
  const summaries = await mayanJson<{ results: DocumentSummary[] }>(
    token,
    `/recafco/documents/?${ids}`,
  );
  return { count: data.count, results: summaries.results };
}

export type UploadOperation = {
  operation_id: string;
  state: 'pending' | 'completed' | 'failed' | 'not_found';
  filename?: string;
  document?: { id: number | null; accessible: boolean; label?: string; confidential_group?: Ref | null };
  errors?: Record<string, string>;
};

/** What happened to an upload operation (only the user's own). */
export async function getUploadOperation(token: string, operationId: string): Promise<UploadOperation> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(operationId)) return { operation_id: operationId, state: 'not_found' };
  const response = await mayanRaw(token, `/recafco/uploads/operations/${operationId}/`);
  if (response.status === 404) return { operation_id: operationId, state: 'not_found' };
  if (response.status === 401 || response.status === 403) {
    await checkTokenAfterDenied(token, response);
  }
  if (!response.ok) throw new MayanError(response.status, null);
  return (await response.json()) as UploadOperation;
}
