/**
 * Unit 3: durable server-side sessions.
 *
 * A second, independent portal process (port 3108) uses the same session
 * database as the test portal (port 3107). A session created by one must
 * work in the other — exactly what happens after a portal restart — and
 * sign-out, account deactivation and permission revocation must still take
 * effect immediately everywhere.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DENIED, PORTAL, type PortalSession, api, dev, portalLogin, portalLogout, sleep, tokenFor } from './helpers';

const SECOND = 'http://127.0.0.1:3108';
const portalRoot = path.resolve(__dirname, '..', '..');
let second: ChildProcess | null = null;

function startSecondPortal(): Promise<void> {
  second = spawn(
    process.execPath,
    [path.join(portalRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', '3108', '-H', '127.0.0.1'],
    { cwd: portalRoot, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } },
  );
  return (async () => {
    const started = Date.now();
    for (;;) {
      try {
        if ((await fetch(`${SECOND}/login`)).status < 500) return;
      } catch {
        /* starting */
      }
      if (Date.now() - started > 60_000) throw new Error('Second portal did not start.');
      await sleep(500);
    }
  })();
}

async function stopSecondPortal() {
  if (!second) return;
  const exited = new Promise((resolve) => second!.once('exit', resolve));
  second.kill(); // this process only, by its own handle
  await exited;
  second = null;
}

const get = (base: string, pathname: string, session: PortalSession) =>
  fetch(`${base}${pathname}`, { headers: { Cookie: session.cookie }, redirect: 'manual' });

beforeAll(async () => {
  await Promise.all([tokenFor('a'), tokenFor('b')]);
  await startSecondPortal();
}, 120_000);

afterAll(async () => {
  await stopSecondPortal();
  dev('enable', 'dev_employee_b');
});

describe('durable sessions', () => {
  it('a session from one portal process works in another, and after that process restarts', async () => {
    const { session } = await portalLogin('a');
    expect((await get(SECOND, '/', session!)).status).toBe(200);
    await stopSecondPortal();
    await startSecondPortal();
    expect((await get(SECOND, '/', session!)).status).toBe(200);
    expect((await get(PORTAL, '/', session!)).status).toBe(200);
  }, 120_000);

  it('signing out in one process ends the session in every process', async () => {
    const { session } = await portalLogin('a');
    expect((await get(SECOND, '/', session!)).status).toBe(200);
    expect((await portalLogout(session!)).status).toBe(303);
    for (const base of [PORTAL, SECOND]) {
      const response = await get(base, '/', session!);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/login');
    }
  });

  it('deactivating an account still ends its sessions at once, in every process', async () => {
    const { session } = await portalLogin('b');
    expect((await get(SECOND, '/', session!)).status).toBe(200);
    dev('disable', 'dev_employee_b');
    try {
      for (const base of [SECOND, PORTAL]) {
        const response = await get(base, '/', session!);
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toContain('/login');
      }
    } finally {
      dev('enable', 'dev_employee_b');
    }
  });

  it('revoked permissions apply at once to an existing durable session', async () => {
    const { session } = await portalLogin('b');
    dev('group-remove', 'dev_employee_b', 'RECAFCO Employees');
    try {
      const html = await (await get(SECOND, '/my-uploads', session!)).text();
      expect(html).toContain('You have not uploaded any documents yet');
      const token = await tokenFor('b');
      expect((await api(token, '/recafco/me/')).body.can_upload).toBe(false);
      expect(DENIED).not.toContain((await get(SECOND, '/', session!)).status);
    } finally {
      dev('group-add', 'dev_employee_b', 'RECAFCO Employees');
    }
  });
});
