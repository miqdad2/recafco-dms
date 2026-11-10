import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60_000;
const KEY = randomBytes(32).toString('hex');
let dbFile = '';

type Globals = { __recafcoSessionDb?: { close(): void }; __recafcoSweep?: NodeJS.Timeout };

/**
 * Loads a fresh copy of the store module, as a newly started portal process
 * would. With `keepFile`, it reuses the previous database file (a restart).
 */
async function loadStore({ keepFile = false, key = KEY } = {}) {
  vi.resetModules();
  const globals = globalThis as Globals;
  globals.__recafcoSessionDb?.close();
  delete globals.__recafcoSessionDb;
  if (globals.__recafcoSweep) clearInterval(globals.__recafcoSweep);
  delete globals.__recafcoSweep;
  if (!keepFile) dbFile = path.join(mkdtempSync(path.join(tmpdir(), 'recafco-sessions-')), 'sessions.sqlite');
  process.env.PORTAL_SESSION_DB = dbFile;
  process.env.PORTAL_SESSION_KEY = key;
  process.env.PORTAL_SESSION_IDLE_MINUTES = '30';
  process.env.PORTAL_SESSION_ABSOLUTE_HOURS = '8';
  return import('@/lib/session-store');
}

const sample = { token: 'mayan-token', username: 'u', fullName: 'U', canUpload: true, isAdmin: false };

describe('server-side session store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('issues opaque random IDs that do not contain the Mayan token', async () => {
    const store = await loadStore();
    const a = store.createSession(sample);
    const b = store.createSession(sample);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain(sample.token);
  });

  it('expires after 30 minutes without activity', async () => {
    const store = await loadStore();
    const id = store.createSession(sample);
    vi.advanceTimersByTime(29 * MINUTE);
    expect(store.touchSession(id)).not.toBeNull();
    vi.advanceTimersByTime(31 * MINUTE);
    expect(store.touchSession(id)).toBeNull();
    // Once expired it stays gone.
    expect(store.touchSession(id)).toBeNull();
  });

  it('expires after 8 hours even with continuous activity', async () => {
    const store = await loadStore();
    const id = store.createSession(sample);
    for (let elapsed = 0; elapsed < 7 * 60 + 50; elapsed += 20) {
      vi.advanceTimersByTime(20 * MINUTE);
      expect(store.touchSession(id)).not.toBeNull();
    }
    vi.advanceTimersByTime(20 * MINUTE);
    expect(store.touchSession(id)).toBeNull();
  });

  it('rejects unknown, missing and oversized IDs', async () => {
    const store = await loadStore();
    expect(store.touchSession(undefined)).toBeNull();
    expect(store.touchSession('not-a-session')).toBeNull();
    expect(store.touchSession('x'.repeat(500))).toBeNull();
  });

  it('logout removes every session that shares the same Mayan token', async () => {
    const store = await loadStore();
    const phone = store.createSession(sample);
    const desktop = store.createSession(sample);
    const other = store.createSession({ ...sample, token: 'other-token' });
    store.deleteSessionsForToken(sample.token);
    expect(store.touchSession(phone)).toBeNull();
    expect(store.touchSession(desktop)).toBeNull();
    expect(store.touchSession(other)).not.toBeNull();
  });

  it('survives a portal restart (new process, same database file)', async () => {
    const before = await loadStore();
    const id = before.createSession(sample);
    const after = await loadStore({ keepFile: true });
    expect(after.touchSession(id)).toMatchObject({ token: sample.token, username: 'u' });
  });

  it('stores neither the session ID nor the Mayan token in readable form', async () => {
    const store = await loadStore();
    const token = 'plain-token-' + randomBytes(8).toString('hex');
    const id = store.createSession({ ...sample, token });
    const globals = globalThis as Globals;
    globals.__recafcoSessionDb?.close();
    delete globals.__recafcoSessionDb;
    const raw = readFileSync(dbFile).toString('latin1');
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(id);
  });

  it('refuses sessions when the encryption key changes', async () => {
    const before = await loadStore();
    const id = before.createSession(sample);
    const after = await loadStore({ keepFile: true, key: randomBytes(32).toString('hex') });
    expect(after.touchSession(id)).toBeNull();
  });

  it('persists role flags refreshed during a session', async () => {
    const store = await loadStore();
    const id = store.createSession(sample);
    store.updateSessionFlags(store.touchSession(id)!, { canUpload: false, isAdmin: true });
    const restarted = await loadStore({ keepFile: true });
    expect(restarted.touchSession(id)).toMatchObject({ canUpload: false, isAdmin: true });
  });

  it('logout deletes the session for every process', async () => {
    const first = await loadStore();
    const id = first.createSession(sample);
    first.deleteSession(id);
    const second = await loadStore({ keepFile: true });
    expect(second.touchSession(id)).toBeNull();
  });
});
