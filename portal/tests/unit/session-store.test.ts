import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60_000;

async function loadStore() {
  vi.resetModules();
  delete (globalThis as { __recafcoSessions?: unknown }).__recafcoSessions;
  delete (globalThis as { __recafcoSweep?: unknown }).__recafcoSweep;
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
});
