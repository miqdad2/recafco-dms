/**
 * Performance changes (docs/performance-report.md):
 * - recafco/search/ replaces "Mayan search API + recafco/documents/?id=…".
 *   It must return the same documents, count and pages, in title order, and
 *   keep confidential documents away from people outside their group,
 *   including words that occur only inside the file.
 * - Document lists compute page facts for the whole list at once. Every
 *   list must report the same pages and state as the single-document view.
 *
 * The portal shows no text excerpts in search results; the tests check that
 * search responses carry no file text at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEPARTMENTS, RUN, api, dev, extensionUpload, makePdf, portalGet, portalLogin,
  type PortalSession, tokenFor, waitFor,
} from './helpers';

const WORD = `${RUN}srch`; // in every title of this file's documents
const BODY = `${RUN}body`; // only inside the files of the general documents
const SECRET = `${RUN}secret`; // only inside the confidential file
const GENERAL_COUNT = 23; // more than two pages of 10
const tokens: Record<'a' | 'c' | 'd', string> = { a: '', c: '', d: '' };
const generalIds: number[] = [];
let confidentialId = 0;

type Summary = { id: number; label: string; access: string; state: string; version: { id: number; page_count: number; page_ids: number[] } | null };
type Page = { count: number; page: number; page_size: number; results: Summary[] };

/** Every document of the old path: Mayan search pages, then summaries. */
async function oldPath(token: string, q: string) {
  const ids: number[] = [];
  let count = 0;
  for (let page = 1; ; page += 1) {
    const result = await api(token, `/search/documents.documentsearchresult/?q=${encodeURIComponent(q)}&page=${page}&page_size=20`);
    expect(result.status).toBe(200);
    count = result.body.count;
    ids.push(...result.body.results.map((r: { id: number }) => r.id));
    if (!result.body.next) break;
  }
  const summaries: Summary[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const query = ids.slice(i, i + 50).map((id) => `id=${id}`).join('&');
    summaries.push(...(await api(token, `/recafco/documents/?${query}`)).body.results);
  }
  return { count, summaries };
}

/** Every document of the new endpoint, page by page. */
async function newPath(token: string, q: string, pageSize = 20) {
  const pages: Page[] = [];
  for (let page = 1; ; page += 1) {
    const result = await api<Page>(token, `/recafco/search/?q=${encodeURIComponent(q)}&page=${page}&page_size=${pageSize}`);
    expect(result.status).toBe(200);
    pages.push(result.body);
    if (page * pageSize >= result.body.count) break;
  }
  return { count: pages[0].count, pages, summaries: pages.flatMap((p) => p.results) };
}

const byTitle = (a: Summary, b: Summary) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id - b.id);
const comparable = ({ version, ...rest }: Summary) => ({ ...rest, version });

