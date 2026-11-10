/**
 * Upload integrity: uploader identity, required metadata, atomic creation,
 * rejected and interrupted uploads, and processing states. "Nothing was
 * created" is checked through an admin-level fixture query (find-label),
 * not through employee permissions, so hidden leftovers would be caught.
 */
import { request } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ApiResult, DEPARTMENTS, MAYAN, RUN, api, binary, dev, extensionUpload, makePdf, sleep,
  tokenFor, waitFor, waitReady, newOperationId } from './helpers';

type Found = {
  count: number;
  documents: { document_type: string; is_stub: boolean; metadata: Record<string, string>; uploader: string | null }[];
};

let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  [tokenA, tokenB] = await Promise.all([tokenFor('a'), tokenFor('b')]);
});

describe('uploader identity and required details', () => {
  it('records the uploader from the token and has all required details from the first moment it is visible', async () => {
    const label = `OWN-A-${RUN}`;
    const created = await extensionUpload(tokenA, {
      file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Bill',
    });
    expect(created.status).toBe(201);
    expect(created.body.uploaded_by.username).toBe('dev_employee_a');

    // Immediately, another employee sees it complete: department, category, file.
    const seenByB = await api(tokenB, `/recafco/documents/${created.body.id}/`);
    expect(seenByB.status).toBe(200);
    expect(seenByB.body).toMatchObject({
      department: DEPARTMENTS.finance, category: 'Bill', access: 'general', is_mine: false,
      uploaded_by: { username: 'dev_employee_a' },
    });
    expect(seenByB.body.file).not.toBeNull();

    const found = dev<Found>('find-label', label);
    expect(found.count).toBe(1);
    expect(found.documents[0]).toMatchObject({
      document_type: 'RECAFCO General', is_stub: false, uploader: 'dev_employee_a',
      metadata: { recafco_department: DEPARTMENTS.finance, recafco_category: 'Bill' },
    });
  });

  it('My uploads lists only the caller’s own uploads', async () => {
    const label = `MINE-B-${RUN}`;
    const created = await extensionUpload(tokenB, {
      file: makePdf(label), label, department: DEPARTMENTS.procurement, category: 'Purchase order',
    });
    expect(created.status).toBe(201);
    const mineB = await api(tokenB, '/recafco/uploads/mine/');
    const mineA = await api(tokenA, '/recafco/uploads/mine/');
    const idsB = mineB.body.results.map((d: { id: number }) => d.id);
    expect(idsB[0]).toBe(created.body.id); // newest first
    expect(mineB.body.results.every((d: { uploaded_by: { username: string } }) => d.uploaded_by.username === 'dev_employee_b')).toBe(true);
    expect(mineA.body.results.map((d: { id: number }) => d.id)).not.toContain(created.body.id);
  });

  it('every document an employee can see has department, category, uploader and a file', async () => {
    const ids: number[] = [];
    let path: string | null = '/documents/?page_size=100';
    while (path) {
      const page: ApiResult = await api(tokenB, path);
      ids.push(...page.body.results.map((d: { id: number }) => d.id));
      path = page.body.next ? new URL(page.body.next).pathname.replace(/^\/api\/v4/, '') + new URL(page.body.next).search : null;
    }
    expect(ids.length).toBeGreaterThan(0);
    for (let i = 0; i < ids.length; i += 50) {
      const query = ids.slice(i, i + 50).map((id) => `id=${id}`).join('&');
      const batch = await api(tokenB, `/recafco/documents/?${query}`);
      for (const document of batch.body.results) {
        expect(document.department, `document ${document.id}`).toBeTruthy();
        expect(document.category, `document ${document.id}`).toBeTruthy();
        expect(document.uploaded_by, `document ${document.id}`).toBeTruthy();
        expect(document.file, `document ${document.id}`).toBeTruthy();
      }
    }
  });
});

