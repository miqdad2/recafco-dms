import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';

/**
 * Durable server-side session store (SQLite file on the portal server).
 *
 * - The browser only holds an opaque random session ID. The database stores
 *   its SHA-256 hash, so a copy of the file does not contain usable cookies.
 * - The Mayan token is encrypted with AES-256-GCM using PORTAL_SESSION_KEY
 *   (kept outside the database). The token hash is stored separately so all
 *   sessions using one token can be ended together.
 * - Sessions survive a portal restart and are shared by every portal process
 *   on the same server. Idle and absolute expiry are enforced on every read.
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
  /** Internal: hash of the session ID (database key). */
  key?: string;
};

type Row = {
  key: string;
  token_enc: Uint8Array;
  username: string;
  full_name: string;
  can_upload: number;
  is_admin: number;
  created_at: number;
  last_seen_at: number;
};

// Write the idle timestamp at most this often per session.
const TOUCH_WRITE_INTERVAL_MS = 15_000;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const globalStore = globalThis as unknown as { __recafcoSessionDb?: DatabaseSync; __recafcoSweep?: NodeJS.Timeout };

function db(): DatabaseSync {
  if (globalStore.__recafcoSessionDb) return globalStore.__recafcoSessionDb;
  mkdirSync(dirname(config.sessionDbPath), { recursive: true });
  const database = new DatabaseSync(config.sessionDbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      token_enc BLOB NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      can_upload INTEGER NOT NULL,
      is_admin INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_token_hash ON sessions (token_hash);
    CREATE INDEX IF NOT EXISTS sessions_last_seen ON sessions (last_seen_at);
  `);
  globalStore.__recafcoSessionDb = database;
  if (!globalStore.__recafcoSweep) {
    globalStore.__recafcoSweep = setInterval(sweep, 60_000);
    globalStore.__recafcoSweep.unref();
  }
  return database;
}

function encrypt(token: string): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.sessionKey, iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(data: Uint8Array): string | null {
  try {
    const buffer = Buffer.from(data);
    const decipher = createDecipheriv('aes-256-gcm', config.sessionKey, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered row
  }
}

function isExpired(row: { created_at: number; last_seen_at: number }, now: number): boolean {
  return now - row.last_seen_at > config.sessionIdleMs || now - row.created_at > config.sessionAbsoluteMs;
}

export function sweep(): void {
  const now = Date.now();
  db()
    .prepare('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?')
    .run(now - config.sessionIdleMs, now - config.sessionAbsoluteMs);
}

export function createSession(data: Omit<Session, 'createdAt' | 'lastSeenAt' | 'key'>): string {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO sessions (key, token_hash, token_enc, username, full_name, can_upload, is_admin, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(hash(id), hash(data.token), encrypt(data.token), data.username, data.fullName, data.canUpload ? 1 : 0, data.isAdmin ? 1 : 0, now, now);
  return id;
}

/** Returns the live session and refreshes its idle timer, or null. */
export function touchSession(id: string | undefined): Session | null {
  if (!id || id.length > 100) return null;
  const key = hash(id);
  const row = db().prepare('SELECT * FROM sessions WHERE key = ?').get(key) as Row | undefined;
  if (!row) return null;
  const now = Date.now();
  const token = decrypt(row.token_enc);
  if (isExpired(row, now) || token === null) {
    db().prepare('DELETE FROM sessions WHERE key = ?').run(key);
    return null;
  }
  if (now - row.last_seen_at > TOUCH_WRITE_INTERVAL_MS) {
    db().prepare('UPDATE sessions SET last_seen_at = ? WHERE key = ?').run(now, key);
  }
  return {
    key,
    token,
    username: row.username,
    fullName: row.full_name,
    canUpload: row.can_upload === 1,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    lastSeenAt: now,
  };
}

/** Persists the display flags after roles were re-read from Mayan. */
export function updateSessionFlags(session: Session, flags: { canUpload: boolean; isAdmin: boolean }): void {
  session.canUpload = flags.canUpload;
  session.isAdmin = flags.isAdmin;
  if (!session.key) return;
  db()
    .prepare('UPDATE sessions SET can_upload = ?, is_admin = ? WHERE key = ?')
    .run(flags.canUpload ? 1 : 0, flags.isAdmin ? 1 : 0, session.key);
}

export function deleteSession(id: string | undefined): Session | null {
  if (!id || id.length > 100) return null;
  const session = touchSession(id);
  db().prepare('DELETE FROM sessions WHERE key = ?').run(hash(id));
  return session;
}

/** Ends every portal session holding this Mayan token (all processes). */
export function deleteSessionsForToken(token: string): void {
  db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}
