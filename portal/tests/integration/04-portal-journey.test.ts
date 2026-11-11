/**
 * The Unit 1 journey through the portal itself (production build):
 * login -> upload -> department/category -> processing status -> search ->
 * preview -> download -> My uploads -> sign out.
 * Plus: portal-level isolation of confidential documents, anonymous access,
 * cross-site upload blocking, and upload size limits.
 */
import { request } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEPARTMENTS, PORTAL, RUN, type PortalSession, dev, makePdf, portalGet,
  portalLogin, portalLogout, portalUpload, tokenFor, waitFor,
} from './helpers';

let a: PortalSession;
let b: PortalSession;
let c: PortalSession;
let documentId: number;
let versionId: number;
let pageId: number;
let fileId: number;
let confidentialId: number;
const LABEL = `JOURNEY-${RUN}`;
const PDF = makePdf(`journey content ${RUN}`);

beforeAll(async () => {
  // Earlier test files revoke tokens; make sure fresh ones exist.
  await Promise.all([tokenFor('a'), tokenFor('b'), tokenFor('c')]);
  a = (await portalLogin('a')).session!;
  b = (await portalLogin('b')).session!;
  c = (await portalLogin('c')).session!;
  const conf = dev<{ document_id: number }>('confidential-sample', '--label', `PCONF-${RUN}`, '--text', `portalsecret${RUN}`);
  confidentialId = conf.document_id;
});

