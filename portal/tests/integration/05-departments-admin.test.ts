/**
 * Unit 2: department navigation, scoped lists and search, upload
 * preselection and validation, Department controllers, RECAFCO
 * administration, and refusal of every admin endpoint to non-admins.
 *
 * Every department/category/user/group this file creates carries the run ID,
 * so it never renames or deactivates the shared "(dev sample)" records.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DENIED, PORTAL, RUN, type PortalSession, api, dev, json, makePdf,
  portalAction, portalGet, portalLogin, portalUpload, tokenFor, users, waitFor,
} from './helpers';

type Dept = { id: number; name: string; is_active: boolean; document_count?: number };
type Doc = { id: number; label: string; department: string; category: string; uploaded_by: { username: string } | null };

let tA: string; let tB: string; let tC: string; let tD: string;
let a: PortalSession; let b: PortalSession; let c: PortalSession; let d: PortalSession;
let deptA: Dept; let deptB: Dept; let deptOff: Dept;
let categoryId: number;
const CATEGORY = `Cat ${RUN}`;
const SHARED = `sharedword${RUN}`;
const ids: Record<string, number> = {};
let userIdB: number;

async function upload(session: PortalSession, label: string, department: string, category: string, text: string) {
  const response = await portalUpload(session, { file: makePdf(text), filename: `${label}.pdf`, label, department, category });
  expect(response.status, `upload ${label}`).toBe(201);
  return (await response.json()).id as number;
}

const deptDocs = async (token: string, id: number, query = '') =>
  (await api(token, `/recafco/departments/${id}/documents/${query}`)).body as { count: number; results: Doc[] };

const counts = async (token: string) => {
  const body = (await api(token, '/recafco/departments/')).body as { departments: Dept[]; inactive_departments: Dept[] };
  return new Map([...body.departments, ...body.inactive_departments].map((dept) => [dept.id, dept.document_count ?? 0]));
};

beforeAll(async () => {
  [tA, tB, tC, tD] = await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('c'), tokenFor('d')]);
  [a, b, c, d] = (await Promise.all(['a', 'b', 'c', 'd'].map((key) => portalLogin(key as 'a')))).map((r) => r.session!);

  const create = async (name: string) => {
    const result = await json(tD, '/recafco/admin/departments/', 'POST', { name, icon: 'finance' });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body as Dept;
  };
  deptA = await create(`Dept A ${RUN}`);
  deptB = await create(`Dept B ${RUN}`);
  deptOff = await create(`Dept Off ${RUN}`);
  const category = await json(tD, '/recafco/admin/categories/', 'POST', { name: CATEGORY });
  expect(category.status).toBe(201);
  categoryId = category.body.id;

  // Oldest first, so the newest-first order is known: A1, B1, A2.
  ids.a1 = await upload(a, `DA1-${RUN}`, deptA.name, 'Invoice', `alpha ${SHARED}`);
  ids.b1 = await upload(a, `DB1-${RUN}`, deptB.name, 'Invoice', `beta ${SHARED}`);
  ids.a2 = await upload(b, `DA2-${RUN}`, deptA.name, CATEGORY, `gamma only${RUN}`);
  ids.conf = dev<{ document_id: number }>('confidential-sample', '--label', `DCONF-${RUN}`, '--text', `conf ${SHARED}`, '--department', deptA.name).document_id;

  const userB = await json(tD, '/recafco/admin/users/?q=dev_employee_b');
  // Fail with the real answer (status and body), not a TypeError.
  expect(userB.status, JSON.stringify(userB.body).slice(0, 300)).toBe(200);
  userIdB = userB.body.results[0].id;
});

afterAll(async () => {
  // Leave shared dev users as they were; hide this run's departments.
  if (userIdB) await json(tD, `/recafco/admin/users/${userIdB}/`, 'PATCH', { controller_department_ids: [] });
  for (const dept of [deptA, deptB, deptOff]) {
    if (dept) await json(tD, `/recafco/admin/departments/${dept.id}/`, 'PATCH', { is_active: false });
  }
  if (categoryId) await json(tD, `/recafco/admin/categories/${categoryId}/`, 'PATCH', { is_active: false });
});

describe('department home', () => {
  it('sign-in lands on the department home', async () => {
    const { response, session } = await portalLogin('a');
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!, PORTAL).pathname).toBe('/');
    const html = await (await portalGet('/', session)).text();
    expect(html).toContain('id="departments-heading"');
    expect(html).toContain(`href="/departments/${deptA.id}"`);
    expect(html).toContain(deptA.name);
    expect(html).toContain('Search all documents');
    expect(html).toContain('Upload documents');
    expect(html).not.toContain('href="/admin"'); // not an administrator
  });

  it('shows the Administration link only to administrators', async () => {
    expect(await (await portalGet('/', d)).text()).toContain('href="/admin"');
  });

  it('a department card opens that department', async () => {
    const html = await (await portalGet(`/departments/${deptA.id}`, a)).text();
    expect(html).toMatch(new RegExp(`<h1[^>]*>${deptA.name}</h1>`));
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Search this department');
    expect(html).toContain(`/upload?department=${deptA.id}`);
    expect(html).not.toContain(deptB.name);
  });

  it('an unknown department is "not found"', async () => {
    expect((await portalGet('/departments/999999999', a)).status).toBe(404);
    expect((await api(tA, '/recafco/departments/999999999/documents/')).status).toBe(404);
  });
});

describe('department lists and search stay in their department', () => {
  it('lists recent documents newest first, only from this department', async () => {
    const list = await deptDocs(tA, deptA.id);
    expect(list.results.map((doc) => doc.id)).toEqual([ids.a2, ids.a1]);
    expect(list.count).toBe(2);
    const html = await (await portalGet(`/departments/${deptA.id}`, a)).text();
    expect(html).toContain(`/documents/${ids.a1}`);
    expect(html).toContain(`/documents/${ids.a2}`);
    expect(html).not.toContain(`/documents/${ids.b1}`);
    for (const column of ['Title', 'Category', 'Uploaded by', 'Date', 'Type', 'Status']) expect(html).toContain(column);
  });

  it('paginates', async () => {
    const first = await deptDocs(tA, deptA.id, '?page_size=1&page=1');
    const second = await deptDocs(tA, deptA.id, '?page_size=1&page=2');
    expect([first.count, first.results[0].id, second.results[0].id]).toEqual([2, ids.a2, ids.a1]);
  });

  it('filters by category', async () => {
    const list = await deptDocs(tA, deptA.id, `?category=${categoryId}`);
    expect(list.results.map((doc) => doc.id)).toEqual([ids.a2]);
  });

  it('department search finds only this department; company-wide search finds both', async () => {
    await waitFor('company search finds both', async () => {
      const html = await (await portalGet(`/search?q=${SHARED}`, a)).text();
      return html.includes(`/documents/${ids.a1}`) && html.includes(`/documents/${ids.b1}`);
    }, 180_000, 3000);
    const inA = await deptDocs(tA, deptA.id, `?q=${SHARED}`);
    expect(inA.results.map((doc) => doc.id)).toEqual([ids.a1]);
    const inB = await deptDocs(tA, deptB.id, `?q=${SHARED}`);
    expect(inB.results.map((doc) => doc.id)).toEqual([ids.b1]);
    const html = await (await portalGet(`/departments/${deptA.id}?q=${SHARED}`, a)).text();
    expect(html).toContain(`/documents/${ids.a1}`);
    expect(html).not.toContain(`/documents/${ids.b1}`);
  });
});

describe('general documents are visible across departments', () => {
  it('another employee sees them in lists, counts, search and preview pages', async () => {
    const list = await deptDocs(tB, deptA.id);
    expect(list.results.map((doc) => doc.id)).toContain(ids.a1);
    expect((await counts(tB)).get(deptA.id)).toBe((await counts(tA)).get(deptA.id));
    expect((await portalGet(`/documents/${ids.b1}`, b)).status).toBe(200);
  });
});

describe('confidential documents stay restricted', () => {
  it('are excluded from employee counts, lists and search, but not the controller’s or a System Administrator’s', async () => {
    // Unit 5 changed policy: System Administrators can open every confidential document.
    const forC = await counts(tC);
    expect((await counts(tD)).get(deptA.id)).toBe(3);
    expect((await api(tD, `/recafco/documents/${ids.conf}/`)).status).toBe(200);
    for (const token of [tA, tB]) {
      expect((await counts(token)).get(deptA.id)).toBe(2);
      const list = await deptDocs(token, deptA.id);
      expect(list.results.map((doc) => doc.id)).not.toContain(ids.conf);
      expect((await deptDocs(token, deptA.id, `?q=DCONF-${RUN}`)).count).toBe(0);
      expect(DENIED).toContain((await api(token, `/recafco/documents/${ids.conf}/`)).status);
    }
    expect(forC.get(deptA.id)).toBe(3);
    expect((await deptDocs(tC, deptA.id)).results.map((doc) => doc.id)).toContain(ids.conf);
    // Same through the portal pages.
    expect(await (await portalGet(`/departments/${deptA.id}`, c)).text()).toContain(`/documents/${ids.conf}`);
    expect(await (await portalGet(`/departments/${deptA.id}`, b)).text()).not.toContain(`/documents/${ids.conf}`);
    expect(await (await portalGet('/', b)).text()).toMatch(new RegExp(`${deptA.name}</span><span[^>]*>2(<!-- -->)? documents`));
  });

  it('cannot be added to favorites by someone who cannot see them', async () => {
    expect((await api(tB, `/recafco/documents/${ids.conf}/favorite/`, { method: 'POST' })).status).toBe(404);
  });

  it('a new confidential group admits only its members', async () => {
    const created = await json(tD, '/recafco/admin/confidential-groups/', 'POST', { name: `Group ${RUN}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const groupId = created.body.id as number;
    const docId = dev<{ document_id: number }>(
      'confidential-sample', '--label', `GCONF-${RUN}`, '--text', 'group secret', '--department', deptB.name, '--group-id', String(groupId),
    ).document_id;

    // Nobody is a member: neither the employee nor the original controllers can open it.
    for (const token of [tB, tC]) {
      expect(DENIED, 'before membership').toContain((await api(token, `/recafco/documents/${docId}/`)).status);
    }
    // Unit 5 policy: System Administrators open every confidential document without membership.
    expect((await api(tD, `/recafco/documents/${docId}/`)).status).toBe(200);
    const before = (await counts(tB)).get(deptB.id);

    const add = await json(tD, `/recafco/admin/confidential-groups/${groupId}/members/`, 'POST', { user_id: userIdB, is_member: true });
    expect(add.status).toBe(200);
    expect((await api(tB, `/recafco/documents/${docId}/`)).status).toBe(200);
    expect((await counts(tB)).get(deptB.id)).toBe((before ?? 0) + 1);
    expect(DENIED).toContain((await api(tA, `/recafco/documents/${docId}/`)).status);

    await json(tD, `/recafco/admin/confidential-groups/${groupId}/members/`, 'POST', { user_id: userIdB, is_member: false });
    expect(DENIED).toContain((await api(tB, `/recafco/documents/${docId}/`)).status);

    // The setup command keeps the group's ACL exact and gives employees nothing on it.
    const report = JSON.parse(execSetupReport());
    expect(report.roles['RECAFCO Employees'].document_type_acls).not.toHaveProperty(`RECAFCO Confidential - Group ${RUN}`);
    expect(report.roles[`RECAFCO Confidential - Group ${RUN}`].global_permissions).toEqual([]);
  });
});

function execSetupReport(): string {
  // recafco_setup without arguments: re-applies the model, adds nothing.
  return execFileSync('docker', [
    'compose', '--project-name', 'recafco-dms-dev', '--file', path.resolve(__dirname, '..', '..', '..', 'deploy', 'dev', 'compose.yaml'),
    'exec', '-T', '--user', 'mayan', 'app', '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_setup',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

describe('upload preselects and validates the department', () => {
  it('opening Upload from a department preselects it', async () => {
    const html = await (await portalGet(`/upload?department=${deptA.id}`, a)).text();
    expect(html).toMatch(new RegExp(`<option value="${deptA.name}" selected=""`));
  });

  it('refuses unknown and deactivated departments and categories on the server', async () => {
    expect((await json(tD, `/recafco/admin/departments/${deptOff.id}/`, 'PATCH', { is_active: false })).status).toBe(200);
    const html = await (await portalGet(`/upload?department=${deptOff.id}`, a)).text();
    expect(html).toContain('not available for new documents');
    expect(html).not.toContain(`value="${deptOff.name}"`);

    for (const [fields, field] of [
      [{ department: deptOff.name, category: 'Invoice' }, 'department'],
      [{ department: `Nope ${RUN}`, category: 'Invoice' }, 'department'],
      [{ department: deptA.name, category: `Nope ${RUN}` }, 'category'],
    ] as const) {
      const response = await portalUpload(a, { file: makePdf('x'), label: `REFUSED-${RUN}`, ...fields });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty(field);
    }
    expect(dev<{ count: number }>('find-label', `REFUSED-${RUN}`).count).toBe(0);
  });

  it('records uploader, department and category atomically', () => {
    const found = dev<{ documents: { classification: unknown; metadata: Record<string, string>; uploader: string }[] }>('find-label', `DA1-${RUN}`);
    expect(found.documents[0]).toMatchObject({
      classification: { department: deptA.name, category: 'Invoice' },
      metadata: { recafco_department: deptA.name, recafco_category: 'Invoice' },
      uploader: 'dev_employee_a',
    });
  });
});

describe('Department controllers', () => {
  beforeAll(async () => {
    const result = await json(tD, `/recafco/admin/users/${userIdB}/`, 'PATCH', { controller_department_ids: [deptA.id] });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  });

  it('can correct details of documents in their departments', async () => {
    const detail = (await api(tB, `/recafco/documents/${ids.a1}/`)).body;
    expect(detail.can_edit_details).toBe(true);
    expect(detail.editable_department_ids).toEqual([deptA.id]);
    const result = await json(tB, `/recafco/documents/${ids.a1}/details/`, 'PATCH', { category_id: categoryId, label: `DA1-${RUN} corrected` });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ category: CATEGORY, label: `DA1-${RUN} corrected` });
  });

  it('cannot move documents to a department they do not control', async () => {
    const result = await json(tB, `/recafco/documents/${ids.a1}/details/`, 'PATCH', { department_id: deptB.id });
    expect(result.status).toBe(400);
    expect((await api(tB, `/recafco/documents/${ids.a1}/`)).body.department).toBe(deptA.name);
  });

  it('cannot change documents of other departments; employees cannot change any', async () => {
    expect((await json(tB, `/recafco/documents/${ids.b1}/details/`, 'PATCH', { label: 'x' })).status).toBe(403);
    expect((await json(tA, `/recafco/documents/${ids.a2}/details/`, 'PATCH', { label: 'x' })).status).toBe(403);
    expect((await api(tA, `/recafco/documents/${ids.a2}/`)).body.can_edit_details).toBe(false);
  });

  it('are not administrators', async () => {
    expect((await api(tB, '/recafco/admin/overview/')).status).toBe(403);
    expect((await api(tB, '/recafco/me/')).body.is_admin).toBe(false);
  });
});

describe('RECAFCO administration', () => {
  it('renames a department; its documents follow, in the portal and in Mayan metadata', async () => {
    const name = `Dept B renamed ${RUN}`;
    const result = await json(tD, `/recafco/admin/departments/${deptB.id}/`, 'PATCH', { name });
    expect(result.status).toBe(200);
    expect((await api(tA, `/recafco/documents/${ids.b1}/`)).body.department).toBe(name);
    const found = dev<{ documents: { metadata: Record<string, string> }[] }>('find-label', `DB1-${RUN}`);
    expect(found.documents[0].metadata.recafco_department).toBe(name);
    deptB = { ...deptB, name };
  });

  it('refuses duplicate and unsafe names', async () => {
    for (const name of [deptA.name.toUpperCase(), 'Bad, name', 'Bad {% name', '  ']) {
      expect((await json(tD, '/recafco/admin/departments/', 'POST', { name })).status, name).toBe(400);
    }
  });

  it('reorders departments', async () => {
    const list = (await api(tD, '/recafco/admin/departments/')).body.results as Dept[];
    const order = list.map((dept) => dept.id).filter((id) => id !== deptB.id);
    order.splice(order.indexOf(deptA.id), 0, deptB.id); // B just before A
    expect((await json(tD, '/recafco/admin/departments/order/', 'POST', { ids: order })).status).toBe(200);
    const home = ((await api(tA, '/recafco/departments/')).body.departments as Dept[]).map((dept) => dept.id);
    expect(home.indexOf(deptB.id)).toBe(home.indexOf(deptA.id) - 1);
    expect((await json(tD, '/recafco/admin/departments/order/', 'POST', { ids: order.slice(1) })).status).toBe(400);
  });

  it('deactivating a department keeps its documents and history', async () => {
    expect((await json(tD, `/recafco/admin/departments/${deptB.id}/`, 'PATCH', { is_active: false })).status).toBe(200);
    const home = (await api(tA, '/recafco/departments/')).body;
    expect(home.departments.map((dept: Dept) => dept.id)).not.toContain(deptB.id);
    expect(home.inactive_departments.map((dept: Dept) => dept.id)).toContain(deptB.id);
    expect((await api(tA, `/recafco/documents/${ids.b1}/`)).body.department).toBe(deptB.name);
    expect((await deptDocs(tA, deptB.id)).results.map((doc) => doc.id)).toContain(ids.b1);
    const refused = await portalUpload(a, { file: makePdf('x'), label: `OFF-${RUN}`, department: deptB.name, category: 'Bill' });
    expect(refused.status).toBe(400);
    expect((await json(tD, `/recafco/admin/departments/${deptB.id}/`, 'PATCH', { is_active: true })).status).toBe(200);
  });

  it('manages categories: rename follows documents, deactivation blocks new uploads only', async () => {
    const renamed = `${CATEGORY} renamed`;
    expect((await json(tD, `/recafco/admin/categories/${categoryId}/`, 'PATCH', { name: renamed })).status).toBe(200);
    expect((await api(tA, `/recafco/documents/${ids.a2}/`)).body.category).toBe(renamed);
    expect((await json(tD, `/recafco/admin/categories/${categoryId}/`, 'PATCH', { is_active: false })).status).toBe(200);
    const refused = await portalUpload(a, { file: makePdf('x'), label: `CATOFF-${RUN}`, department: deptA.name, category: renamed });
    expect(refused.status).toBe(400);
    expect((await api(tA, `/recafco/documents/${ids.a2}/`)).body.category).toBe(renamed);
    expect((await json(tD, `/recafco/admin/categories/${categoryId}/`, 'PATCH', { is_active: true })).status).toBe(200);
  });

  it('creates a user with roles and departments, who can then sign in; deactivation and reactivation work', async () => {
    const username = `u_${RUN}`;
    const password = `Pw-${RUN}-${Math.random().toString(36).slice(2)}`;
    // Unit 4: the first password is temporary (anything non-empty) and must be replaced.
    const weak = await json(tD, '/recafco/admin/users/', 'POST', { username, password: '' });
    expect(weak.status).toBe(400);
    const created = await json(tD, '/recafco/admin/users/', 'POST', {
      username, password, first_name: 'Test', last_name: RUN, is_employee: true, department_ids: [deptA.id],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ is_employee: true, is_administrator: false, department_ids: [deptA.id], is_active: true });
    expect((await json(tD, '/recafco/admin/users/', 'POST', { username: username.toUpperCase(), password })).status).toBe(400);

    const first = await json(null, '/recafco/auth/login/', 'POST', { username, password });
    expect(first.body.must_change_password).toBe(true);
    const personal = `${password}-own`;
    expect((await json(first.body.token, '/recafco/auth/password/', 'POST', { current_password: password, new_password: personal })).status).toBe(200);
    const obtain = () => api(null, '/auth/token/obtain/', { method: 'POST', body: new URLSearchParams({ username, password: personal }) });
    const token = (await obtain()).body.token as string;
    expect((await api(token, '/recafco/me/')).body).toMatchObject({ can_upload: true, department_ids: [deptA.id], is_admin: false });
    expect((await deptDocs(token, deptA.id)).results.map((doc) => doc.id)).toContain(ids.a1);

    const off = await json(tD, `/recafco/admin/users/${created.body.id}/`, 'PATCH', { is_active: false });
    expect(off.status).toBe(200);
    expect(DENIED).toContain((await api(token, '/recafco/me/')).status);
    expect((await obtain()).status).not.toBe(200);
    expect((await json(tD, `/recafco/admin/users/${created.body.id}/`, 'PATCH', { is_active: true })).status).toBe(200);
    expect((await obtain()).status).toBe(200);

    const newPassword = `${password}-2`;
    expect((await json(tD, `/recafco/admin/users/${created.body.id}/password/`, 'POST', { password: newPassword })).status).toBe(204);
    expect((await api(null, '/auth/token/obtain/', { method: 'POST', body: new URLSearchParams({ username, password: newPassword }) })).status).toBe(200);
  });

  it('an administrator cannot deactivate themselves or drop their own admin role', async () => {
    const me = (await json(tD, '/recafco/admin/users/?q=dev_admin')).body.results[0];
    expect((await json(tD, `/recafco/admin/users/${me.id}/`, 'PATCH', { is_active: false })).status).toBe(400);
    expect((await json(tD, `/recafco/admin/users/${me.id}/`, 'PATCH', { is_administrator: false })).status).toBe(400);
  });

  it('Mayan system accounts are not listed or editable', async () => {
    const info = dev<{ id: number | null }>('superuser-id');
    if (info.id === null) return; // no superuser in this dev database
    expect((await api(tD, `/recafco/admin/users/${info.id}/`)).status).toBe(404);
    const choices = (await api(tD, '/recafco/admin/users/choices/')).body.results as { id: number }[];
    expect(choices.map((user) => user.id)).not.toContain(info.id);
  });

  it('transfers responsibility, with history; the original uploader never changes', async () => {
    const result = await json(tD, `/recafco/admin/documents/${ids.a1}/responsible/`, 'POST', { user_id: userIdB });
    expect(result.status).toBe(200);
    expect(result.body.uploaded_by.username).toBe(users.a.username);
    expect(result.body.responsible).toMatchObject({ username: users.b.username, assigned: true });
    const detail = (await api(tD, `/recafco/admin/documents/${ids.a1}/`)).body;
    const actions = detail.history.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['document.responsible_changed', 'document.details_changed']));
    // My uploads is about who uploaded: still the original uploader's.
    expect((await api(tA, '/recafco/uploads/mine/')).body.results.map((doc: Doc) => doc.id)).toContain(ids.a1);
    // The old endpoint that overwrote the uploader no longer exists.
    expect((await json(tD, `/recafco/admin/documents/${ids.a1}/owner/`, 'POST', { user_id: userIdB })).status).toBe(404);
  });

  it('System Administrators can open confidential documents of groups they are not in (Unit 5 policy)', async () => {
    expect((await api(tD, `/recafco/admin/documents/${ids.conf}/`)).status).toBe(200);
    expect((await api(tD, `/recafco/admin/documents/?q=DCONF-${RUN}`)).body.count).toBe(1);
  });

  it('works through the portal’s own admin form', async () => {
    const name = `Portal form ${RUN}`;
    const response = await portalAction(d, '/admin/categories', 'id="new-category"', { name });
    expect(response.status).toBeLessThan(400);
    const list = (await api(tD, '/recafco/admin/categories/')).body.results as { id: number; name: string }[];
    const created = list.find((item) => item.name === name);
    expect(created).toBeTruthy();
    await json(tD, `/recafco/admin/categories/${created!.id}/`, 'PATCH', { is_active: false });
  });

  it('records every change in the activity log', async () => {
    const log = (await api(tD, '/recafco/admin/audit/')).body;
    expect(log.count).toBeGreaterThan(5);
    expect(log.results[0].actor.username).toBe('dev_admin');
  });
});

describe('non-administrators are refused', () => {
  const endpoints: [string, 'GET' | 'POST' | 'PATCH', unknown?][] = [
    ['/recafco/admin/overview/', 'GET'],
    ['/recafco/admin/departments/', 'GET'],
    ['/recafco/admin/departments/', 'POST', { name: 'x' }],
    ['/recafco/admin/departments/1/', 'PATCH', { is_active: false }],
    ['/recafco/admin/departments/order/', 'POST', { ids: [] }],
    ['/recafco/admin/categories/', 'GET'],
    ['/recafco/admin/categories/', 'POST', { name: 'x' }],
    ['/recafco/admin/categories/1/', 'PATCH', { is_active: false }],
    ['/recafco/admin/users/', 'GET'],
    ['/recafco/admin/users/', 'POST', { username: 'x', password: 'xxxxxxxxxxxx' }],
    ['/recafco/admin/users/choices/', 'GET'],
    ['/recafco/admin/users/1/', 'GET'],
    ['/recafco/admin/users/1/', 'PATCH', { is_administrator: true }],
    ['/recafco/admin/users/1/password/', 'POST', { password: 'xxxxxxxxxxxx' }],
    ['/recafco/admin/confidential-groups/', 'GET'],
    ['/recafco/admin/confidential-groups/', 'POST', { name: 'x' }],
    ['/recafco/admin/confidential-groups/1/', 'GET'],
    ['/recafco/admin/confidential-groups/1/members/', 'POST', { user_id: 1, is_member: true }],
    ['/recafco/admin/documents/', 'GET'],
    ['/recafco/admin/documents/1/', 'GET'],
    ['/recafco/admin/documents/1/responsible/', 'POST', { user_id: 1 }],
    ['/recafco/admin/documents/1/reclassify/', 'POST', { confidential_group: 1 }],
    ['/recafco/admin/audit/', 'GET'],
  ];

  it.each(endpoints)('%s %s: employee, controller and confidential reader get 403; anonymous is refused', async (path, method, body) => {
    for (const token of [tA, tB, tC]) {
      expect((await json(token, path, method, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(DENIED).toContain((await json(null, path, method, body)).status);
  });

  it('a non-administrator cannot make themselves an administrator', async () => {
    expect((await json(tA, `/recafco/admin/users/${userIdB}/`, 'PATCH', { is_administrator: true })).status).toBe(403);
    expect((await api(tB, '/recafco/me/')).body.is_admin).toBe(false);
  });

  it.each(['/admin', '/admin/users', '/admin/departments', '/admin/confidential-groups', '/admin/documents/1', '/admin/activity'])(
    'the portal page %s shows no admin data to an employee',
    async (page) => {
      const html = await (await portalGet(page, a)).text();
      expect(html).toContain('only for RECAFCO administrators');
      expect(html).not.toContain('dev_employee_b');
      expect(html).not.toContain('Recent changes');
    },
  );

  it('a non-administrator cannot use the portal admin form', async () => {
    const name = `Sneaky ${RUN}`;
    // Post the admin form's action as the employee (action ID taken from the admin's page).
    const html = await (await portalGet('/admin/categories', d)).text();
    expect(html).toContain('id="new-category"');
    const response = await portalAction(a, '/admin/categories', 'id="new-category"', { name }, d);
    expect(response.status).toBeLessThan(500);
    const list = (await api(tD, '/recafco/admin/categories/')).body.results as { name: string }[];
    expect(list.map((item) => item.name)).not.toContain(name);
  });
});

describe('favorites', () => {
  it('adds and removes a favorite, shown on the Favorites page', async () => {
    expect((await api(tA, `/recafco/documents/${ids.a2}/favorite/`, { method: 'POST' })).status).toBe(200);
    expect((await api(tA, `/recafco/documents/${ids.a2}/`)).body.is_favorite).toBe(true);
    expect(await (await portalGet('/favorites', a)).text()).toContain(`/documents/${ids.a2}`);
    expect(await (await portalGet('/favorites', b)).text()).not.toContain(`/documents/${ids.a2}`);
    expect((await api(tA, `/recafco/documents/${ids.a2}/favorite/`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(tA, '/recafco/favorites/')).body.results.map((doc: Doc) => doc.id)).not.toContain(ids.a2);
  });
});
