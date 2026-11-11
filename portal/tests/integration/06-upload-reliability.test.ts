/**
 * Unit 3: upload reliability.
 *
 * - Persistent, user-scoped upload operation IDs: a retry returns the first
 *   result; reuse with different content is refused; concurrent retries
 *   create one document; a dead "pending" attempt can be taken over.
 * - The intermittent "other side closed" write failure (Unit 2 run 1): a
 *   TCP proxy reproduces both conditions that produce that same client
 *   error — the connection dropped BEFORE the server processed the request,
 *   and dropped AFTER the server committed it — and shows that the
 *   operation status resolves both, so no blind retry is needed.
 * - Database records and stored-file cleanup.
 */
import { request } from 'node:http';
import { type AddressInfo, connect, createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEPARTMENTS, MAYAN, PORTAL, RUN, type PortalSession, api, dev, extensionUpload, json, makePdf,
  newOperationId, portalGet, portalLogin, portalUpload, tokenFor, uploadForm, waitFor,
} from './helpers';

type Found = { count: number; documents: { id: number; document_type: string }[] };
const count = (label: string) => dev<Found>('find-label', label).count;
const orphans = () => dev<{ orphans: number }>('orphan-files').orphans;

let tA: string;
let tB: string;
let tD: string;
let a: PortalSession;
let b: PortalSession;

beforeAll(async () => {
  [tA, tB, tD] = await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('d')]);
  a = (await portalLogin('a')).session!;
  b = (await portalLogin('b')).session!;
});

