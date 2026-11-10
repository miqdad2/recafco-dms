/**
 * Authentication lifecycle: disabled users, removed permissions, token
 * revocation, portal session cookie, and logout. Every test restores the
 * user it changes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  DENIED, DEPARTMENTS, RUN, api, dev, extensionUpload, makePdf, obtainToken,
  portalGet, portalLogin, portalLogout, tokenFor,
} from './helpers';

afterAll(() => {
  // Safety net: leave every dev user active and in its normal group.
  dev('users');
});

describe('Mayan token behaviour', () => {
  it('the revoke endpoint invalidates the token; signing in again issues a new one', async () => {
    const before = await tokenFor('c');
    expect((await api(before, '/recafco/me/')).status).toBe(200);
    const revoked = await api(before, '/recafco/auth/token/revoke/', { method: 'POST' });
    expect(revoked.status).toBe(204);
    expect(DENIED).toContain((await api(before, '/recafco/me/')).status);
    expect(DENIED).toContain((await api(before, '/documents/')).status);
    const after = await tokenFor('c');
    expect(after).not.toBe(before);
    expect((await api(after, '/recafco/me/')).status).toBe(200);
  });
});

describe('disabled users lose access', () => {
  it('a disabled employee’s existing token and portal session stop working, and they cannot sign in', async () => {
    const token = await tokenFor('b');
    const { session } = await portalLogin('b');
    expect(session).not.toBeNull();
    expect((await portalGet('/', session)).status).toBe(200);

    dev('disable', 'dev_employee_b');
    try {
      expect(DENIED).toContain((await api(token, '/recafco/me/')).status);
      expect(DENIED).toContain((await api(token, '/documents/')).status);
      expect((await obtainToken('b')).status).toBe(400);

      // The portal discovers the dead token on the next request and ends the session.
      const page = await portalGet('/my-uploads', session);
      expect(page.status).toBe(307);
      expect(page.headers.get('location')).toContain('/login');
      const again = await portalGet('/', session);
      expect(again.headers.get('location')).toContain('/login');

      const retry = await portalLogin('b');
      expect(retry.session).toBeNull();
      expect(await retry.response.text()).toContain('Username or password is not correct.');
    } finally {
      dev('enable', 'dev_employee_b');
    }
    expect((await obtainToken('b')).status).toBe(200);
  });
});

describe('removed permissions take effect immediately', () => {
  it('an employee removed from the Employees group loses general documents and upload rights', async () => {
    const token = await tokenFor('b');
    const own = await extensionUpload(token, {
      file: makePdf(`perm ${RUN}`), label: `PERM-B-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill',
    });
    expect(own.status).toBe(201);

    dev('group-remove', 'dev_employee_b', 'RECAFCO Employees');
    try {
      const list = await api(token, '/documents/');
      expect(list.status).toBe(200);
      expect(list.body.count).toBe(0);
      expect(DENIED).toContain((await api(token, `/documents/${own.body.id}/`)).status);
      expect(DENIED).toContain((await api(token, `/recafco/documents/${own.body.id}/`)).status);
      expect((await api(token, '/recafco/uploads/mine/')).body.results).toEqual([]);
      expect((await api(token, '/recafco/me/')).body.can_upload).toBe(false);
      const upload = await extensionUpload(token, {
        file: makePdf('x'), label: `PERM-DENIED-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill',
      });
      expect(upload.status).toBe(403);
      expect(dev<{ count: number }>('find-label', `PERM-DENIED-${RUN}`).count).toBe(0);
    } finally {
      dev('group-add', 'dev_employee_b', 'RECAFCO Employees');
    }
    expect((await api(token, `/documents/${own.body.id}/`)).status).toBe(200);
  });
});

describe('portal session', () => {
  it('uses an opaque, HttpOnly, SameSite=Lax, Secure cookie that is not the Mayan token', async () => {
    const token = await tokenFor('a');
    const { response, session } = await portalLogin('a');
    expect(response.status).toBe(303);
    expect(session).not.toBeNull();
    const cookie = session!.setCookie;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
    const value = session!.cookie.split('=')[1];
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain(token);
    expect(cookie).not.toContain(token);
  });

  it('rejects a wrong password with a plain message and no cookie', async () => {
    const { session, response } = await portalLogin('a', 'wrong-password');
    expect(session).toBeNull();
    expect(await response.text()).toContain('Username or password is not correct.');
  });

  it('rejects made-up session cookies', async () => {
    const forged = { cookie: 'recafco_portal_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', setCookie: '' };
    const page = await portalGet('/', forged);
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/login');
  });

  it('sign out ends the session and revokes the Mayan token (on every device)', async () => {
    const desktop = (await portalLogin('a')).session!;
    const phone = (await portalLogin('a')).session!;
    const token = await tokenFor('a'); // same per-user token the portal holds
    expect((await portalGet('/', phone)).status).toBe(200);

    const out = await portalLogout(desktop);
    expect(out.status).toBe(303);
    expect(out.headers.get('location')).toContain('/login?signedout=1');
    expect(out.headers.get('set-cookie')).toMatch(/recafco_portal_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);

    // Reusing the old cookie no longer works.
    expect((await portalGet('/', desktop)).headers.get('location')).toContain('/login');
    // Mayan token is revoked, so the other device is signed out as well.
    expect(DENIED).toContain((await api(token, '/recafco/me/')).status);
    expect((await portalGet('/my-uploads', phone)).headers.get('location')).toContain('/login');
  });
});
