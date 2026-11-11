/**
 * Unit 4: local username/password accounts.
 *
 * - Administrators create accounts with a unique username (case-insensitive,
 *   numeric employee IDs allowed) and a simple temporary password.
 * - A temporary password must be replaced first: until then only the
 *   password change and sign-out work, in the portal AND on direct Mayan
 *   access (API token, HTTP Basic, Mayan web session).
 * - Personal passwords: at least 6 characters, no character types.
 * - Changing one's own password needs the current one; an administrator
 *   reset revokes every existing session and token.
 * - Sign-in lockout is per username, so one user's lockout does not block
 *   others signing in from the same IP address.
 * - Passwords are hashed by Django and never returned or logged.
 */
import { describe, expect, it } from 'vitest';
import {
  DENIED, DEPARTMENTS, MAYAN, MAYAN_WEB, RUN, api, basicApi, dev, extensionUpload, json, makePdf, mayanWebGet,
  mayanWebLogin, portalAction, portalGet, portalLoginAs, portalLogout, tokenFor, users, type PortalSession,
} from './helpers';

type Created = { id: number; username: string };
let tAdmin = '';
const admin = async () => (tAdmin ||= await tokenFor('d'));

/** Sign-in request without the helpers' automatic retry on HTTP 429 (the limits are what is tested). */
async function signIn(username: string, password: string) {
  const response = await fetch(`${MAYAN}/recafco/auth/login/`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function createUser(username: string, password: string, extra: Record<string, unknown> = {}): Promise<Created> {
  const result = await json(await admin(), '/recafco/admin/users/', 'POST', { username, password, ...extra });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body;
}

/** A user who has already replaced the temporary password. */
async function activeUser(prefix: string, personal: string): Promise<Created> {
  const user = await createUser(`${prefix}_${RUN}`, '123');
  const token = (await signIn(user.username, '123')).body.token;
  const changed = await json(token, '/recafco/auth/password/', 'POST', { current_password: '123', new_password: personal });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  return user;
}

function changeInPortal(session: PortalSession, current: string, next: string, again = next) {
  return portalAction(session, '/change-password', 'id="current_password"', {
    current_password: current,
    new_password: next,
    new_password_again: again,
  });
}

describe('account creation by an administrator', () => {
  it('needs only a username and a temporary password such as "123"; stores the username in lower case', async () => {
    const created = await createUser(`New.Hire_${RUN}`, '123');
    expect(created.username).toBe(`new.hire_${RUN}`.toLowerCase());
    expect(created).toMatchObject({ must_change_password: true, is_active: true, email: '' });
    expect(created).not.toHaveProperty('password');
    const info = dev<{ algorithm: string; must_change: boolean; reason: string }>('password-info', created.username);
    expect(info.algorithm).toMatch(/^(pbkdf2_sha256|argon2|bcrypt_sha256|scrypt)$/);
    expect(info).toMatchObject({ must_change: true, reason: 'created' });
  });

  it('accepts numeric employee IDs and enforces unique usernames regardless of case', async () => {
    const employeeId = `9${Date.now().toString().slice(-8)}`;
    await createUser(employeeId, '1');
    expect((await json(await admin(), '/recafco/admin/users/', 'POST', { username: employeeId, password: '123' })).status).toBe(400);
    const named = await createUser(`Case_${RUN}`, '123');
    for (const variant of [`CASE_${RUN}`, `case_${RUN}`.toUpperCase(), ` case_${RUN} `]) {
      const again = await json(await admin(), '/recafco/admin/users/', 'POST', { username: variant, password: '123' });
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toContain('already used');
    }
    expect(named.username).toBe(`case_${RUN}`.toLowerCase());
  });

  it('refuses an empty temporary password, an empty username and usernames with spaces', async () => {
    const tA = await admin();
    expect((await json(tA, '/recafco/admin/users/', 'POST', { username: `empty_${RUN}`, password: '' })).status).toBe(400);
    expect((await json(tA, '/recafco/admin/users/', 'POST', { username: '', password: '123' })).status).toBe(400);
    expect((await json(tA, '/recafco/admin/users/', 'POST', { username: `two words ${RUN}`, password: '123' })).status).toBe(400);
  });

  it('never returns or records the password: not in responses, the user record or the activity log', async () => {
    const secret = `Tmp${RUN}Zq`;
    const created = await createUser(`plain_${RUN}`, secret);
    const detail = await api(await admin(), `/recafco/admin/users/${created.id}/`);
    const audit = await api(await admin(), '/recafco/admin/audit/');
    const reset = await json(await admin(), `/recafco/admin/users/${created.id}/password/`, 'POST', { password: `${secret}2` });
    expect(reset.status).toBe(204);
    const auditAfter = await api(await admin(), '/recafco/admin/audit/');
    for (const text of [JSON.stringify(created), JSON.stringify(detail.body), JSON.stringify(audit.body), JSON.stringify(auditAfter.body)]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.stringify(auditAfter.body)).toContain('user.password_reset');
  });
});

describe('first sign-in with a temporary password', () => {
  it('signs in ignoring case, but every Mayan request except password change and sign-out is refused', async () => {
    const user = await createUser(`First_${RUN}`, '123');
    const login = await signIn(user.username.toUpperCase(), '123');
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ must_change_password: true, username: user.username });
    expect(login.body).not.toHaveProperty('can_upload');
    const token = login.body.token as string;

    for (const path of ['/recafco/me/', '/documents/', '/recafco/departments/', '/recafco/uploads/mine/', '/users/current/', '/search/documents.documentsearchresult/?q=a']) {
      const result = await api(token, path);
      expect(result.status, path).toBe(403);
      expect(result.body.code, path).toBe('password_change_required');
    }
    const upload = await extensionUpload(token, {
      file: makePdf('x'), label: `PENDING-${RUN}`, department: DEPARTMENTS.finance, category: 'Bill',
    });
    expect(upload.status).toBe(403);
    expect(dev<{ count: number }>('find-label', `PENDING-${RUN}`).count).toBe(0);

    // Mayan's own token endpoint issues a token, but it is just as restricted.
    const obtained = await api(null, '/auth/token/obtain/', { method: 'POST', body: new URLSearchParams({ username: user.username, password: '123' }) });
    expect(obtained.status).toBe(200);
    expect((await api(obtained.body.token, '/documents/')).body.code).toBe('password_change_required');

    // HTTP Basic: refused with the right password; a wrong one reveals nothing.
    const basic = await basicApi(user.username, '123', '/documents/');
    expect(basic.status).toBe(403);
    expect(basic.body.code).toBe('password_change_required');
    const wrong = await basicApi(user.username, '124', '/documents/');
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain('password_change_required');

    // Signing out (token revocation) stays possible.
    expect((await api(token, '/recafco/auth/token/revoke/', { method: 'POST' })).status).toBe(204);
  });

  it('Mayan’s own web interface allows only sign-out until the password is changed', async () => {
    const user = await createUser(`Web_${RUN}`, '123');
    const web = await mayanWebLogin(user.username, '123');
    expect(web).not.toBeNull();
    for (const path of ['/', '/documents/documents/', '/authentication/password/change/']) {
      const page = await mayanWebGet(path, web!);
      expect(page.status, path).toBe(403);
      expect(await page.text()).toContain('temporary password');
    }
    const out = await fetch(`${MAYAN_WEB}/authentication/logout/`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: web!.cookie, 'X-CSRFToken': web!.csrf, Referer: `${MAYAN_WEB}/` },
    });
    expect(out.status).not.toBe(403);
  });

  it('the portal shows only the change-password page and sign-out', async () => {
    const user = await createUser(`Portal_${RUN}`, '123');
    const { response, session } = await portalLoginAs(user.username.toUpperCase(), '123');
    expect(session).not.toBeNull();
    expect(response.headers.get('location')).toContain('/change-password');

    for (const path of ['/', '/my-uploads', '/upload', '/favorites', '/admin', `/departments/1`, '/search?q=a']) {
      const page = await portalGet(path, session);
      expect(page.status, path).toBe(307);
      expect(page.headers.get('location'), path).toContain('/change-password');
    }
    const status = await portalGet('/api/documents/1/status', session);
    expect(status.status).toBe(403);

    const page = await portalGet('/change-password', session);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Choose your password');
    expect(html).toContain('Show<span class="sr-only"> password</span>');
    expect(html).not.toContain('My uploads');

    const out = await portalLogout(session!);
    expect(out.headers.get('location')).toContain('/login?signedout=1');
    expect((await portalGet('/change-password', session)).headers.get('location')).toContain('/login');
  });
});

