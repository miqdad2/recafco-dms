import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';

// Same reason as src/lib/mayan.ts: Gunicorn closes keep-alive connections
// (idle 2 s, worker recycling every ~500 requests), and a request sent on a
// closing connection fails with "other side closed". Tests send many writes,
// so every request uses a new connection.
setGlobalDispatcher(new Agent({ pipelining: 0 }));

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const devEnvPath = path.join(repoRoot, 'deploy', 'dev', '.env');
const composeFile = path.join(repoRoot, 'deploy', 'dev', 'compose.yaml');

function loadDevEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(devEnvPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const env = loadDevEnv();

export const MAYAN = `http://127.0.0.1:${env.RECAFCO_DEV_MAYAN_PORT ?? '8091'}/api/v4`;
export const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3107';
export const RUN = `t${Date.now().toString(36)}`;

export const users = {
  a: { username: 'dev_employee_a', password: env.RECAFCO_DEV_PASSWORD_EMPLOYEE_A },
  b: { username: 'dev_employee_b', password: env.RECAFCO_DEV_PASSWORD_EMPLOYEE_B },
  c: { username: 'dev_controller', password: env.RECAFCO_DEV_PASSWORD_CONTROLLER },
  d: { username: 'dev_admin', password: env.RECAFCO_DEV_PASSWORD_ADMIN },
} as const;
export type UserKey = keyof typeof users;

export const DEPARTMENTS = {
  finance: 'Finance (dev sample)',
  procurement: 'Procurement (dev sample)',
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `recafco_dev <args>` inside the dev Mayan container; returns its JSON. */
export function dev<T = Record<string, unknown>>(...args: string[]): T {
  const output = execFileSync(
    'docker',
    [
      'compose', '--project-name', 'recafco-dms-dev', '--file', composeFile,
      'exec', '-T', '--user', 'mayan', 'app',
      '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_dev', ...args,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const lines = output.trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]) as T;
}

/** Runs recafco_setup with the dev sample choices; returns its JSON report. */
export function setupReport(): {
  roles: Record<string, { global_permissions: string[]; document_type_acls: Record<string, string[]> }>;
} {
  const output = execFileSync(
    'docker',
    [
      'compose', '--project-name', 'recafco-dms-dev', '--file', composeFile,
      'exec', '-T', '--user', 'mayan', 'app',
      '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_setup',
      '--departments', 'Finance (dev sample),Procurement (dev sample),Projects (dev sample),Production (dev sample)',
      '--categories', 'Purchase order,Bill,Invoice,Other',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return JSON.parse(output);
}

export type ApiResult<T = any> = { status: number; body: T; headers: Headers };

/**
 * Calls the Mayan API directly, as the given token (or anonymously).
 * Retries on 429 so Mayan's rate limits do not produce false results.
 */
export async function api<T = any>(
  token: string | null,
  pathname: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Token ${token}`);
    let response: Response;
    try {
      response = await fetch(`${MAYAN}${pathname}`, { ...init, headers, redirect: 'manual' });
    } catch (error) {
      // Same rule as the portal: retry a dropped keep-alive connection only
      // for read-only requests.
      const method = (init.method ?? 'GET').toUpperCase();
      if ((method === 'GET' || method === 'HEAD') && attempt < 2) continue;
      throw error;
    }
    if (response.status === 429 && attempt < 8) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const text = await response.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* binary or HTML */
    }
    return { status: response.status, body, headers: response.headers };
  }
}

/**
 * Binary GET (images, downloads). Retries 429 and 5xx a few times: Mayan's
 * page-image view can fail with an internal LockError (HTTP 500) while a
 * background task still holds the image-cache lock just after processing
 * finishes. The portal's preview component retries the same way. Denials
 * (401/403/404) are never retried.
 */
export async function binary(token: string | null, pathname: string) {
  for (let attempt = 0; ; attempt += 1) {
    const headers = new Headers({ Accept: '*/*' });
    if (token) headers.set('Authorization', `Token ${token}`);
    let response: Response;
    try {
      response = await fetch(`${MAYAN}${pathname}`, { headers, redirect: 'manual' });
    } catch (error) {
      if (attempt < 2) continue; // dropped keep-alive connection (read-only GET)
      throw error;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await response.arrayBuffer();
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return { status: response.status, type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()) };
  }
}

export async function tokenFor(user: UserKey): Promise<string> {
  const result = await obtainToken(user);
  if (result.status !== 200 || !result.body?.token) {
    throw new Error(`Could not get a token for ${users[user].username}: ${result.status}`);
  }
  return result.body.token;
}

export function obtainToken(user: UserKey) {
  return api(null, '/auth/token/obtain/', {
    method: 'POST',
    body: new URLSearchParams(users[user]),
  });
}

/** Minimal valid one-page PDF with searchable text. */
export function makePdf(text: string, padBytes = 0): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  // Optional padding inside a PDF comment, to make large but valid files.
  if (padBytes > 0) output += `%${'x'.repeat(padBytes)}\n`;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

export type UploadFields = {
  file?: Buffer | null;
  filename?: string;
  department?: string;
  category?: string;
  label?: string;
  extra?: Record<string, string>;
  secondFile?: Buffer;
  /** Upload operation ID. Default: a new random one. null: send none. */
  operationId?: string | null;
  confidentialGroup?: number;
};

export const newOperationId = () => randomBytes(16).toString('hex');

export function uploadForm(fields: UploadFields): FormData {
  const form = new FormData();
  if (fields.operationId !== null) form.append('operation_id', fields.operationId ?? newOperationId());
  if (fields.confidentialGroup !== undefined) form.append('confidential_group', String(fields.confidentialGroup));
  if (fields.label !== undefined) form.append('label', fields.label);
  if (fields.department !== undefined) form.append('department', fields.department);
  if (fields.category !== undefined) form.append('category', fields.category);
  for (const [key, value] of Object.entries(fields.extra ?? {})) form.append(key, value);
  if (fields.file) {
    form.append('file', new Blob([new Uint8Array(fields.file)], { type: 'application/pdf' }), fields.filename ?? 'document.pdf');
  }
  if (fields.secondFile) {
    form.append('file', new Blob([new Uint8Array(fields.secondFile)], { type: 'application/pdf' }), 'second.pdf');
  }
  return form;
}

/**
 * Upload through the extension directly (as the employee token).
 *
 * A reused keep-alive connection can be closed by the server side just as a
 * request is sent ("other side closed"; see docs/unit-3-report.md). Because
 * every upload carries an operation ID, resending the SAME operation once is
 * safe: the server returns the first result instead of saving a copy. This
 * is not a blind retry; without an operation ID nothing is retried.
 */
export async function extensionUpload(token: string, fields: UploadFields) {
  const operationId = fields.operationId === null ? null : (fields.operationId ?? newOperationId());
  const send = () => api(token, '/recafco/uploads/', { method: 'POST', body: uploadForm({ ...fields, operationId }) });
  try {
    return await send();
  } catch (error) {
    if (!operationId) throw error;
    const reason = (error as { cause?: { message?: string } }).cause?.message ?? String(error);
    console.warn(`upload connection dropped (${reason}); resending operation ${operationId}`);
    return send();
  }
}

export async function waitFor<T>(
  description: string,
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 120_000,
  intervalMs = 2000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${description}`);
    await sleep(intervalMs);
  }
}

export async function waitReady(token: string, documentId: number) {
  return waitFor(`document ${documentId} ready`, async () => {
    const result = await api(token, `/recafco/documents/${documentId}/`);
    return result.status === 200 && result.body.state === 'ready' ? result.body : null;
  }, 180_000);
}

export async function searchCount(token: string | null, model: string, query: string) {
  const result = await api(token, `/search/${model}/?q=${encodeURIComponent(query)}`);
  return result;
}

// ---------------------------------------------------------------- portal

export type PortalSession = { cookie: string; setCookie: string };

function hiddenFields(html: string, formMarker?: string): [string, string][] {
  // With a marker, start at the <form> tag that contains it.
  const source = formMarker ? html.slice(html.lastIndexOf('<form', html.indexOf(formMarker))) : html;
  const form = source.slice(source.indexOf('<form'), source.indexOf('</form>'));
  const fields: [string, string][] = [];
  for (const match of form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) {
    const value = (match[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
    fields.push([match[1], value]);
  }
  return fields;
}

/** Submits a server-action form the way a browser without JavaScript does. */
async function submitActionForm(page: string, cookie: string | null, extra: Record<string, string>, formMarker?: string, readCookie = cookie) {
  const html = await (await fetch(`${PORTAL}${page}`, { headers: readCookie ? { Cookie: readCookie } : {} })).text();
  const form = new FormData();
  for (const [name, value] of hiddenFields(html, formMarker)) form.append(name, value);
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return fetch(`${PORTAL}${page}`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    headers: { Origin: PORTAL, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

export function portalLogin(user: UserKey, password?: string): Promise<{ response: Response; session: PortalSession | null }> {
  return portalLoginAs(users[user].username, password ?? users[user].password);
}

/** Signs in to the portal with any username and password. */
export async function portalLoginAs(username: string, password: string): Promise<{ response: Response; session: PortalSession | null }> {
  const response = await submitActionForm('/login', null, { username, password });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = /recafco_portal_session=([^;]+)/.exec(setCookie);
  return {
    response,
    session: match ? { cookie: `recafco_portal_session=${match[1]}`, setCookie } : null,
  };
}

export function portalLogout(session: PortalSession) {
  // The "Sign out" form in the header's account menu.
  return submitActionForm('/', session.cookie, {}, 'id="signout-form"');
}

export function portalGet(path: string, session: PortalSession | null) {
  return fetch(`${PORTAL}${path}`, {
    headers: session ? { Cookie: session.cookie } : {},
    redirect: 'manual',
  });
}

export function portalUpload(session: PortalSession | null, fields: UploadFields, origin: string | null = PORTAL) {
  const operationId = fields.operationId === null ? null : (fields.operationId ?? newOperationId());
  fields = { ...fields, operationId };
  const headers: Record<string, string> = {};
  if (operationId) headers['X-Upload-Operation'] = operationId;
  if (session) headers.Cookie = session.cookie;
  if (origin) headers.Origin = origin;
  return fetch(`${PORTAL}/api/upload`, { method: 'POST', body: uploadForm(fields), headers, redirect: 'manual' });
}

/** Statuses that prove access was refused (never 2xx). */
export const DENIED = [401, 403, 404];

/**
 * For list endpoints. Mayan answers child lists of a document the caller
 * cannot see (e.g. /documents/{id}/files/) with 200 and an empty,
 * permission-filtered list rather than 404. Both are acceptable; any
 * returned item is a leak.
 */
export function isDeniedOrEmpty(result: ApiResult): boolean {
  if (DENIED.includes(result.status)) return true;
  return result.status === 200 && result.body?.count === 0 && result.body?.results?.length === 0;
}

/** Endpoints returning a paginated list (vs a single object). */
export const isListPath = (path: string) =>
  /\/(files|versions|pages|metadata|cabinets|tags|comments|duplicates|events)\/$/.test(path);

/** HTTP Basic request to the Mayan API (direct access without a token). */
export async function basicApi(username: string, password: string, pathname: string) {
  const response = await fetch(`${MAYAN}${pathname}`, {
    headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    redirect: 'manual',
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export const MAYAN_WEB = MAYAN.replace(/\/api\/v4$/, '');

function cookieValue(setCookie: string, name: string): string | null {
  const match = new RegExp(`(?:^|[ ,])${name}=([^;]+)`).exec(setCookie);
  return match ? match[1] : null;
}

/**
 * Signs in to Mayan's own web interface (not the portal), the way a browser
 * does. Returns the session and CSRF cookies, or null if refused.
 */
export async function mayanWebLogin(username: string, password: string): Promise<{ cookie: string; csrf: string } | null> {
  const page = await fetch(`${MAYAN_WEB}/authentication/login/`, { redirect: 'manual' });
  const html = await page.text();
  const csrfCookie = cookieValue(page.headers.get('set-cookie') ?? '', 'csrftoken');
  const formToken = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(html)?.[1];
  if (!csrfCookie || !formToken) throw new Error('Mayan login page has no CSRF token.');
  const response = await fetch(`${MAYAN_WEB}/authentication/login/`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `csrftoken=${csrfCookie}`,
      Referer: `${MAYAN_WEB}/authentication/login/`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrfmiddlewaretoken: formToken, username, password, next: '' }),
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const session = cookieValue(setCookie, 'sessionid');
  if (response.status !== 302 || !session) return null;
  const csrf = cookieValue(setCookie, 'csrftoken') ?? csrfCookie;
  return { cookie: `sessionid=${session}; csrftoken=${csrf}`, csrf };
}

export function mayanWebGet(path: string, login: { cookie: string }) {
  return fetch(`${MAYAN_WEB}${path}`, { headers: { Cookie: login.cookie }, redirect: 'manual' });
}

/** JSON request to the Mayan API (admin and other JSON endpoints). */
export function json<T = any>(token: string | null, pathname: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET', body?: unknown) {
  return api<T>(token, pathname, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
}

/** Calls a portal server action form (admin forms, favorites) like a browser without JavaScript. */
export async function portalAction(
  session: PortalSession,
  page: string,
  formMarker: string,
  fields: Record<string, string>,
  /** Read the form (and its action ID) as this session; post as `session`. */
  formFrom: PortalSession = session,
) {
  return submitActionForm(page, session.cookie, fields, formMarker, formFrom.cookie);
}