beforeAll(async () => {
  tokens.a = await tokenFor('a');
  tokens.c = await tokenFor('c');
  tokens.d = await tokenFor('d');
  for (let i = 0; i < GENERAL_COUNT; i += 1) {
    // Titles sort by number; two share a title to check the tie-break.
    const n = String(i === 5 ? 4 : i).padStart(2, '0');
    const result = await extensionUpload(tokens.a, {
      file: makePdf(`${BODY} page text ${i}`),
      filename: `search-${i}.pdf`,
      department: DEPARTMENTS.finance,
      category: 'Bill',
      label: `${WORD} ${n}`,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    generalIds.push(result.body.id);
  }
  confidentialId = dev<{ document_id: number }>(
    'confidential-sample', '--label', `${WORD} conf`, '--text', `${SECRET} only here`,
  ).document_id;

  // Indexing and text extraction run in Mayan's background workers.
  await waitFor('titles indexed', async () => (await newPath(tokens.d, WORD)).count === GENERAL_COUNT + 1, 600_000, 5000);
  await waitFor('file text indexed', async () => (await newPath(tokens.d, BODY)).count === GENERAL_COUNT, 600_000, 5000);
  await waitFor('confidential text indexed', async () => (await newPath(tokens.d, SECRET)).count === 1, 600_000, 5000);
});

describe('search endpoint matches the previous two-call search', () => {
  for (const [user, expected] of [['a', GENERAL_COUNT], ['c', GENERAL_COUNT + 1], ['d', GENERAL_COUNT + 1]] as const) {
    it(`same documents, count and summaries for ${user}`, async () => {
      const before = await oldPath(tokens[user], WORD);
      const after = await newPath(tokens[user], WORD);
      expect(after.count).toBe(before.count);
      expect(after.count).toBe(expected);
      expect(after.summaries.map(comparable)).toEqual([...before.summaries].sort(byTitle).map(comparable));
    });
  }

  it('orders by title, ties by ID, across pages', async () => {
    const { summaries } = await newPath(tokens.a, WORD, 10);
    expect(summaries.map((s) => s.id)).toEqual([...summaries].sort(byTitle).map((s) => s.id));
    const tied = summaries.filter((s) => s.label === `${WORD} 04`).map((s) => s.id);
    expect(tied).toHaveLength(2);
    expect(tied).toEqual([...tied].sort((x, y) => x - y));
  });
});

describe('pagination', () => {
  it('pages of 10 cover every result once', async () => {
    const { count, pages } = await newPath(tokens.a, WORD, 10);
    expect(pages.map((p) => p.results.length)).toEqual([10, 10, 3]);
    expect(pages.map((p) => [p.page, p.page_size, p.count])).toEqual([[1, 10, count], [2, 10, count], [3, 10, count]]);
    const ids = pages.flatMap((p) => p.results.map((r) => r.id));
    expect(new Set(ids).size).toBe(count);
    expect([...ids].sort()).toEqual([...generalIds].sort());
  });

  it('a page past the last page is refused, as Mayan refuses it', async () => {
    expect((await api(tokens.a, `/recafco/search/?q=${WORD}&page=4&page_size=10`)).status).toBe(404);
    expect((await api(tokens.a, `/search/documents.documentsearchresult/?q=${WORD}&page=4&page_size=10`)).status).toBe(404);
  });

  it('no matches: page 1 is empty with count 0', async () => {
    const result = await api<Page>(tokens.a, `/recafco/search/?q=${RUN}nomatch`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ count: 0, page: 1, results: [] });
  });

  it('page size is capped at 50 and an empty query finds nothing', async () => {
    expect((await api<Page>(tokens.a, `/recafco/search/?q=${WORD}&page_size=500`)).body.page_size).toBe(50);
    expect((await api<Page>(tokens.a, '/recafco/search/?q=')).body).toMatchObject({ count: 0, results: [] });
  });

  it('refuses anonymous requests', async () => {
    expect([401, 403]).toContain((await api(null, `/recafco/search/?q=${WORD}`)).status);
  });
});

describe('confidential isolation', () => {
  it('words only inside a confidential file find nothing for other employees', async () => {
    const result = await api<Page>(tokens.a, `/recafco/search/?q=${SECRET}`);
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(0);
    expect(result.body.results).toEqual([]);
  });

  it('the confidential title is neither listed nor counted for other employees', async () => {
    const { count, summaries } = await newPath(tokens.a, WORD);
    expect(count).toBe(GENERAL_COUNT);
    expect(summaries.map((s) => s.id)).not.toContain(confidentialId);
    expect(summaries.every((s) => s.access === 'general')).toBe(true);
  });

  it('members of the confidential group find it, by title and by file text', async () => {
    const secret = await api<Page>(tokens.c, `/recafco/search/?q=${SECRET}`);
    expect(secret.body.count).toBe(1);
    expect(secret.body.results[0]).toMatchObject({ id: confidentialId, access: 'confidential' });
  });

  it('file text matches general documents, and results carry no file text', async () => {
    const result = await api<Page>(tokens.a, `/recafco/search/?q=${BODY}&page_size=50`);
    expect(result.body.count).toBe(GENERAL_COUNT);
    const raw = JSON.stringify(result.body);
    expect(raw).not.toContain('page text');
    expect(raw).not.toContain(SECRET);
    expect(Object.keys(result.body.results[0]).sort()).toEqual(Object.keys((await api(tokens.a, `/recafco/documents/?id=${generalIds[0]}`)).body.results[0]).sort());
  });
});

describe('portal search page', () => {
  let a: PortalSession;
  let c: PortalSession;
  beforeAll(async () => {
    a = (await portalLogin('a')).session!;
    c = (await portalLogin('c')).session!;
  });
  afterAll(() => undefined);

  it('shows the same count and never the confidential title to employees', async () => {
    const pageA = await (await portalGet(`/search?q=${WORD}`, a)).text();
    expect(pageA).toContain(`${GENERAL_COUNT} documents`);
    expect(pageA).not.toContain(`${WORD} conf`);
    const pageC = await (await portalGet(`/search?q=${WORD}`, c)).text();
    expect(pageC).toContain(`${GENERAL_COUNT + 1} documents`);
    // "… conf" sorts after "… 22": the 24th result, on page 2.
    expect(pageC).not.toContain(`${WORD} conf`);
    const pageC2 = await (await portalGet(`/search?q=${WORD}&page=2`, c)).text();
    expect(pageC2).toContain(`${WORD} conf`);
    const pageA2 = await (await portalGet(`/search?q=${WORD}&page=2`, a)).text();
    expect(pageA2).not.toContain(`${WORD} conf`);
  });

  it('"Show more results" pages through the results', async () => {
    const first = await (await portalGet(`/search?q=${WORD}`, a)).text();
    expect(first).toContain(`/search?q=${WORD}&amp;page=2`);
    const second = await (await portalGet(`/search?q=${WORD}&page=2`, a)).text();
    expect(second).toContain(`${WORD} 22`);
    expect(second).not.toContain('Something went wrong');
  });
});

describe('document lists report the same page facts as the document view', () => {
  async function expectSameAsDetail(token: string, summaries: Summary[]) {
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      const detail = (await api(token, `/recafco/documents/${summary.id}/`)).body;
      expect({ id: summary.id, state: summary.state, version: summary.version }).toEqual({ id: detail.id, state: detail.state, version: detail.version });
    }
  }

  it('department list', async () => {
    const departments = (await api(tokens.a, '/recafco/departments/')).body.departments;
    const finance = departments.find((d: { name: string }) => d.name === DEPARTMENTS.finance);
    const list = (await api(tokens.a, `/recafco/departments/${finance.id}/documents/?q=${WORD}&page_size=50`)).body;
    expect(list.count).toBe(GENERAL_COUNT);
    await expectSameAsDetail(tokens.a, list.results);
  });

  it('search results, my uploads, favorites and the admin list', async () => {
    await expectSameAsDetail(tokens.a, (await newPath(tokens.a, WORD)).summaries.slice(0, 5));
    const mine = (await api(tokens.a, '/recafco/uploads/mine/?limit=50')).body.results as Summary[];
    await expectSameAsDetail(tokens.a, mine.filter((s) => generalIds.includes(s.id)).slice(0, 5));
    expect((await api(tokens.a, `/recafco/documents/${generalIds[1]}/favorite/`, { method: 'POST' })).status).toBe(200);
    const favorites = (await api(tokens.a, '/recafco/favorites/')).body.results as Summary[];
    await expectSameAsDetail(tokens.a, favorites.filter((s) => s.id === generalIds[1]));
    const admin = (await api(tokens.d, `/recafco/admin/documents/?q=${WORD}`)).body.results as Summary[];
    expect(admin.length).toBe(GENERAL_COUNT + 1);
    await expectSameAsDetail(tokens.d, admin.slice(0, 5));
  });
});