describe('choosing a personal password', () => {
  it('needs at least 6 characters (no character types), the correct temporary password, and matching entries', async () => {
    const user = await createUser(`Choose_${RUN}`, '123');
    const { session } = await portalLoginAs(user.username, '123');

    const short = await (await changeInPortal(session!, '123', '12345')).text();
    expect(short).toContain('Use at least 6 characters.');
    const mismatch = await (await changeInPortal(session!, '123', 'abcdef', 'abcdeg')).text();
    expect(mismatch).toContain('The two new passwords are not the same.');
    const wrongCurrent = await (await changeInPortal(session!, '999', 'abcdef')).text();
    expect(wrongCurrent).toContain('The temporary password is not correct.');
    expect(dev<{ must_change: boolean }>('password-info', user.username).must_change).toBe(true);

    // A second device signed in with the temporary password before the change.
    const other = (await portalLoginAs(user.username, '123')).session!;
    const apiToken = (await signIn(user.username, '123')).body.token as string;

    const done = await changeInPortal(session!, '123', '123456');
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toContain('/?welcome=1');
    const home = await portalGet('/?welcome=1', session);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Your password is saved.');

    expect(dev<{ must_change: boolean }>('password-info', user.username).must_change).toBe(false);
    expect((await portalGet('/', other)).headers.get('location')).toContain('/login');
    expect(DENIED).toContain((await api(apiToken, '/recafco/me/')).status);
    expect((await signIn(user.username, '123')).status).toBe(400);
    const again = await signIn(user.username, '123456');
    expect(again.body.must_change_password).toBe(false);
    expect((await api(again.body.token, '/recafco/me/')).status).toBe(200);
  });

  it('a new password must differ from the current one', async () => {
    const user = await createUser(`Same_${RUN}`, 'sixsix');
    const token = (await signIn(user.username, 'sixsix')).body.token;
    const same = await json(token, '/recafco/auth/password/', 'POST', { current_password: 'sixsix', new_password: 'sixsix' });
    expect(same.status).toBe(400);
    expect(JSON.stringify(same.body)).toContain('different');
  });

  it('a signed-in person changes their own password with the current one; other devices are signed out', async () => {
    const user = await activeUser('Self', 'first1');
    const { session } = await portalLoginAs(user.username, 'first1');
    const other = (await portalLoginAs(user.username, 'first1')).session!;
    expect((await portalGet('/change-password', session)).status).toBe(200);

    const wrong = await (await changeInPortal(session!, 'nope99', 'second2')).text();
    expect(wrong).toContain('Your current password is not correct.');
    const ok = await changeInPortal(session!, 'first1', 'second2');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Your password has been changed.');
    expect((await portalGet('/', session)).status).toBe(200);
    expect((await portalGet('/', other)).headers.get('location')).toContain('/login');
    expect((await signIn(user.username, 'second2')).status).toBe(200);
  });

  it('Mayan’s own self-service changes are refused for RECAFCO accounts (they bypass the current password and username rules)', async () => {
    const user = await activeUser('Bypass', 'bypass1');
    const token = (await signIn(user.username, 'bypass1')).body.token;
    expect((await api(token, '/users/current/')).status).toBe(200);
    for (const [method, body] of [['PATCH', { password: 'Qz8-vLm2-pXw7' }], ['PATCH', { username: `Bypass_${RUN}` }], ['PUT', { username: 'x', password: 'Qz8-vLm2-pXw7' }], ['DELETE', undefined]] as const) {
      const result = await json(token, '/users/current/', method, body);
      expect(result.status, method).toBe(403);
      expect(result.body.code).toBe('managed_by_portal');
    }
    expect((await signIn(user.username, 'bypass1')).status).toBe(200);
    const web = await mayanWebLogin(user.username, 'bypass1');
    expect(web).not.toBeNull();
    expect((await mayanWebGet('/authentication/password/change/', web!)).status).toBe(403);
  });
});

