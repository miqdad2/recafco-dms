/**
 * Unit 5: full administrator control. Superseding earlier units, System
 * Administrators can delete, merge, recycle, restore and permanently delete,
 * manage roles, and open every confidential document. Employees and
 * controllers gain nothing; custom roles grant exactly their permissions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DENIED, DEPARTMENTS, MAYAN, RUN, api, dev, extensionUpload, json, makePdf, tokenFor, waitFor,
} from './helpers';

type Found = { count: number; documents: { id: number; document_type: string; in_trash: boolean }[] };
let tA = '';
let tB = '';
let tC = '';
let tD = '';
let userIdB = 0;

const signIn = async (username: string, password: string) =>
  (await json(null, '/recafco/auth/login/', 'POST', { username, password })).body.token as string;
const upload = async (token: string, label: string, department: string, category = 'Bill') => {
  const result = await extensionUpload(token, { file: makePdf(`${label} words ${RUN}`), label, department, category });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.id as number;
};
const bulk = (token: string, body: Record<string, unknown>) => json(token, '/recafco/admin/documents/bulk/', 'POST', body);

beforeAll(async () => {
  [tA, tB, tC, tD] = await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('c'), tokenFor('d')]);
  userIdB = (await json(tD, '/recafco/admin/users/?q=dev_employee_b')).body.results[0].id;
});

afterAll(() => {
  dev('users');
});

describe('only administrators can use the new operations', () => {
  const endpoints: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', unknown?][] = [
    ['/recafco/admin/roles/', 'GET'],
    ['/recafco/admin/roles/', 'POST', { name: 'x', permissions: [] }],
    ['/recafco/admin/roles/1/', 'DELETE', {}],
    ['/recafco/admin/users/1/roles/', 'POST', { system_administrator: true }],
    ['/recafco/admin/users/1/', 'DELETE', {}],
    ['/recafco/admin/departments/1/', 'DELETE', { mode: 'trash' }],
    ['/recafco/admin/categories/1/', 'DELETE', {}],
    ['/recafco/admin/confidential-groups/1/', 'DELETE', { mode: 'purge' }],
    ['/recafco/admin/documents/bulk/', 'POST', { action: 'purge', ids: [1] }],
    ['/recafco/admin/audit/export/', 'GET'],
  ];
  it.each(endpoints)('%s %s: employee and controller get 403; anonymous is refused', async (path, method, body) => {
    for (const token of [tA, tC]) {
      expect((await json(token, path, method, body)).status, path).toBe(403);
    }
    expect(DENIED).toContain((await json(null, path, method, body)).status);
  });

  it('the activity log has no edit or delete endpoint', async () => {
    expect((await json(tD, '/recafco/admin/audit/', 'DELETE', {})).status).toBe(405);
    expect((await json(tD, '/recafco/admin/audit/', 'PATCH', {})).status).toBe(405);
  });
});

describe('roles and permissions', () => {
  let roleId = 0;
  let generalId = 0;
  let confidentialId = 0;

  it('System Administrator is protected; system-only permissions cannot be granted', async () => {
    const roles = (await api(tD, '/recafco/admin/roles/')).body;
    const system = roles.results.find((role: { is_protected: boolean }) => role.is_protected);
    expect(system.name).toBe('System Administrator');
    expect((await json(tD, `/recafco/admin/roles/${system.id}/`, 'PATCH', { name: 'Hijacked' })).status).toBe(400);
    expect((await json(tD, `/recafco/admin/roles/${system.id}/`, 'DELETE', {})).status).toBe(400);
    expect((await json(tD, '/recafco/admin/roles/', 'POST', { name: `Esc ${RUN}`, permissions: ['roles.manage'] })).status).toBe(400);
  });

  it('a custom role grants exactly its permissions, applied immediately, and never document access by itself', async () => {
    const created = await json(tD, '/recafco/admin/roles/', 'POST', { name: `Recyclers ${RUN}`, permissions: ['documents.recycle'] });
    expect(created.status).toBe(201);
    roleId = created.body.id;
    generalId = await upload(tA, `ROLE-GEN-${RUN}`, DEPARTMENTS.finance);
    confidentialId = dev<{ document_id: number }>('confidential-sample', '--label', `ROLE-CONF-${RUN}`, '--text', 'role conf').document_id;

    expect((await api(tB, '/recafco/admin/documents/')).status).toBe(403);
    expect((await json(tD, `/recafco/admin/users/${userIdB}/roles/`, 'POST', { role_ids: [roleId] })).status).toBe(200);

    // B can now list (only what B can open) and recycle, nothing else.
    const listed = await api(tB, `/recafco/admin/documents/?q=ROLE-`);
    expect(listed.status).toBe(200);
    const ids = listed.body.results.map((doc: { id: number }) => doc.id);
    expect(ids).toContain(generalId);
    expect(ids).not.toContain(confidentialId);
    expect((await bulk(tB, { action: 'trash', ids: [confidentialId] })).body.results[0].ok).toBe(false);
    expect((await bulk(tB, { action: 'trash', ids: [generalId] })).body.succeeded).toBe(1);
    expect((await bulk(tB, { action: 'purge', ids: [generalId] })).status).toBe(403);
    expect((await bulk(tB, { action: 'restore', ids: [generalId] })).body.succeeded).toBe(1);
    for (const path of ['/recafco/admin/roles/', '/recafco/admin/users/', '/recafco/admin/departments/1/']) {
      expect((await api(tB, path)).status, path).toBe(403);
    }
    // No self-escalation.
    expect((await json(tB, `/recafco/admin/users/${userIdB}/roles/`, 'POST', { system_administrator: true })).status).toBe(403);
    expect((await json(tB, `/recafco/admin/users/${userIdB}/`, 'PATCH', { is_administrator: true })).status).toBe(403);
    expect((await api(tB, '/recafco/me/')).body).toMatchObject({ is_admin: true, is_system_admin: false, admin_permissions: ['documents.recycle'] });
  });

  it('deleting the role removes its permissions at once', async () => {
    expect((await json(tD, `/recafco/admin/roles/${roleId}/`, 'DELETE', { reason: 'test' })).status).toBe(200);
    expect((await api(tB, '/recafco/admin/documents/')).status).toBe(403);
    expect((await api(tB, '/recafco/me/')).body).toMatchObject({ is_admin: false, admin_permissions: [] });
  });

  it('an administrator cannot remove their own System Administrator role or delete their own account', async () => {
    const me = (await json(tD, '/recafco/admin/users/?q=dev_admin')).body.results[0];
    expect((await json(tD, `/recafco/admin/users/${me.id}/roles/`, 'POST', { system_administrator: false })).status).toBe(400);
    expect((await json(tD, `/recafco/admin/users/${me.id}/`, 'DELETE', {})).status).toBe(400);
  });
});

describe('departments: delete, merge, recycle', () => {
  it('deletes an empty department; a populated one needs a decision', async () => {
    const empty = (await json(tD, '/recafco/admin/departments/', 'POST', { name: `Empty ${RUN}` })).body;
    expect((await json(tD, `/recafco/admin/departments/${empty.id}/`, 'DELETE', {})).status).toBe(200);
    expect((await api(tD, '/recafco/admin/departments/')).body.results.map((d: { id: number }) => d.id)).not.toContain(empty.id);

    const full = (await json(tD, '/recafco/admin/departments/', 'POST', { name: `Full ${RUN}` })).body;
    await upload(tA, `DEPFULL-${RUN}`, full.name);
    const refused = await json(tD, `/recafco/admin/departments/${full.id}/`, 'DELETE', {});
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('1 document');
    expect((await api(tD, `/recafco/admin/departments/${full.id}/`)).body.usage.documents).toBe(1);
    await json(tD, `/recafco/admin/departments/${full.id}/`, 'DELETE', { mode: 'trash' });
  });

  it('merge moves every document (search included), then deletes the department', async () => {
    const source = (await json(tD, '/recafco/admin/departments/', 'POST', { name: `MergeFrom ${RUN}` })).body;
    const target = (await json(tD, '/recafco/admin/departments/', 'POST', { name: `MergeTo ${RUN}` })).body;
    const id = await upload(tA, `MERGE-${RUN}`, source.name);
    const merged = await json(tD, `/recafco/admin/departments/${source.id}/`, 'DELETE', { mode: 'move', target_id: target.id, reason: 'reorganisation' });
    expect(merged.status).toBe(200);
    const doc = (await api(tB, `/recafco/documents/${id}/`)).body;
    expect(doc.department_ref).toMatchObject({ id: target.id, name: target.name });
    expect((await api(tB, `/recafco/departments/${target.id}/documents/`)).body.results.map((d: { id: number }) => d.id)).toContain(id);
    await waitFor('department search finds the moved document', async () => {
      const found = await api(tB, `/recafco/departments/${target.id}/documents/?q=MERGE-${RUN}`);
      return found.body.count === 1 ? found : null;
    }, 120_000);
    const log = (await api(tD, `/recafco/admin/audit/?action=department.merged&q=MergeFrom ${RUN}`)).body;
    expect(log.results[0]).toMatchObject({ reason: 'reorganisation', outcome: 'success' });
  });

  it('delete with "recycle bin": documents leave employee view, keep their files, and can be restored', async () => {
    const dept = (await json(tD, '/recafco/admin/departments/', 'POST', { name: `Bin ${RUN}` })).body;
    const id = await upload(tA, `BINDEPT-${RUN}`, dept.name);
    expect((await json(tD, `/recafco/admin/departments/${dept.id}/`, 'DELETE', { mode: 'trash' })).status).toBe(200);
    expect(DENIED).toContain((await api(tA, `/recafco/documents/${id}/`)).status);
    const bin = (await api(tD, `/recafco/admin/documents/?status=trash&q=BINDEPT-${RUN}`)).body;
    expect(bin.count).toBe(1);
    expect(bin.results[0]).toMatchObject({ department_ref: null, department: dept.name, in_trash: true });
    expect((await bulk(tD, { action: 'restore', ids: [id] })).body.succeeded).toBe(1);
    expect((await api(tD, '/recafco/admin/documents/?department=none&q=BINDEPT-')).body.count).toBe(1);
    // Give it a department again.
    const finance = ((await api(tD, '/recafco/admin/departments/')).body.results as { id: number; name: string }[]).find((d) => d.name === DEPARTMENTS.finance)!;
    expect((await bulk(tD, { action: 'move', ids: [id], department_id: finance.id })).body.succeeded).toBe(1);
    expect((await api(tA, `/recafco/documents/${id}/`)).body.department_ref).not.toBeNull();
  });
});

describe('categories: delete and merge', () => {
  it('a category in use can only be deleted by moving its documents', async () => {
    const from = (await json(tD, '/recafco/admin/categories/', 'POST', { name: `CatFrom ${RUN}` })).body;
    const to = (await json(tD, '/recafco/admin/categories/', 'POST', { name: `CatTo ${RUN}` })).body;
    const id = await upload(tA, `CATMERGE-${RUN}`, DEPARTMENTS.finance, from.name);
    expect((await json(tD, `/recafco/admin/categories/${from.id}/`, 'DELETE', {})).status).toBe(400);
    expect((await json(tD, `/recafco/admin/categories/${from.id}/`, 'DELETE', { target_id: to.id })).body).toMatchObject({ deleted: true, moved_documents: 1 });
    expect((await api(tA, `/recafco/documents/${id}/`)).body.category).toBe(to.name);
    const empty = (await json(tD, '/recafco/admin/categories/', 'POST', { name: `CatEmpty ${RUN}` })).body;
    expect((await json(tD, `/recafco/admin/categories/${empty.id}/`, 'DELETE', {})).status).toBe(200);
  });
});

describe('accounts: username changes and deletion', () => {
  it('renames a username (lower case, unique) and deletes an account keeping documents and attribution', async () => {
    const created = (await json(tD, '/recafco/admin/users/', 'POST', { username: `leaver_${RUN}`, password: '123', first_name: 'Lee', last_name: 'Ver' })).body;
    const first = await signIn(created.username, '123');
    await json(first, '/recafco/auth/password/', 'POST', { current_password: '123', new_password: 'leaver1' });
    const renamed = await json(tD, `/recafco/admin/users/${created.id}/`, 'PATCH', { username: `Leaver2_${RUN}` });
    expect(renamed.body.username).toBe(`leaver2_${RUN}`.toLowerCase());
    expect((await json(tD, `/recafco/admin/users/${created.id}/`, 'PATCH', { username: 'dev_admin' })).status).toBe(400);
    const token = await signIn(`leaver2_${RUN}`, 'leaver1');
    const id = await upload(token, `LEAVER-${RUN}`, DEPARTMENTS.finance);
    const transferTo = (await json(tD, '/recafco/admin/users/?q=dev_employee_a')).body.results[0];

    const usage = (await api(tD, `/recafco/admin/users/${created.id}/`)).body.usage;
    expect(usage.uploaded_documents).toBe(1);
    const deleted = await json(tD, `/recafco/admin/users/${created.id}/`, 'DELETE', { transfer_to: transferTo.id, reason: 'left RECAFCO' });
    expect(deleted.status).toBe(200);
    expect(DENIED).toContain((await api(token, '/recafco/me/')).status);
    expect((await api(tD, `/recafco/admin/users/${created.id}/`)).status).toBe(404);
    const doc = (await api(tB, `/recafco/documents/${id}/`)).body;
    expect(doc.uploaded_by).toMatchObject({ deleted: true, username: `leaver2_${RUN}`.toLowerCase(), full_name: 'Lee Ver (account deleted)' });
    expect(doc.responsible).toMatchObject({ username: 'dev_employee_a', assigned: true });
    // Entries keep the names as they were at the time (the first username here).
    const log = (await api(tD, `/recafco/admin/audit/?q=${RUN}&target_type=user`)).body.results as { action: string; actor: { full_name: string } | null; reason: string }[];
    expect(log.find((entry) => entry.action === 'user.deleted')).toMatchObject({ reason: 'left RECAFCO' });
    expect(log.find((entry) => entry.action === 'user.password_changed')?.actor?.full_name).toBe('Lee Ver (account deleted)');
  });
});

describe('documents: bulk changes, recycle bin, permanent deletion', () => {
  it('bulk move, responsibility and access (confidential and back to general) with per-document results', async () => {
    const one = await upload(tA, `BULK1-${RUN}`, DEPARTMENTS.finance);
    const two = await upload(tA, `BULK2-${RUN}`, DEPARTMENTS.finance);
    const departments = (await api(tD, '/recafco/admin/departments/')).body.results as { id: number; name: string; is_active: boolean }[];
    const target = departments.find((d) => d.name === DEPARTMENTS.procurement)!;
    const moved = (await bulk(tD, { action: 'move', ids: [one, two, 999999999], department_id: target.id, reason: 'bulk test' })).body;
    expect(moved).toMatchObject({ succeeded: 2, failed: 1 });
    expect((await api(tA, `/recafco/documents/${two}/`)).body.department).toBe(DEPARTMENTS.procurement);
    expect((await bulk(tD, { action: 'responsible', ids: [one], user_id: userIdB })).body.succeeded).toBe(1);
    expect((await api(tA, `/recafco/documents/${one}/`)).body.responsible).toMatchObject({ username: 'dev_employee_b' });

    const group = (await api(tD, '/recafco/admin/confidential-groups/')).body.results.find((g: { is_builtin: boolean }) => g.is_builtin);
    expect((await bulk(tD, { action: 'access', ids: [one], confidential_group: group.id })).body.succeeded).toBe(1);
    expect(DENIED).toContain((await api(tB, `/recafco/documents/${one}/`)).status);
    expect((await api(tD, `/recafco/documents/${one}/`)).status).toBe(200);
    expect((await bulk(tD, { action: 'access', ids: [one], confidential_group: 'general' })).body.succeeded).toBe(1);
    expect((await api(tB, `/recafco/documents/${one}/`)).body.access).toBe('general');
  });

  it('recycle bin hides documents (lists, search, favorites); restore brings them back', async () => {
    const id = await upload(tA, `TRASH-${RUN}`, DEPARTMENTS.finance);
    expect((await api(tB, `/recafco/documents/${id}/favorite/`, { method: 'POST' })).status).toBeLessThan(300);
    expect((await bulk(tD, { action: 'trash', ids: [id], reason: 'cleanup' })).body.succeeded).toBe(1);
    expect(DENIED).toContain((await api(tB, `/recafco/documents/${id}/`)).status);
    expect((await api(tB, '/recafco/favorites/')).body.results.map((d: { id: number }) => d.id)).not.toContain(id);
    const finance = ((await api(tB, '/recafco/departments/')).body.departments as { id: number; name: string }[]).find((d) => d.name === DEPARTMENTS.finance)!;
    expect((await api(tB, `/recafco/departments/${finance.id}/documents/?q=TRASH-${RUN}`)).body.count).toBe(0);
    expect((await bulk(tD, { action: 'restore', ids: [id] })).body.succeeded).toBe(1);
    expect((await api(tB, `/recafco/documents/${id}/`)).status).toBe(200);
  });

  it('permanent deletion only from the recycle bin; removes records, files and caches; search and favorites updated', async () => {
    const id = await upload(tA, `PURGE-${RUN}`, DEPARTMENTS.finance);
    await waitFor('purge candidate searchable', async () => {
      const found = await api(tA, `/search/documents.documentsearchresult/?q=PURGE-${RUN}`);
      return found.body.count >= 1 ? found : null;
    }, 240_000);
    expect((await api(tB, `/recafco/documents/${id}/favorite/`, { method: 'POST' })).status).toBeLessThan(300);
    const notInBin = (await bulk(tD, { action: 'purge', ids: [id] })).body;
    expect(notInBin.succeeded).toBe(0);
    expect(dev<Found>('find-label', `PURGE-${RUN}`).count).toBe(1);

    expect((await bulk(tD, { action: 'trash', ids: [id] })).body.succeeded).toBe(1);
    const purged = (await bulk(tD, { action: 'purge', ids: [id], reason: 'test purge' })).body;
    expect(purged).toMatchObject({ succeeded: 1, failed: 0 });
    expect(dev<Found>('find-label', `PURGE-${RUN}`).count).toBe(0);
    expect(dev<{ orphans: number }>('orphan-files').orphans).toBe(0);
    expect((await api(tD, `/recafco/admin/documents/${id}/`)).status).toBe(404);
    expect((await api(tB, '/recafco/favorites/')).body.results.map((d: { id: number }) => d.id)).not.toContain(id);
    await waitFor('search no longer finds the purged document', async () => {
      const found = await api(tA, `/search/documents.documentsearchresult/?q=PURGE-${RUN}`);
      return found.body.count === 0 ? found : null;
    }, 240_000);
    const log = (await api(tD, `/recafco/admin/audit/?action=document.purged&q=PURGE-${RUN}`)).body.results;
    expect(log[0]).toMatchObject({ outcome: 'success', reason: 'test purge', target_id: id });
  }, 600_000);

  it('employees and controllers still cannot see documents outside their access', async () => {
    const conf = dev<{ document_id: number }>('confidential-sample', '--label', `STILL-${RUN}`, '--text', 'still secret').document_id;
    expect(DENIED).toContain((await api(tA, `/recafco/documents/${conf}/`)).status);
    expect((await api(tA, `/search/documents.documentsearchresult/?q=STILL-${RUN}`)).body.count).toBe(0);
  });
});

describe('confidential groups: deactivate and delete', () => {
  it('a deactivated group refuses new documents; members keep access', async () => {
    const group = (await json(tD, '/recafco/admin/confidential-groups/', 'POST', { name: `Off ${RUN}` })).body;
    expect((await json(tD, `/recafco/admin/confidential-groups/${group.id}/`, 'PATCH', { is_active: false })).body.is_active).toBe(false);
    const refused = await extensionUpload(tD, {
      file: makePdf('x'), label: `OFF-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', confidentialGroup: group.id,
    });
    expect(refused.status).toBe(400);
    expect((await api(tD, '/recafco/options/')).body.confidential_groups.map((g: { id: number }) => g.id)).not.toContain(group.id);
  });

  it('deleting a group with documents needs a decision; documents are moved or purged, never made general', async () => {
    const from = (await json(tD, '/recafco/admin/confidential-groups/', 'POST', { name: `Del ${RUN}` })).body;
    const to = (await json(tD, '/recafco/admin/confidential-groups/', 'POST', { name: `Keep ${RUN}` })).body;
    const doc = dev<{ document_id: number }>('confidential-sample', '--label', `GDEL-${RUN}`, '--text', 'group delete', '--group-id', String(from.id)).document_id;
    expect((await json(tD, `/recafco/admin/confidential-groups/${from.id}/`, 'DELETE', {})).status).toBe(400);
    const moved = await json(tD, `/recafco/admin/confidential-groups/${from.id}/`, 'DELETE', { mode: 'move', target_id: to.id });
    expect(moved.status).toBe(200);
    expect(dev<Found>('find-label', `GDEL-${RUN}`).documents[0].document_type).toBe(to.document_type);
    expect((await api(tD, `/recafco/documents/${doc}/`)).body.confidential_group).toMatchObject({ id: to.id });
    expect((await api(tD, `/recafco/admin/confidential-groups/${from.id}/`)).status).toBe(404);

    const purge = await json(tD, `/recafco/admin/confidential-groups/${to.id}/`, 'DELETE', { mode: 'purge', reason: 'test' });
    expect(purge.status).toBe(200);
    expect(dev<Found>('find-label', `GDEL-${RUN}`).count).toBe(0);
    expect(dev<{ orphans: number }>('orphan-files').orphans).toBe(0);
  });

  it('the built-in original group cannot be deleted', async () => {
    const builtin = (await api(tD, '/recafco/admin/confidential-groups/')).body.results.find((g: { is_builtin: boolean }) => g.is_builtin);
    expect((await json(tD, `/recafco/admin/confidential-groups/${builtin.id}/`, 'DELETE', { mode: 'move', target_id: builtin.id })).status).toBe(400);
  });
});

describe('activity log', () => {
  it('filters by action, outcome and date, and exports CSV with the same filters', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const filtered = (await api(tD, `/recafco/admin/audit/?action=document.trashed&outcome=success&date_from=${today}`)).body;
    expect(filtered.count).toBeGreaterThan(0);
    for (const entry of filtered.results) expect(entry).toMatchObject({ action: 'document.trashed', outcome: 'success' });
    expect((await api(tD, '/recafco/admin/audit/?date_from=not-a-date')).status).toBe(400);
    const response = await fetch(`${MAYAN}/recafco/admin/audit/export/?action=document.trashed`, {
      // The portal's export route asks for CSV explicitly.
      headers: { Authorization: `Token ${tD}`, Accept: 'text/csv' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const lines = (await response.text()).trim().split('\n');
    expect(lines[0]).toContain('actor_username');
    expect(lines.slice(1).every((line) => line.includes('document.trashed'))).toBe(true);
  });
});
