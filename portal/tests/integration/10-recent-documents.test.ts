/**
 * UI refresh: the home page "Recently uploaded" list comes from
 * GET /api/v4/recafco/documents/recent/. It must apply Mayan's ACLs (no
 * confidential documents for non-members), stay small (capped page size,
 * no archive count) and require sign-in.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DENIED, DEPARTMENTS, RUN, api, dev, extensionUpload, makePdf, portalGet, portalLogin, tokenFor, type PortalSession } from './helpers';

const CONF_LABEL = `RECENT-CONF-${RUN}`;
const GENERAL_LABEL = `RECENT-GEN-${RUN}`;
let tokenA = '';
let tokenC = '';
let confidentialId = 0;
let generalId = 0;

beforeAll(async () => {
  tokenA = await tokenFor('a');
  tokenC = await tokenFor('c');
  const general = await extensionUpload(tokenA, {
    file: makePdf(`recent ${RUN}`), label: GENERAL_LABEL, department: DEPARTMENTS.finance, category: 'Bill',
  });
  expect(general.status).toBe(201);
  generalId = general.body.id;
  confidentialId = dev<{ document_id: number }>('confidential-sample', '--label', CONF_LABEL, '--text', `recent conf ${RUN}`).document_id;
});

describe('recently uploaded documents (all departments)', () => {
  it('requires sign-in', async () => {
    expect(DENIED).toContain((await api(null, '/recafco/documents/recent/')).status);
  });

  it('lists the newest documents the caller can open, newest first, without confidential ones for non-members', async () => {
    const forA = await api(tokenA, '/recafco/documents/recent/?page_size=20');
    expect(forA.status).toBe(200);
    const ids = (forA.body.results as { id: number }[]).map((document) => document.id);
    expect(ids).toContain(generalId);
    expect(ids).not.toContain(confidentialId);
    const dates = (forA.body.results as { datetime_created: string }[]).map((document) => Date.parse(document.datetime_created));
    expect([...dates].sort((x, y) => y - x)).toEqual(dates);
    expect(forA.body).not.toHaveProperty('count');

    // A member of the confidential group sees it.
    const forC = await api(tokenC, '/recafco/documents/recent/?page_size=20');
    expect((forC.body.results as { id: number }[]).map((document) => document.id)).toContain(confidentialId);
  });

  it('caps the page size and paginates', async () => {
    const big = await api(tokenA, '/recafco/documents/recent/?page_size=500');
    expect(big.status).toBe(200);
    expect(big.body.page_size).toBe(20);
    expect(big.body.results.length).toBeLessThanOrEqual(20);
    const first = await api(tokenA, '/recafco/documents/recent/?page_size=2');
    const second = await api(tokenA, '/recafco/documents/recent/?page_size=2&page=2');
    expect(first.body.has_more).toBe(true);
    const firstIds = first.body.results.map((document: { id: number }) => document.id);
    for (const document of second.body.results) expect(firstIds).not.toContain(document.id);
    expect((await api(tokenA, '/recafco/documents/recent/?page_size=x')).status).toBe(400);
  });

  it('the portal home shows the list without confidential documents for non-members', async () => {
    const { session } = await portalLogin('a');
    const html = await (await portalGet('/', session as PortalSession)).text();
    expect(html).toContain('id="recent-heading"');
    expect(html).toContain(GENERAL_LABEL);
    expect(html).not.toContain(CONF_LABEL);
  });
});