describe('administrator password reset', () => {
  it('revokes the portal session, the API token and the Mayan web session, and requires a new password again', async () => {
    const user = await activeUser('Reset', 'mine123');
    const { session } = await portalLoginAs(user.username, 'mine123');
    expect((await portalGet('/', session)).status).toBe(200);
    const token = (await signIn(user.username, 'mine123')).body.token as string;
    const web = await mayanWebLogin(user.username, 'mine123');
    expect((await mayanWebGet('/', web!)).status).toBe(200);
    expect(dev<{ count: number }>('sessions', user.username).count).toBeGreaterThan(0);

    const reset = await json(await admin(), `/recafco/admin/users/${user.id}/password/`, 'POST', { password: '123' });
    expect(reset.status).toBe(204);

    expect((await portalGet('/', session)).headers.get('location')).toContain('/login');
    expect(DENIED).toContain((await api(token, '/recafco/me/')).status);
    const webAfter = await mayanWebGet('/', web!);
    expect(webAfter.status).toBe(302);
    expect(webAfter.headers.get('location')).toContain('/authentication/login/');
    expect((await signIn(user.username, 'mine123')).status).toBe(400);
    const again = await signIn(user.username, '123');
    expect(again.body.must_change_password).toBe(true);
    expect((await api(again.body.token, '/documents/')).body.code).toBe('password_change_required');
    expect((await api(await admin(), `/recafco/admin/users/${user.id}/`)).body.must_change_password).toBe(true);
  });

  it('an administrator cannot reset their own password there, and employees cannot reset anyone’s', async () => {
    const me = (await json(await admin(), '/recafco/admin/users/?q=dev_admin')).body.results[0];
    const self = await json(await admin(), `/recafco/admin/users/${me.id}/password/`, 'POST', { password: '123' });
    expect(self.status).toBe(400);
    const employee = await tokenFor('a');
    expect((await json(employee, `/recafco/admin/users/${me.id}/password/`, 'POST', { password: '123' })).status).toBe(403);
    expect((await signIn('dev_admin', '123')).status).toBe(400);
  });
});

