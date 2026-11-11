/**
 * Unit 3: confidential document handling.
 *
 * Rules: administrators manage groups; only administrators classify a
 * document as confidential (upload or reclassification), always to an
 * explicit group; controllers cannot change confidentiality; administration
 * alone gives no access to content; reclassifying needs administrator
 * authority AND current access; no confidential-to-general release.
 * After a change, access is rechecked everywhere at once, including for
 * portal sessions that already exist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DENIED, DEPARTMENTS, RUN, type PortalSession, api, binary, dev, extensionUpload, json, makePdf,
  newOperationId, portalGet, portalLogin, portalUpload, tokenFor, waitFor, waitReady,
} from './helpers';

type Found = { count: number; documents: { id: number; document_type: string; uploader: string | null }[] };
type Group = { id: number; name: string; document_type: string };

let tA: string; let tB: string; let tC: string; let tD: string;
let a: PortalSession; let b: PortalSession; let d: PortalSession;
let groupG: Group; let groupH: Group;
let userA: number; let userB: number; let userD: number;
const userIds: Record<string, number> = {};

const member = (group: Group, userId: number, isMember: boolean) =>
  json(tD, `/recafco/admin/confidential-groups/${group.id}/members/`, 'POST', { user_id: userId, is_member: isMember });

const departmentCount = async (token: string, name: string) => {
  const body = (await api(token, '/recafco/departments/')).body as { departments: { name: string; document_count: number }[] };
  return body.departments.find((department) => department.name === name)?.document_count ?? 0;
};

beforeAll(async () => {
  [tA, tB, tC, tD] = await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('c'), tokenFor('d')]);
  [a, b, d] = (await Promise.all((['a', 'b', 'd'] as const).map((key) => portalLogin(key)))).map((result) => result.session!);
  for (const username of ['dev_employee_a', 'dev_employee_b', 'dev_admin']) {
    userIds[username] = (await json(tD, `/recafco/admin/users/?q=${username}`)).body.results[0].id;
  }
  [userA, userB, userD] = [userIds.dev_employee_a, userIds.dev_employee_b, userIds.dev_admin];
  const created = await Promise.all(
    [`G ${RUN}`, `H ${RUN}`].map((name) => json(tD, '/recafco/admin/confidential-groups/', 'POST', { name })),
  );
  [groupG, groupH] = created.map((result) => {
    expect(result.status).toBe(201);
    return result.body as Group;
  });
  // A is a member of G. The administrator is in no group.
  expect((await member(groupG, userA, true)).status).toBe(200);
});

afterAll(async () => {
  await json(tD, `/recafco/admin/users/${userB}/`, 'PATCH', { controller_department_ids: [] });
});

describe('confidential upload', () => {
  it('is refused for everyone who is not an administrator, even group members and controllers', async () => {
    const label = `CUPNO-${RUN}`;
    for (const token of [tA, tB, tC]) {
      const result = await extensionUpload(token, {
        file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Bill', confidentialGroup: groupG.id,
      });
      expect(result.status).toBe(403);
    }
    expect(dev<Found>('find-label', label).count).toBe(0);
  });

  it('needs an existing group', async () => {
    const result = await extensionUpload(tD, {
      file: makePdf('x'), label: `CUPBAD-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', confidentialGroup: 999999,
    });
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('confidential_group');
  });

  let documentId: number;

  it('an administrator uploads to a group; it is confidential from the first moment', async () => {
    const label = `CUP-${RUN}`;
    const operationId = newOperationId();
    const response = await portalUpload(d, {
      file: makePdf(`confidential upload ${RUN}`), label, department: DEPARTMENTS.finance, category: 'Bill',
      confidentialGroup: groupG.id, operationId,
    });
    expect(response.status).toBe(201);
    const receipt = await response.json();
    // Unit 5 changed policy: System Administrators can open every confidential document.
    // The uploading System Administrator gets the full document, not only a receipt.
    expect(receipt).toMatchObject({ accessible: true, label, access: 'confidential', confidential_group: { id: groupG.id } });
    documentId = receipt.id;
    // Created directly in the group's own document type (never "RECAFCO General").
    const found = dev<Found>('find-label', label);
    expect(found.documents[0]).toMatchObject({ document_type: groupG.document_type, uploader: 'dev_admin' });
    // A retry of the same upload returns the same receipt.
    const again = await portalUpload(d, {
      file: makePdf(`confidential upload ${RUN}`), label, department: DEPARTMENTS.finance, category: 'Bill',
      confidentialGroup: groupG.id, operationId,
    });
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(documentId);
  });

  it('a non-member employee cannot open, preview or download it; the member and System Administrators can', async () => {
    const forMember = await waitReady(tA, documentId);
    const fileId = forMember.file.id;
    const pageId = forMember.version.page_ids[0];
    const versionId = forMember.version.id;
    // Unit 5 changed policy: System Administrators can open every confidential document.
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
    expect((await binary(tD, `/documents/${documentId}/files/${fileId}/download/`)).status).toBe(200);
    expect((await portalGet(`/documents/${documentId}`, d)).status).toBe(200);
    for (const token of [tB]) {
      expect(DENIED).toContain((await api(token, `/recafco/documents/${documentId}/`)).status);
      expect(DENIED).toContain((await binary(token, `/documents/${documentId}/files/${fileId}/download/`)).status);
      expect(DENIED).toContain((await binary(token, `/documents/${documentId}/versions/${versionId}/pages/${pageId}/image/`)).status);
    }
    expect((await portalGet(`/documents/${documentId}`, b)).status).toBe(404);
    expect((await portalGet(`/api/documents/${documentId}/files/${fileId}/download`, b)).status).toBe(404);
    expect((await portalGet(`/documents/${documentId}`, a)).status).toBe(200);
    expect((await binary(tA, `/documents/${documentId}/files/${fileId}/download/`)).status).toBe(200);
  });

  it('is visible to System Administrators with or without membership (Unit 5 policy)', async () => {
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
    expect((await member(groupG, userD, true)).status).toBe(200);
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
    expect((await member(groupG, userD, false)).status).toBe(200);
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
  });
});

describe('reclassifying an existing document', () => {
  let documentId: number;
  let fileId: number;
  let versionId: number;
  let pageId: number;
  const label = `RECL-${RUN}`;
  const word = `reclword${RUN}`;

  beforeAll(async () => {
    const created = await extensionUpload(tB, { file: makePdf(word), label, department: DEPARTMENTS.procurement, category: 'Invoice' });
    expect(created.status).toBe(201);
    documentId = created.body.id;
    const ready = await waitReady(tB, documentId);
    fileId = ready.file.id;
    versionId = ready.version.id;
    pageId = ready.version.page_ids[0];
    // B uses it: favorite, sees it in search and in the department count.
    expect((await api(tB, `/recafco/documents/${documentId}/favorite/`, { method: 'POST' })).status).toBe(200);
    await waitFor('search finds the general document', async () => {
      const html = await (await portalGet(`/search?q=${word}`, b)).text();
      return html.includes(`/documents/${documentId}`);
    }, 180_000, 3000);
    // B is a Department controller for that department.
    const procurement = ((await api(tD, '/recafco/admin/departments/')).body.results as { id: number; name: string }[])
      .find((department) => department.name === DEPARTMENTS.procurement)!;
    expect((await json(tD, `/recafco/admin/users/${userB}/`, 'PATCH', { controller_department_ids: [procurement.id] })).status).toBe(200);
  });

  it('is refused to non-administrators, including Department controllers and confidential readers', async () => {
    for (const token of [tA, tB, tC]) {
      expect((await json(token, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: groupG.id })).status).toBe(403);
    }
    // A controller's detail correction cannot carry an access change.
    const sneaky = await json(tB, `/recafco/documents/${documentId}/details/`, 'PATCH', { confidential_group: groupG.id });
    expect(sneaky.status).toBe(400);
    expect((await api(tB, `/recafco/documents/${documentId}/`)).body.access).toBe('general');
  });

  it('needs an explicit choice: a group ID, or null for general (Unit 5 allows release to general)', async () => {
    for (const body of [{}, { confidential_group: 'general' }]) {
      expect((await json(tD, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', body)).status).toBe(400);
    }
    // Already general: an explicit null is accepted and changes nothing.
    const same = await json(tD, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: null });
    expect(same.status).toBe(200);
    expect(same.body.changed).toBe(false);
  });

  it('takes effect at once for search, counts, favorites, previews, downloads and existing sessions', async () => {
    const countBefore = await departmentCount(tB, DEPARTMENTS.procurement);
    // B's portal session exists already and keeps being used below.
    expect((await portalGet(`/documents/${documentId}`, b)).status).toBe(200);

    const result = await json(tD, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: groupG.id });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ changed: true, accessible: true, confidential_group: { id: groupG.id } });
    expect(dev<Found>('find-label', label).documents[0].document_type).toBe(groupG.document_type);

    // The original uploader (B, not a member) lost access immediately.
    expect(DENIED).toContain((await api(tB, `/recafco/documents/${documentId}/`)).status);
    expect((await portalGet(`/documents/${documentId}`, b)).status).toBe(404);
    expect((await portalGet(`/api/documents/${documentId}/files/${fileId}/download`, b)).status).toBe(404);
    expect((await portalGet(`/api/documents/${documentId}/versions/${versionId}/pages/${pageId}/image`, b)).status).toBe(404);
    expect(await (await portalGet(`/search?q=${word}`, b)).text()).not.toContain(`/documents/${documentId}`);
    expect((await api(tB, `/search/documents.documentsearchresult/?q=${word}`)).body.count).toBe(0);
    expect(await departmentCount(tB, DEPARTMENTS.procurement)).toBe(countBefore - 1);
    expect((await api(tB, '/recafco/favorites/')).body.results.map((doc: { id: number }) => doc.id)).not.toContain(documentId);
    expect(await (await portalGet('/favorites', b)).text()).not.toContain(`/documents/${documentId}`);
    expect(await (await portalGet('/my-uploads', b)).text()).not.toContain(`/documents/${documentId}`);

    // Unit 5 changed policy: System Administrators can open every confidential document.
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
    // The member can open it.
    expect((await api(tA, `/recafco/documents/${documentId}/`)).body).toMatchObject({
      access: 'confidential', confidential_group: { id: groupG.id }, uploaded_by: { username: 'dev_employee_b' },
    });
  });

  it('a System Administrator moves it to another group without membership, never via general', async () => {
    const result = await json(tD, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: groupH.id });
    expect(result.status).toBe(200);
    expect(dev<Found>('find-label', label).documents[0].document_type).toBe(groupH.document_type);
    // H has no members: employees of G lose it; System Administrators keep it.
    for (const token of [tA, tB]) {
      expect(DENIED).toContain((await api(token, `/recafco/documents/${documentId}/`)).status);
    }
    expect((await api(tD, `/recafco/documents/${documentId}/`)).status).toBe(200);
  });

  it('is recorded in the document history and the activity log', async () => {
    const log = (await api(tD, '/recafco/admin/audit/')).body.results as { action: string; target_id: number; details: Record<string, unknown> }[];
    const entries = log.filter((entry) => entry.action === 'document.access_changed' && entry.target_id === documentId);
    expect(entries.length).toBe(2);
  });

  it('can be released back to general only by an explicit administrator action (Unit 5)', async () => {
    const released = await json(tD, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: null, reason: 'released by test' });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ changed: true, confidential_group: null });
    expect((await api(tB, `/recafco/documents/${documentId}/`)).body.access).toBe('general');
    // Employees still cannot do it.
    expect((await json(tB, `/recafco/admin/documents/${documentId}/reclassify/`, 'POST', { confidential_group: groupG.id })).status).toBe(403);
  });
});

describe('original uploader and responsible person', () => {
  it('an admin transfer changes the responsible person only', async () => {
    const created = await extensionUpload(tA, { file: makePdf('resp'), label: `RESP-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill' });
    const id = created.body.id;
    expect(created.body.responsible).toMatchObject({ username: 'dev_employee_a', assigned: false });
    const result = await json(tD, `/recafco/admin/documents/${id}/responsible/`, 'POST', { user_id: userB });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      uploaded_by: { username: 'dev_employee_a' },
      responsible: { username: 'dev_employee_b', assigned: true },
    });
    expect(dev<Found>('find-label', `RESP-${RUN}`).documents[0].uploader).toBe('dev_employee_a');
    const html = await (await portalGet(`/documents/${id}`, a)).text();
    expect(html).toContain('Originally uploaded by');
    expect(html).toContain('Responsible person');
  });
});