describe('rejected uploads leave nothing behind', () => {
  const cases: [string, Parameters<typeof extensionUpload>[1], string][] = [
    ['an unknown category', { category: 'Not a category', department: DEPARTMENTS.finance }, 'category'],
    ['an unknown department', { category: 'Bill', department: 'Not a department' }, 'department'],
    ['a missing department', { category: 'Bill' }, 'department'],
    ['a missing category', { department: DEPARTMENTS.finance }, 'category'],
    ['no file', { category: 'Bill', department: DEPARTMENTS.finance, file: null }, 'file'],
    ['an empty file', { category: 'Bill', department: DEPARTMENTS.finance, file: Buffer.alloc(0) }, 'file'],
    ['two files', { category: 'Bill', department: DEPARTMENTS.finance, secondFile: makePdf('two') }, 'file'],
  ];

  it.each(cases)('rejects %s with a field error', async (_name, fields, field) => {
    const label = `REJ-${field}-${RUN}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await extensionUpload(tokenA, { file: makePdf('x'), ...fields, label });
    expect(result.status).toBe(400);
    expect(Object.keys(result.body)).toContain(field);
    expect(dev<Found>('find-label', label).count).toBe(0);
  });
});

describe('interrupted uploads leave nothing behind', () => {
  it('a connection dropped halfway through the file creates no document', async () => {
    const label = `CUT-${RUN}`;
    const operationId = newOperationId();
    const boundary = `----recafco${RUN}`;
    const head = [
      `--${boundary}`, 'Content-Disposition: form-data; name="operation_id"', '', operationId,
      `--${boundary}`, 'Content-Disposition: form-data; name="label"', '', label,
      `--${boundary}`, 'Content-Disposition: form-data; name="department"', '', DEPARTMENTS.finance,
      `--${boundary}`, 'Content-Disposition: form-data; name="category"', '', 'Invoice',
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="cut.pdf"', 'Content-Type: application/pdf', '', '',
    ].join('\r\n');
    const declaredLength = Buffer.byteLength(head) + 2_000_000;

    await new Promise<void>((resolve) => {
      const url = new URL(`${MAYAN}/recafco/uploads/`);
      const req = request({
        host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: {
          Authorization: `Token ${tokenA}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(declaredLength),
        },
      });
      req.on('error', () => resolve());
      req.on('response', () => resolve());
      req.write(head);
      req.write(Buffer.alloc(500_000, 0x41)); // a quarter of the declared file
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 1500);
    });

    await sleep(5000);
    // Django drops the incomplete file part but keeps the text fields, so the
    // request can reach the upload view as an upload WITHOUT a file. It must
    // then be refused: the operation (if recorded) is failed, never completed.
    const operation = dev<{ count: number; states: string[]; documents: (number | null)[] }>('operation', 'dev_employee_a', operationId);
    expect(operation.states.every((state) => state === 'failed')).toBe(true);
    expect(operation.documents.every((id) => id === null)).toBe(true);
    expect(dev<Found>('find-label', label).count).toBe(0);
  });
});

describe('processing status', () => {
  it('goes from processing to ready, with preview pages', async () => {
    const label = `PROC-${RUN}`;
    const created = await extensionUpload(tokenA, {
      file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Invoice',
    });
    expect(created.status).toBe(201);
    expect(['processing', 'ready']).toContain(created.body.state);
    const ready = await waitReady(tokenA, created.body.id);
    expect(ready.version.page_count).toBe(1);
    const image = await binary(tokenA, `/documents/${ready.id}/versions/${ready.version.id}/pages/${ready.version.page_ids[0]}/image/?width=800`);
    expect(image.status).toBe(200);
  });

  it('reports "no preview" for an unreadable file, which can still be downloaded', async () => {
    const label = `BROKEN-${RUN}`;
    const content = Buffer.from('%PDF-1.4\nthis is not a real pdf\n');
    const created = await extensionUpload(tokenA, {
      file: content, filename: 'broken.pdf', label, department: DEPARTMENTS.finance, category: 'Other',
    });
    expect(created.status).toBe(201);
    const final = await waitFor('broken file processed', async () => {
      const r = await api(tokenA, `/recafco/documents/${created.body.id}/`);
      return r.body.state === 'no_preview' ? r.body : null;
    }, 180_000);
    const download = await binary(tokenA, `/documents/${final.id}/files/${final.file.id}/download/`);
    expect(download.status).toBe(200);
    expect(download.bytes.equals(content)).toBe(true);
  });
});