describe('sign-in lockout per username', () => {
  it('locks one username after 5 wrong passwords without blocking others on the same IP; a reset unlocks it', async () => {
    const user = await activeUser('Lock', 'right12');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await signIn(user.username, `wrong${attempt}`)).status).toBe(400);
    }
    // The fifth wrong password locks the username and already says so.
    const fifth = await signIn(user.username, 'wrong4');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('locked');
    const locked = await signIn(user.username.toUpperCase(), 'right12');
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('locked');
    // Direct Mayan access is locked too (Mayan's lockout answers 403).
    expect(DENIED).toContain((await basicApi(user.username, 'right12', '/recafco/me/')).status);

    // Everyone else in the office (same IP address) still signs in.
    expect((await signIn('dev_employee_b', users.b.password)).status).toBe(200);
    const portal = await portalLoginAs(user.username, 'right12');
    expect(portal.session).toBeNull();
    expect(await portal.response.text()).toContain('Too many unsuccessful sign-in attempts');

    expect((await api(await admin(), `/recafco/admin/users/${user.id}/`)).body.locked_out).toBe(true);
    expect((await json(await admin(), `/recafco/admin/users/${user.id}/password/`, 'POST', { password: '123' })).status).toBe(204);
    const unlocked = await signIn(user.username, '123');
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.must_change_password).toBe(true);
  });

  it('limits rapid sign-in requests per username, not per address', async () => {
    // A correct password each time: no lockout, only the rate limit (10 per minute).
    const user = await activeUser('Rate', 'rate123');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await signIn(user.username, 'rate123')).status);
    expect(statuses.slice(0, 9).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await signIn('dev_employee_b', users.b.password)).status).toBe(200);
  });
});