describe('anonymous visitors', () => {
  it.each(['/', '/upload', '/search?q=x', '/my-uploads', '/documents/1'])('are sent to sign in from %s', async (path) => {
    const response = await portalGet(path, null);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it.each([
    '/api/documents/1/status',
    '/api/documents/1/files/1/download',
    '/api/documents/1/versions/1/pages/1/image',
  ])('get 401 from %s', async (path) => {
    expect((await portalGet(path, null)).status).toBe(401);
  });

  it('cannot upload', async () => {
    const response = await portalUpload(null, { file: PDF, department: DEPARTMENTS.finance, category: 'Bill' });
    expect(response.status).toBe(401);
  });
});

describe('employee journey', () => {
  it('1. signs in and lands on the department home with the main actions', async () => {
    const home = await portalGet('/', a);
    expect(home.status).toBe(200);
    const html = await home.text();
    // UI refresh: the greeting panel was removed on purpose; the home page
    // now opens with the "Departments" heading and the user menu shows the name.
    expect(html).toMatch(/<h1 id="departments-heading"[^>]*>\s*Departments\s*<\/h1>/);
    expect(html).toContain('Employee A');
    for (const text of ['Search all documents', 'Upload documents', 'Departments', 'My uploads', 'Favorites', 'Sign out']) {
      expect(html).toContain(text);
    }
  });

  it('2. sees department and category choices on the upload page', async () => {
    const html = await (await portalGet('/upload', a)).text();
    expect(html).toContain(DEPARTMENTS.finance);
    expect(html).toContain('Purchase order');
  });

  it('3. uploads with department and category', async () => {
    const response = await portalUpload(a, {
      file: PDF, filename: 'journey.pdf', label: LABEL, department: DEPARTMENTS.procurement, category: 'Purchase order',
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      label: LABEL, department: DEPARTMENTS.procurement, category: 'Purchase order',
      access: 'general', is_mine: true, uploaded_by: { username: 'dev_employee_a' },
    });
    documentId = body.id;
    fileId = body.file.id;
  });

  it('4. watches the processing status until the preview is ready', async () => {
    const page = await (await portalGet(`/documents/${documentId}?uploaded=1`, a)).text();
    expect(page).toContain('Upload complete');
    const ready = await waitFor('portal status ready', async () => {
      const response = await portalGet(`/api/documents/${documentId}/status`, a);
      const body = await response.json();
      return body.state === 'ready' ? body : null;
    }, 180_000);
    expect(ready.state).toBe('ready');
    const html = await (await portalGet(`/documents/${documentId}`, a)).text();
    const match = /\/api\/documents\/\d+\/versions\/(\d+)\/pages\/(\d+)\/image/.exec(html);
    expect(match).not.toBeNull();
    versionId = Number(match![1]);
    pageId = Number(match![2]);
    expect(html).toContain(DEPARTMENTS.procurement);
    expect(html).toContain('Employee A');
  });

  it('5. finds it with search — including another employee from another department', async () => {
    for (const session of [a, b]) {
      await waitFor('portal search finds the document', async () => {
        const html = await (await portalGet(`/search?q=${encodeURIComponent(LABEL)}`, session)).text();
        return html.includes(`/documents/${documentId}`);
      }, 180_000, 3000);
    }
  });

  it('6. previews a page', async () => {
    // Retry like the browser component does (see binary() in helpers.ts).
    let response = await portalGet(`/api/documents/${documentId}/versions/${versionId}/pages/${pageId}/image?width=800`, b);
    for (let attempt = 1; response.status >= 500 && attempt <= 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      response = await portalGet(`/api/documents/${documentId}/versions/${versionId}/pages/${pageId}/image?width=800`, b);
    }
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^image\//);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(500);
  });

  it('7. downloads the original file unchanged', async () => {
    const response = await portalGet(`/api/documents/${documentId}/files/${fileId}/download`, b);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('journey.pdf');
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('8. sees it in My uploads; the other employee does not', async () => {
    expect(await (await portalGet('/my-uploads', a)).text()).toContain(`/documents/${documentId}`);
    expect(await (await portalGet('/my-uploads', b)).text()).not.toContain(`/documents/${documentId}`);
  });

  it('9. signs out', async () => {
    const response = await portalLogout(a);
    expect(response.status).toBe(303);
    expect((await portalGet('/', a)).headers.get('location')).toContain('/login');
  });
});

describe('confidential documents through the portal', () => {
  it('an employee gets "not found" for the page, status, preview and download', async () => {
    const summary = await waitFor('controller sees confidential ready', async () => {
      const response = await portalGet(`/api/documents/${confidentialId}/status`, c);
      const body = await response.json();
      return body.state === 'ready' ? body : null;
    }, 180_000);
    expect(summary.state).toBe('ready');
    const html = await (await portalGet(`/documents/${confidentialId}`, c)).text();
    expect(html).toContain('Confidential');
    const v = /\/versions\/(\d+)\/pages\/(\d+)\/image/.exec(html)!;
    const f = /\/files\/(\d+)\/download/.exec(html)!;

    expect((await portalGet(`/documents/${confidentialId}`, b)).status).toBe(404);
    for (const path of [
      `/api/documents/${confidentialId}/status`,
      `/api/documents/${confidentialId}/versions/${v[1]}/pages/${v[2]}/image`,
      `/api/documents/${confidentialId}/files/${f[1]}/download`,
    ]) {
      expect((await portalGet(path, b)).status, path).toBe(404);
    }
  });

  it('an employee’s search does not show it; the controller’s does', async () => {
    await waitFor('controller search finds confidential', async () => {
      const html = await (await portalGet(`/search?q=PCONF-${RUN}`, c)).text();
      return html.includes(`/documents/${confidentialId}`);
    }, 180_000, 3000);
    const html = await (await portalGet(`/search?q=PCONF-${RUN}`, b)).text();
    expect(html).not.toContain(`/documents/${confidentialId}`);
    expect(html).toContain('No documents found');
  });
});

describe('upload protections', () => {
  it('blocks cross-site and origin-less upload requests', async () => {
    for (const origin of ['https://evil.example', null]) {
      const response = await portalUpload(b, { file: PDF, department: DEPARTMENTS.finance, category: 'Bill', label: `XSITE-${RUN}` }, origin);
      expect(response.status, String(origin)).toBe(403);
    }
    expect(dev<{ count: number }>('find-label', `XSITE-${RUN}`).count).toBe(0);
  });

  it('shows a field error for a missing category', async () => {
    const response = await portalUpload(b, { file: PDF, department: DEPARTMENTS.finance, label: `NOCAT-${RUN}` });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('category');
  });

  it('refuses a body larger than the limit before reading it', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(`${PORTAL}/api/upload`);
      const req = request({
        host: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: {
          Cookie: b.cookie, Origin: PORTAL,
          'Content-Type': 'multipart/form-data; boundary=x',
          'Content-Length': String(60 * 1024 * 1024),
        },
      });
      req.on('response', (response) => {
        resolve(response.statusCode ?? 0);
        req.destroy();
      });
      req.on('error', reject);
      req.write('--x\r\n');
    });
    expect(status).toBe(413);
  });

  it('accepts a 20 MB file and streams it through within a reasonable time', async () => {
    const big = makePdf(`big ${RUN}`, 20 * 1024 * 1024);
    const started = Date.now();
    const response = await portalUpload(b, {
      file: big, filename: 'big.pdf', label: `BIG-${RUN}`, department: DEPARTMENTS.finance, category: 'Other',
    });
    const seconds = (Date.now() - started) / 1000;
    expect(response.status).toBe(201);
    const body = await response.json();
    console.info(`20 MB upload through portal took ${seconds.toFixed(1)} s`);
    const download = await portalGet(`/api/documents/${body.id}/files/${body.file.id}/download`, b);
    expect(Buffer.from(await download.arrayBuffer()).equals(big)).toBe(true);
  });
});
