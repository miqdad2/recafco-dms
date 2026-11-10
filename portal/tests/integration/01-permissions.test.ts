/**
 * Backend permission model, tested directly against Mayan's REST API with
 * each user's own token: two ordinary employees (A, B), one controller (C),
 * and anonymous requests. These prove the backend enforces access whatever
 * client is used. The portal is not involved.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ApiResult, DENIED, DEPARTMENTS, RUN, api, binary, dev, extensionUpload, isDeniedOrEmpty,
  isListPath, makePdf, searchCount, setupReport, sleep, tokenFor, waitFor, waitReady,
} from './helpers';

type Fixture = { id: number; fileId: number; versionId: number; pageId: number };

let tokenA: string;
let tokenB: string;
let tokenC: string;
let generalA: Fixture; // uploaded by A, Finance
let generalB: Fixture; // uploaded by B, Procurement
let confidential: Fixture; // confidential, created for the controller
let confidentialTypeId: number;
let generalTypeId: number;
let employeesRoleId: number;

const CONF_LABEL = `CONF-${RUN}`;
const CONF_TEXT = `secretword${RUN}`;

async function fixtureFrom(token: string, id: number): Promise<Fixture> {
  const summary = await waitReady(token, id);
  return { id, fileId: summary.file.id, versionId: summary.version.id, pageId: summary.version.page_ids[0] };
}

async function allDocumentIds(token: string | null): Promise<number[]> {
  const ids: number[] = [];
  let path: string | null = '/documents/?page_size=100';
  while (path) {
    const result: ApiResult = await api(token, path);
    if (result.status !== 200) return ids;
    ids.push(...result.body.results.map((d: { id: number }) => d.id));
    path = result.body.next ? new URL(result.body.next).pathname.replace(/^\/api\/v4/, '') + new URL(result.body.next).search : null;
  }
  return ids;
}

const SEARCH_MODELS = [
  'documents.documentsearchresult',
  'documents.documentfilesearchresult',
  'documents.documentfilepagesearchresult',
  'documents.documentversionsearchresult',
  'documents.documentversionpagesearchresult',
  'metadata.documentmetadatasearchresult',
  'cabinets.cabinetsearchresult',
  'document_indexing.indexinstancenodesearchresult',
];

beforeAll(async () => {
  [tokenA, tokenB, tokenC] = await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('c')]);

  const info = dev<{ document_types: Record<string, number>; roles: Record<string, number> }>('info');
  confidentialTypeId = info.document_types['RECAFCO Confidential'];
  generalTypeId = info.document_types['RECAFCO General'];
  employeesRoleId = info.roles['RECAFCO Employees'];

  const a = await extensionUpload(tokenA, {
    file: makePdf(`general alpha ${RUN}`), label: `GEN-A-${RUN}`,
    department: DEPARTMENTS.finance, category: 'Invoice',
  });
  const b = await extensionUpload(tokenB, {
    file: makePdf(`general bravo ${RUN}`), label: `GEN-B-${RUN}`,
    department: DEPARTMENTS.procurement, category: 'Purchase order',
  });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  const conf = dev<{ document_id: number }>('confidential-sample', '--label', CONF_LABEL, '--text', CONF_TEXT);

  generalA = await fixtureFrom(tokenA, a.body.id);
  generalB = await fixtureFrom(tokenB, b.body.id);
  confidential = await fixtureFrom(tokenC, conf.document_id);

  // Positive control: wait until the controller can find the confidential
  // document by label and by text inside the file, so that "employees find
  // nothing" cannot be explained by indexing lag.
  await waitFor('confidential label indexed', async () => {
    const r = await searchCount(tokenC, 'documents.documentsearchresult', CONF_LABEL);
    return r.body?.count >= 1;
  }, 180_000, 3000);
  await waitFor('confidential content indexed', async () => {
    const r = await searchCount(tokenC, 'documents.documentfilepagesearchresult', CONF_TEXT);
    return r.body?.count >= 1;
  }, 240_000, 5000);
});

describe('permission mapping', () => {
  it('is applied idempotently; employees have no global permissions and no ACL on the confidential type', () => {
    const report = setupReport();
    const employees = report.roles['RECAFCO Employees'];
    const controllers = report.roles['RECAFCO Controllers'];
    expect(employees.global_permissions).toEqual([]);
    expect(controllers.global_permissions).toEqual([]);
    expect(Object.keys(employees.document_type_acls)).toEqual(['RECAFCO General']);
    expect(employees.document_type_acls['RECAFCO General']).toEqual([
      'document_downloads.document_file_download',
      'documents.document_file_view',
      'documents.document_version_view',
      'documents.document_view',
      'recafco_dms.portal_document_upload',
    ]);
    expect(Object.keys(controllers.document_type_acls).sort()).toEqual(['RECAFCO Confidential', 'RECAFCO General']);
  });
});

describe('general documents: visible to every employee across departments', () => {
  it.each([
    ['B reads A’s Finance document', () => tokenB, () => generalA],
    ['A reads B’s Procurement document', () => tokenA, () => generalB],
  ])('%s through list, detail, preview, download, versions and search', async (_name, token, doc) => {
    const t = token();
    const d = doc();
    expect(await allDocumentIds(t)).toContain(d.id);
    expect((await api(t, `/documents/${d.id}/`)).status).toBe(200);
    expect((await api(t, `/documents/${d.id}/versions/`)).status).toBe(200);
    const image = await binary(t, `/documents/${d.id}/versions/${d.versionId}/pages/${d.pageId}/image/?width=400`);
    expect(image.status).toBe(200);
    expect(image.type).toMatch(/^image\//);
    const file = await binary(t, `/documents/${d.id}/files/${d.fileId}/download/`);
    expect(file.status).toBe(200);
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const summary = await api(t, `/recafco/documents/${d.id}/`);
    expect(summary.status).toBe(200);
    expect(summary.body.access).toBe('general');
  });

  it('cross-department documents appear in search results', async () => {
    await waitFor('general label indexed', async () => {
      const r = await searchCount(tokenB, 'documents.documentsearchresult', `GEN-A-${RUN}`);
      return r.body?.results?.some((d: { id: number }) => d.id === generalA.id);
    }, 180_000, 3000);
  });

  it('favorites work for general documents', async () => {
    const added = await api(tokenA, '/documents/favorites/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: generalB.id }),
    });
    expect(added.status).toBe(201);
    const list = await api(tokenA, '/documents/favorites/');
    expect(list.body.results.map((f: { document: { id: number } }) => f.document.id)).toContain(generalB.id);
    await api(tokenA, `/documents/favorites/${added.body.id}/`, { method: 'DELETE' });
  });
});

describe('confidential documents: isolated from ordinary employees', () => {
  it('positive control: the controller can use every channel', async () => {
    expect(await allDocumentIds(tokenC)).toContain(confidential.id);
    expect((await api(tokenC, `/documents/${confidential.id}/`)).status).toBe(200);
    expect((await api(tokenC, `/documents/${confidential.id}/versions/`)).status).toBe(200);
    expect((await binary(tokenC, `/documents/${confidential.id}/versions/${confidential.versionId}/pages/${confidential.pageId}/image/?width=400`)).status).toBe(200);
    expect((await binary(tokenC, `/documents/${confidential.id}/files/${confidential.fileId}/download/`)).status).toBe(200);
    const summary = await api(tokenC, `/recafco/documents/${confidential.id}/`);
    expect(summary.body.access).toBe('confidential');
  });

  for (const who of ['A', 'B'] as const) {
    describe(`employee ${who}`, () => {
      const t = () => (who === 'A' ? tokenA : tokenB);

      it('does not see it in the document list', async () => {
        const ids = await allDocumentIds(t());
        expect(ids).toContain(generalA.id); // positive control
        expect(ids).not.toContain(confidential.id);
      });

      it('gets "denied" for detail, files, versions, pages, previews, downloads and metadata', async () => {
        const c = confidential;
        const paths = [
          `/documents/${c.id}/`,
          `/documents/${c.id}/files/`,
          `/documents/${c.id}/files/${c.fileId}/`,
          `/documents/${c.id}/files/${c.fileId}/pages/`,
          `/documents/${c.id}/versions/`,
          `/documents/${c.id}/versions/${c.versionId}/`,
          `/documents/${c.id}/versions/${c.versionId}/pages/`,
          `/documents/${c.id}/versions/${c.versionId}/pages/${c.pageId}/`,
          `/documents/${c.id}/metadata/`,
          `/documents/${c.id}/cabinets/`,
          `/documents/${c.id}/tags/`,
          `/documents/${c.id}/comments/`,
          `/documents/${c.id}/duplicates/`,
          `/objects/documents/document/${c.id}/events/`,
          `/recafco/documents/${c.id}/`,
        ];
        for (const path of paths) {
          const result = await api(t(), path);
          if (isListPath(path)) {
            expect(isDeniedOrEmpty(result), `${path} returned ${result.status} ${JSON.stringify(result.body)}`).toBe(true);
          } else {
            expect(DENIED, `${path} returned ${result.status}`).toContain(result.status);
          }
        }
        for (const path of [
          `/documents/${c.id}/files/${c.fileId}/download/`,
          `/documents/${c.id}/versions/${c.versionId}/pages/${c.pageId}/image/`,
        ]) {
          const result = await binary(t(), path);
          expect(DENIED, `${path} returned ${result.status}`).toContain(result.status);
        }
        const batch = await api(t(), `/recafco/documents/?id=${c.id}&id=${generalA.id}`);
        expect(batch.body.results.map((d: { id: number }) => d.id)).toEqual([generalA.id]);
      });

      it('finds nothing through any search model (label, file name, page text, metadata)', async () => {
        for (const model of SEARCH_MODELS) {
          for (const query of [CONF_LABEL, CONF_TEXT]) {
            const result = await searchCount(t(), model, query);
            if (result.status === 200) {
              expect(result.body.count, `${model} "${query}"`).toBe(0);
            } else {
              expect(DENIED, `${model} returned ${result.status}`).toContain(result.status);
            }
          }
        }
      });

      it('cannot add it to favorites, and it never appears in favorites', async () => {
        const added = await api(t(), '/documents/favorites/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: confidential.id }),
        });
        expect(added.status).toBeGreaterThanOrEqual(400);
        const list = await api(t(), '/documents/favorites/');
        expect(list.body.results.map((f: { document: { id: number } }) => f.document.id)).not.toContain(confidential.id);
      });
    });
  }
});

describe('a document-level ACL cannot narrow access inherited from the document type', () => {
  it('a controllers-only ACL on a general document leaves employee access unchanged', async () => {
    const result = dev<{ document_acl_roles: string[] }>('restrict-acl', String(generalB.id));
    expect(result.document_acl_roles).toEqual(['RECAFCO Controllers']);
    expect((await api(tokenA, `/documents/${generalB.id}/`)).status).toBe(200);
    expect((await binary(tokenA, `/documents/${generalB.id}/files/${generalB.fileId}/download/`)).status).toBe(200);
    // This is why confidentiality is a separate document type, not an ACL.
  });
});

describe('employees cannot change confidentiality or bypass the portal upload through direct API calls', () => {
  it('cannot change the document type', async () => {
    const result = await api(tokenA, `/documents/${generalA.id}/type/change/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_type_id: confidentialTypeId }),
    });
    expect(DENIED).toContain(result.status);
    expect(dev('document-type', String(generalA.id))).toEqual({ document_type: 'RECAFCO General' });
  });

  it('cannot read or edit ACLs on their own document', async () => {
    const base = `/objects/documents/document/${generalA.id}/acls/`;
    expect(DENIED).toContain((await api(tokenA, base)).status);
    const created = await api(tokenA, base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_id: employeesRoleId }),
    });
    expect(DENIED).toContain(created.status);
  });

  it('cannot edit the document, its metadata, or its files, or delete it', async () => {
    const json = { 'Content-Type': 'application/json' };
    const attempts: [string, RequestInit][] = [
      [`/documents/${generalA.id}/`, { method: 'PATCH', headers: json, body: JSON.stringify({ label: 'changed' }) }],
      [`/documents/${generalA.id}/`, { method: 'DELETE' }],
      [`/documents/${generalA.id}/metadata/`, { method: 'GET' }],
      [`/documents/${generalA.id}/metadata/`, { method: 'POST', headers: json, body: JSON.stringify({ metadata_type_id: 1, value: 'x' }) }],
      [`/documents/${generalA.id}/files/`, { method: 'POST', body: (() => { const f = new FormData(); f.append('file_new', new Blob([new Uint8Array(makePdf('x'))]), 'x.pdf'); f.append('action_name', 'replace'); return f; })() }],
      [`/documents/${generalA.id}/versions/${generalA.versionId}/`, { method: 'DELETE' }],
      [`/document_types/${confidentialTypeId}/`, { method: 'GET' }],
    ];
    for (const [path, init] of attempts) {
      const result = await api(tokenA, path, init);
      expect(DENIED, `${init.method} ${path} returned ${result.status}`).toContain(result.status);
    }
    // Administrative lists come back empty (permission-filtered), not denied.
    for (const path of ['/roles/', '/groups/', '/users/', '/document_types/', '/metadata_types/']) {
      const result = await api(tokenA, path);
      expect(isDeniedOrEmpty(result), `${path} returned ${result.status} ${JSON.stringify(result.body).slice(0, 120)}`).toBe(true);
    }
    const after = await api(tokenA, `/recafco/documents/${generalA.id}/`);
    expect(after.body.label).toBe(`GEN-A-${RUN}`);
  });

  it('cannot create documents through Mayan’s own endpoints, in either document type', async () => {
    for (const typeId of [generalTypeId, confidentialTypeId]) {
      const form = new FormData();
      form.append('document_type_id', String(typeId));
      form.append('file', new Blob([new Uint8Array(makePdf('bypass'))]), 'bypass.pdf');
      const upload = await api(tokenA, '/documents/upload/', { method: 'POST', body: form });
      expect(DENIED, `upload type ${typeId}: ${upload.status}`).toContain(upload.status);
      const create = await api(tokenA, '/documents/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_type_id: typeId, label: `bypass-${RUN}` }),
      });
      expect(DENIED, `create type ${typeId}: ${create.status}`).toContain(create.status);
    }
    expect(dev<{ count: number }>('find-label', 'bypass').count).toBe(0);
  });

  it('the portal upload endpoint rejects any attempt to choose type, owner or ACLs', async () => {
    const attempts: Record<string, string>[] = [
      { document_type_id: String(confidentialTypeId) },
      { document_type: 'RECAFCO Confidential' },
      { uploader: 'dev_employee_b' },
      { user_id: '1' },
      { access: 'confidential' },
    ];
    for (const extra of attempts) {
      const result = await extensionUpload(tokenA, {
        file: makePdf('x'), department: DEPARTMENTS.finance, category: 'Bill',
        label: `spoof-${RUN}`, extra,
      });
      expect(result.status, JSON.stringify(extra)).toBe(400);
    }
    expect(dev<{ count: number }>('find-label', `spoof-${RUN}`).count).toBe(0);
  });
});

describe('anonymous requests against populated data', () => {
  it('see no documents and are refused everywhere', async () => {
    // Positive control: data exists.
    expect(await allDocumentIds(tokenC)).toEqual(expect.arrayContaining([generalA.id, confidential.id]));

    const list = await api(null, '/documents/');
    if (list.status === 200) expect(list.body.count).toBe(0);
    else expect(DENIED).toContain(list.status);

    for (const d of [generalA, confidential]) {
      for (const path of [
        `/documents/${d.id}/`,
        `/documents/${d.id}/files/`,
        `/documents/${d.id}/versions/`,
        `/documents/${d.id}/metadata/`,
        `/recafco/documents/${d.id}/`,
      ]) {
        const result = await api(null, path);
        if (isListPath(path)) {
          expect(isDeniedOrEmpty(result), `${path} returned ${result.status}`).toBe(true);
        } else {
          expect(DENIED, `${path} returned ${result.status}`).toContain(result.status);
        }
        await sleep(250); // stay under the anonymous rate limit
      }
      for (const path of [
        `/documents/${d.id}/files/${d.fileId}/download/`,
        `/documents/${d.id}/versions/${d.versionId}/pages/${d.pageId}/image/`,
      ]) {
        const result = await binary(null, path);
        expect(DENIED, `${path} returned ${result.status}`).toContain(result.status);
        await sleep(250);
      }
    }

    for (const model of ['documents.documentsearchresult', 'documents.documentfilepagesearchresult']) {
      for (const query of [`GEN-A-${RUN}`, CONF_TEXT]) {
        const result = await searchCount(null, model, query);
        if (result.status === 200) expect(result.body.count).toBe(0);
        else expect(DENIED).toContain(result.status);
        await sleep(250);
      }
    }

    for (const [path, method] of [
      ['/recafco/me/', 'GET'], ['/recafco/options/', 'GET'], ['/recafco/uploads/mine/', 'GET'],
      ['/recafco/documents/?id=1', 'GET'], ['/recafco/uploads/', 'POST'],
      ['/recafco/auth/token/revoke/', 'POST'],
    ] as const) {
      const result = await api(null, path, { method });
      expect(DENIED, `${method} ${path} returned ${result.status}`).toContain(result.status);
      await sleep(250);
    }

    // Known Mayan core defect: the favorites list crashes (HTTP 500) for an
    // anonymous caller instead of refusing. No data is returned; recorded
    // in docs/unit-1-report.md.
    const favorites = await api(null, '/documents/favorites/');
    expect(favorites.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(favorites.body)).not.toContain(`GEN-A-${RUN}`);
  });
});