describe('operation IDs make uploads idempotent', () => {
  it('a repeated operation returns the first document instead of a copy', async () => {
    const label = `IDEM-${RUN}`;
    const operationId = newOperationId();
    const file = makePdf(label);
    const before = orphans();
    const first = await extensionUpload(tA, { file, label, department: DEPARTMENTS.finance, category: 'Bill', operationId });
    const second = await extensionUpload(tA, { file, label, department: DEPARTMENTS.finance, category: 'Bill', operationId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, replayed: true, operation_id: operationId });
    expect(count(label)).toBe(1);
    expect(dev<{ count: number; states: string[] }>('operation', 'dev_employee_a', operationId)).toMatchObject({ count: 1, states: ['completed'] });
    expect(orphans()).toBe(before);
  });

  it('refuses the same operation ID with a different file or different details', async () => {
    const label = `IDEMX-${RUN}`;
    const operationId = newOperationId();
    const base = { file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Bill', operationId };
    expect((await extensionUpload(tA, base)).status).toBe(201);
    for (const changed of [
      { file: makePdf(`${label} other bytes`) },
      { label: `${label}-renamed` },
      { department: DEPARTMENTS.procurement },
      { category: 'Invoice' },
      { filename: 'other-name.pdf' },
    ]) {
      const result = await extensionUpload(tA, { ...base, ...changed });
      expect(result.status, JSON.stringify(changed)).toBe(409);
      expect(result.body.code).toBe('operation_conflict');
    }
    expect(count(label)).toBe(1);
  });

  it('concurrent retries of one operation create exactly one document', async () => {
    const label = `IDEMC-${RUN}`;
    const operationId = newOperationId();
    const fields = { file: makePdf(label), label, department: DEPARTMENTS.procurement, category: 'Bill', operationId };
    const results = await Promise.all([1, 2, 3, 4].map(() => extensionUpload(tA, fields)));
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((result) => result.body.id)).size).toBe(1);
    expect(count(label)).toBe(1);
  });

  it('operation IDs are per user: nobody else can see or reuse another user’s result', async () => {
    const label = `IDEMU-${RUN}`;
    const operationId = newOperationId();
    const created = await extensionUpload(tA, { file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Bill', operationId });
    expect(created.status).toBe(201);
    expect((await api(tB, `/recafco/uploads/operations/${operationId}/`)).status).toBe(404);
    // B using the same ID is B's own, separate operation.
    const other = await extensionUpload(tB, { file: makePdf(label), label, department: DEPARTMENTS.finance, category: 'Bill', operationId });
    expect(other.status).toBe(201);
    expect(other.body.id).not.toBe(created.body.id);
    expect(other.body.uploaded_by.username).toBe('dev_employee_b');
  });

  it('a refused upload is final for its ID; a corrected upload uses a new ID', async () => {
    const label = `IDEMF-${RUN}`;
    const operationId = newOperationId();
    const bad = { file: makePdf(label), label, department: `No such ${RUN}`, category: 'Bill', operationId };
    const first = await extensionUpload(tA, bad);
    expect(first.status).toBe(400);
    expect(first.body).toHaveProperty('department');
    const again = await extensionUpload(tA, bad);
    expect(again.status).toBe(400);
    expect(again.body).toHaveProperty('department');
    const status = await api(tA, `/recafco/uploads/operations/${operationId}/`);
    expect(status.body).toMatchObject({ state: 'failed', errors: { department: expect.any(String) } });
    const fixed = await extensionUpload(tA, { ...bad, department: DEPARTMENTS.finance, operationId: newOperationId() });
    expect(fixed.status).toBe(201);
    expect(count(label)).toBe(1);
  });

  it('a dead attempt (worker killed while saving) is reported as not saved and can be taken over', async () => {
    const department = `Late ${RUN}`;
    const label = `IDEMS-${RUN}`;
    const fields = { file: makePdf(label), label, department, category: 'Bill', operationId: newOperationId() };
    // First attempt: the department does not exist yet, nothing is saved.
    expect((await extensionUpload(tA, fields)).status).toBe(400);
    const created = await json(tD, '/recafco/admin/departments/', 'POST', { name: department });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    try {
      // Simulate a request whose worker died mid-way: "pending" for 20 minutes.
      dev('operation-make-stale', 'dev_employee_a', fields.operationId);
      expect((await api(tA, `/recafco/uploads/operations/${fields.operationId}/`)).body.state).toBe('failed');
      // The retry takes over the dead attempt instead of waiting for it.
      const retry = await extensionUpload(tA, fields);
      expect(retry.status).toBe(201);
      expect(count(label)).toBe(1);
      expect(dev<{ states: string[] }>('operation', 'dev_employee_a', fields.operationId).states).toEqual(['completed']);
    } finally {
      await json(tD, `/recafco/admin/departments/${created.body.id}/`, 'PATCH', { is_active: false });
    }
  });

  it('the upload endpoint requires an operation ID', async () => {
    const result = await extensionUpload(tA, { file: makePdf('x'), label: `NOOP-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId: null });
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('operation_id');
    expect(count(`NOOP-${RUN}`)).toBe(0);
  });
});

describe('stored files are cleaned up', () => {
  it('a failure after the file reached storage leaves no document and no file', () => {
    const before = orphans();
    const result = dev<Record<string, unknown>>('upload-fail-after-store', '--label', `FAILSTORE-${RUN}`);
    expect(result).toEqual({
      documents_with_label: 0,
      failure_raised: true,
      file_was_stored: true,
      file_exists_after_rollback: false,
      operation_state: 'failed',
    });
    expect(orphans()).toBe(before);
  });

  it('no stored file is left without a document record', () => {
    expect(orphans()).toBe(0);
  });
});

// ------------------------------------------------------------------ the failure condition

type Mode = 'drop-before-processing' | 'drop-after-commit';

/** A TCP proxy in front of Mayan that cuts the client connection on purpose. */
function startCuttingProxy(mode: Mode): Promise<Server> {
  const target = new URL(MAYAN);
  // Requests seen by this proxy (all connections). The first one (a warm-up
  // GET) always goes through; the client usually reuses that kept-alive
  // connection for the upload, as in the observed failure, but undici may
  // open a new one, so the count is per proxy, not per connection.
  let requests = 0;
  const server = createServer((client: Socket) => {
    const upstream = connect(Number(target.port), target.hostname);
    let cut = false;
    const cutClient = () => {
      if (cut) return;
      cut = true;
      // Close without a reply, as a dropped keep-alive socket or a lost
      // network path does. The client sees "other side closed".
      client.destroy();
    };
    client.on('data', (chunk) => {
      if (/^(GET|POST|PATCH|PUT|DELETE|HEAD) /.test(chunk.subarray(0, 8).toString('latin1'))) requests += 1;
      if (mode === 'drop-before-processing' && requests > 1) {
        // The second request never reaches the server.
        upstream.destroy();
        cutClient();
      } else {
        upstream.write(chunk);
      }
    });
    upstream.on('data', (chunk) => {
      if (mode === 'drop-after-commit' && requests > 1) {
        // The server already committed the upload and started replying:
        // the reply is lost.
        cutClient();
        upstream.destroy();
        return;
      }
      client.write(chunk);
    });
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function uploadThrough(server: Server, token: string, fields: Parameters<typeof uploadForm>[0]) {
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/api/v4/recafco/uploads/`;
  // A first request on the connection, which is then kept alive for the upload.
  const warm = await fetch(`http://127.0.0.1:${port}/api/v4/recafco/me/`, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  });
  await warm.text();
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: uploadForm(fields),
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    });
    return { error: null, status: response.status };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { error: `${cause?.code ?? ''} ${cause?.message ?? String(error)}`.trim(), status: 0 };
  }
}

describe('a dropped connection on a write (the Unit 2 intermittent failure)', () => {
  const proxies: Server[] = [];
  afterAll(() => proxies.forEach((proxy) => proxy.close()));

  it('looks the same to the client whether or not the upload was saved; the operation status tells them apart', async () => {
    const before = await startCuttingProxy('drop-before-processing');
    const after = await startCuttingProxy('drop-after-commit');
    proxies.push(before, after);

    const notSaved = { file: makePdf('n'), label: `DROPB-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId: newOperationId() };
    const saved = { file: makePdf('s'), label: `DROPA-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId: newOperationId() };

    const r1 = await uploadThrough(before, tA, notSaved);
    const r2 = await uploadThrough(after, tA, saved);
    // Same symptom: no HTTP status, a closed connection.
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(r1.error).toBeTruthy();
    expect(r2.error).toBeTruthy();
    console.info(`dropped before processing: ${r1.error}; dropped after commit: ${r2.error}`);

    // ...but different truths, which the operation status reports.
    expect(count(notSaved.label)).toBe(0);
    expect(count(saved.label)).toBe(1);
    expect((await api(tA, `/recafco/uploads/operations/${notSaved.operationId}/`)).body.state).toBe('not_found');
    const status = await api(tA, `/recafco/uploads/operations/${saved.operationId}/`);
    expect(status.body.state).toBe('completed');

    // Retrying each with its SAME ID is safe in both cases: exactly one document each.
    const retry1 = await extensionUpload(tA, notSaved);
    const retry2 = await extensionUpload(tA, saved);
    expect(retry1.status).toBe(201);
    expect(retry2.status).toBe(200);
    expect(retry2.body.id).toBe(status.body.document.id);
    expect(count(notSaved.label)).toBe(1);
    expect(count(saved.label)).toBe(1);
  });

});

// ------------------------------------------------------------------ through the portal

describe('upload recovery through the portal', () => {
  it('a retried portal upload with the same ID returns the first document', async () => {
    const operationId = newOperationId();
    const fields = { file: makePdf('portal'), label: `PIDEM-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId };
    const first = await portalUpload(a, fields);
    const second = await portalUpload(a, fields);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);
    expect(count(fields.label)).toBe(1);
  });

  it('the portal refuses an upload without an operation ID', async () => {
    const response = await portalUpload(a, { file: makePdf('x'), label: `PNOOP-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId: null });
    expect(response.status).toBe(400);
  });

  /** Sends a whole upload to the portal; `dropWhen` decides when the browser side disconnects. */
  async function portalUploadThenDrop(fields: Parameters<typeof uploadForm>[0], dropWhen: () => Promise<void>) {
    const response = new Response(uploadForm(fields));
    const contentType = response.headers.get('content-type')!;
    const body = Buffer.from(await response.arrayBuffer());
    const url = new URL(`${PORTAL}/api/upload`);
    const req = request({
      host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        Cookie: a.cookie, Origin: PORTAL, 'Content-Type': contentType,
        'Content-Length': String(body.length), 'X-Upload-Operation': String(fields.operationId),
      },
    });
    req.on('error', () => undefined);
    req.on('response', () => undefined); // the reply is never read
    req.end(body);
    await dropWhen();
    req.destroy();
  }

  const portalStatus = async (operationId: string, session = a) =>
    (await (await portalGet(`/api/upload/operations/${operationId}`, session)).json()) as {
      state: string;
      document?: { id: number; accessible: boolean; label: string };
    };

  it('reply lost after the upload was saved: the status check finds it and a retry makes no copy', async () => {
    const operationId = newOperationId();
    const fields = { file: makePdf('lost'), label: `PLOST-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId };
    let saved: { id: number } | undefined;
    await portalUploadThenDrop(fields, async () => {
      const status = await waitFor('the upload is saved', async () => {
        const result = await portalStatus(operationId);
        return result.state === 'completed' ? result : null;
      }, 60_000, 500);
      saved = status.document;
    });
    expect(saved).toMatchObject({ accessible: true, label: fields.label });
    // Another user asking about this operation learns nothing.
    expect((await portalStatus(operationId, b)).state).toBe('not_found');
    const retry = await portalUpload(a, fields);
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(saved!.id);
    expect(count(fields.label)).toBe(1);
  });

  it('browser disconnects right after sending: the outcome is reported truthfully and a retry yields exactly one document', async () => {
    const operationId = newOperationId();
    const fields = { file: makePdf('early'), label: `PEARLY-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill', operationId };
    await portalUploadThenDrop(fields, async () => undefined);
    // The portal stops forwarding a cancelled upload, so usually nothing is
    // saved; if Mayan got the whole body first, it is saved. Either way the
    // status must settle and agree with the database.
    const settled = await waitFor('the outcome is known', async () => {
      const result = await portalStatus(operationId);
      return result.state === 'pending' ? null : result;
    }, 60_000, 500);
    expect(['completed', 'not_found', 'failed']).toContain(settled.state);
    expect(count(fields.label)).toBe(settled.state === 'completed' ? 1 : 0);
    console.info(`browser disconnected right after sending: ${settled.state}`);
    const retry = await portalUpload(a, fields);
    if (settled.state === 'failed') {
      expect(retry.status).toBe(400); // a failed operation is final; the browser starts a new one
    } else {
      expect([200, 201]).toContain(retry.status);
      expect(count(fields.label)).toBe(1);
    }
  });

  it('an operation that never arrived is reported as not saved', async () => {
    const response = await portalGet(`/api/upload/operations/${newOperationId()}`, a);
    expect(await response.json()).toMatchObject({ state: 'not_found' });
    expect((await portalGet(`/api/upload/operations/${newOperationId()}`, null)).status).toBe(401);
  });
});

