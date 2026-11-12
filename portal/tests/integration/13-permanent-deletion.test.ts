/**
 * Permanent deletion (recycle bin → delete permanently):
 * - nothing of the document stays reachable: records, file downloads and
 *   page previews, through Mayan and through the portal;
 * - nothing stays searchable: not through the portal's search, Mayan's
 *   search API, or the search index itself;
 * - Mayan does not keep retrying search-index work for the deleted objects
 *   (docs/performance-report.md: ~39 index tasks per deleted document,
 *   each retried up to 40 times), while an object that is merely missing
 *   (not recorded as deleted) is still retried as before.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DENIED, DEPARTMENTS, RUN, api, binary, dev, extensionUpload, json, makePdf, portalGet, portalLogin,
  type PortalSession, tokenFor, waitFor, waitReady,
} from './helpers';

const TITLE = `${RUN}gone`;
const BODY = `${RUN}gonebody`;
let tA = '';
let tD = '';
let a: PortalSession;
let id = 0;
let fileId = 0;
let versionId = 0;
let pageId = 0;
let keptId = 0;
const paths = () => ({
  download: `/documents/${id}/files/${fileId}/download/`,
  page: `/documents/${id}/versions/${versionId}/pages/${pageId}/image/`,
  portalDownload: `/api/documents/${id}/files/${fileId}/download`,
  portalPage: `/api/documents/${id}/versions/${versionId}/pages/${pageId}/image?width=800`,
});

const bulk = (token: string, body: Record<string, unknown>) => json(token, '/recafco/admin/documents/bulk/', 'POST', body);
const searchCount = async (token: string, q: string) => (await api(token, `/recafco/search/?q=${encodeURIComponent(q)}`)).body.count as number;
const rawIndex = (q: string) => dev<{ ids: number[] }>('search-raw', q).ids;

type Check = { state: string; error: string | null; tombstone: boolean; wrapped: boolean };

beforeAll(async () => {
  tA = await tokenFor('a');
  tD = await tokenFor('d');
  a = (await portalLogin('a')).session!;
  const created = await extensionUpload(tA, {
    file: makePdf(`${BODY} inside the file`), filename: 'gone.pdf',
    department: DEPARTMENTS.finance, category: 'Bill', label: `${TITLE} report`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  id = created.body.id;
  const kept = await extensionUpload(tA, {
    file: makePdf(`${RUN} kept`), filename: 'kept.pdf',
    department: DEPARTMENTS.finance, category: 'Bill', label: `${RUN}kept`,
  });
  expect(kept.status).toBe(201);
  keptId = kept.body.id;
  const ready = await waitReady(tA, id);
  fileId = ready.file.id;
  versionId = ready.version.id;
  pageId = ready.version.page_ids[0];
  await waitFor('title and file text searchable', async () => (await searchCount(tD, TITLE)) === 1 && (await searchCount(tD, BODY)) === 1, 600_000, 5000);

  // Positive controls: everything is reachable before the deletion.
  const p = paths();
  expect((await binary(tA, p.download)).status).toBe(200);
  expect((await binary(tA, p.page)).status).toBe(200);
  expect((await portalGet(p.portalDownload, a)).status).toBe(200);
  expect(rawIndex(BODY)).toContain(id);

  expect((await bulk(tD, { action: 'trash', ids: [id] })).body.succeeded).toBe(1);
  expect((await bulk(tD, { action: 'purge', ids: [id], reason: 'deletion test' })).body).toMatchObject({ succeeded: 1, failed: 0 });
}, 900_000);

describe('after permanent deletion', () => {
  it('no record, file or preview is reachable, through Mayan or the portal', async () => {
    const p = paths();
    for (const token of [tA, tD]) {
      expect((await api(token, `/recafco/documents/${id}/`)).status).toBe(404);
      expect(DENIED).toContain((await api(token, `/documents/${id}/`)).status);
      expect(DENIED).toContain((await binary(token, p.download)).status);
      expect(DENIED).toContain((await binary(token, p.page)).status);
    }
    expect((await portalGet(p.portalDownload, a)).status).toBe(404);
    expect((await portalGet(p.portalPage, a)).status).toBe(404);
    expect((await portalGet(`/documents/${id}`, a)).status).toBe(404);
    expect((await api(tD, `/recafco/admin/documents/${id}/`)).status).toBe(404);
    expect((await api(tD, `/recafco/admin/documents/?status=trash&q=${TITLE}`)).body.count).toBe(0);
  });

  it('nothing is searchable, including the search index itself', async () => {
    // The index entry is removed by a background task.
    await waitFor('index entry removed', async () => !rawIndex(BODY).includes(id) && !rawIndex(TITLE).includes(id), 300_000, 5000);
    for (const token of [tA, tD]) {
      expect(await searchCount(token, TITLE)).toBe(0);
      expect(await searchCount(token, BODY)).toBe(0);
      expect((await api(token, `/search/documents.documentsearchresult/?q=${BODY}`)).body.count).toBe(0);
    }
  });

  it('index work for the deleted objects ends without retries; other missing objects are still retried', () => {
    for (const [app, model, objectId] of [
      ['documents', 'document', id], ['documents', 'documentfile', fileId],
      ['documents', 'documentversion', versionId], ['documents', 'documentversionpage', pageId],
    ] as const) {
      const check = dev<Check>('index-task-check', app, model, String(objectId));
      expect(check, `${model} ${objectId}`).toMatchObject({ state: 'SUCCESS', error: null, tombstone: true, wrapped: true });
    }
    // Never existed and never recorded as deleted: Mayan's retries are kept
    // (it could be an object whose transaction has not committed yet).
    const missing = dev<Check>('index-task-check', 'documents', 'document', '2000000000');
    expect(missing).toMatchObject({ state: 'RETRY', error: 'DoesNotExist', tombstone: false, wrapped: true });
    // An existing document is indexed as before.
    expect(dev<Check>('index-task-check', 'documents', 'document', String(keptId))).toMatchObject({ state: 'SUCCESS', error: null, tombstone: false });
  });

  it('no index task for the deleted objects stays queued or held for retries', async () => {
    const targets = [
      `documents.document:${id}`, `documents.documentfile:${fileId}`,
      `documents.documentversion:${versionId}`, `documents.documentversionpage:${pageId}`,
    ];
    // Before the fix these tasks stayed held for retries for ~35 minutes.
    await waitFor('index tasks for the deleted objects finished', async () =>
      dev<{ count: number }>('index-tasks-for', ...targets).count === 0, 300_000, 5000);
  });
});
