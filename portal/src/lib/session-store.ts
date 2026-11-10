import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config';

/**
 * Server-side session store. The browser only ever holds an opaque random
 * session ID; the Mayan token stays here.
 *
 * Unit 1 keeps sessions in process memory: restarting the portal signs
 * everyone out, and it supports exactly one portal process. A shared store
 * (e.g. Redis) is required before running more than one instance.
 * Keys are SHA-256 hashes of the session ID, so a memory dump does not
 * reveal usable cookie values.
 */
export type Session = {
  token: string;
  username: string;
  fullName: string;
  canUpload: boolean;
  /** Shows the Administration link only. Authorization is always checked by
   * the extension on each request, never from this flag. */
  isAdmin: boolean;
  createdAt: number;
  lastSeenAt: number;
};

type Store = Map<string, Session>;

const globalStore = globalThis as unknown as {
  __recafcoSessions?: Store;
  __recafcoSweep?: NodeJS.Timeout;
};
const store: Store = (globalStore.__recafcoSessions ??= new Map());

const hash = (id: string) => createHash('sha256').update(id).digest('hex');

function isExpired(session: Session, now: number): boolean {
  return (
    now - session.lastSeenAt > config.sessionIdleMs ||
    now - session.createdAt > config.sessionAbsoluteMs
  );
}

if (!globalStore.__recafcoSweep) {
  globalStore.__recafcoSweep = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of store) {
      if (isExpired(session, now)) store.delete(key);
    }
  }, 60_000);
  globalStore.__recafcoSweep.unref();
}

export function createSession(
  data: Omit<Session, 'createdAt' | 'lastSeenAt'>,
): string {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  store.set(hash(id), { ...data, createdAt: now, lastSeenAt: now });
  return id;
}

/** Returns the live session and refreshes its idle timer, or null. */
export function touchSession(id: string | undefined): Session | null {
  if (!id || id.length > 100) return null;
  const key = hash(id);
  const session = store.get(key);
  if (!session) return null;
  const now = Date.now();
  if (isExpired(session, now)) {
    store.delete(key);
    return null;
  }
  session.lastSeenAt = now;
  return session;
}

export function deleteSession(id: string | undefined): Session | null {
  if (!id) return null;
  const key = hash(id);
  const session = store.get(key) ?? null;
  store.delete(key);
  return session;
}

/** Ends every portal session holding this Mayan token. */
export function deleteSessionsForToken(token: string): void {
  for (const [key, session] of store) {
    if (session.token === token) store.delete(key);
  }
}
