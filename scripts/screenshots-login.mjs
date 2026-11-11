// Login screen screenshots and checks (development stack only; portal on
// 127.0.0.1:3107). Covers 390/768/1440/1920px, signed-out, empty submit,
// wrong password, Show/Hide, keyboard focus, lockout, pending, short
// screens, 200% zoom and the first-login password change. Creates two
// throwaway dev accounts per run. Passwords from deploy/dev/.env are never
// printed.
//
//   node scripts/screenshots-login.mjs docs/screenshots/login-refresh/after
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] ?? 'docs/screenshots');
const PORTAL = 'http://127.0.0.1:3107';
const env = Object.fromEntries(
  readFileSync(join(root, 'deploy', 'dev', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const accounts = {
  employee: ['dev_employee_a', env.RECAFCO_DEV_PASSWORD_EMPLOYEE_A],
  admin: ['dev_admin', env.RECAFCO_DEV_PASSWORD_ADMIN],
};

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = edgeCandidates.find((path) => existsSync(path));
if (!edge) throw new Error('Microsoft Edge not found.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots-login-'));
const browser = spawn(edge, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Edge did not start.');
}

const socket = new WebSocket(await connect());
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const listeners = new Set();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else {
    for (const listener of listeners) listener(message);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

async function goto(path) {
  const loaded = new Promise((resolve) => {
    const listener = (message) => {
      if (message.method === 'Page.loadEventFired') {
        listeners.delete(listener);
        resolve();
      }
    };
    listeners.add(listener);
  });
  await send('Page.navigate', { url: `${PORTAL}${path}` });
  await loaded;
  // Let streamed sections and preview images finish.
  for (let i = 0; i < 40; i += 1) {
    const busy = await evaluate(
      `!!document.querySelector('[aria-busy="true"]') || [...document.images].some((img) => !img.complete)`,
    );
    if (!busy) break;
    await sleep(250);
  }
  await sleep(300);
}

async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}

async function signIn([username, password]) {
  await send('Network.clearBrowserCookies');
  await goto('/login');
  await evaluate(`(() => {
    document.querySelector('#username').value = ${JSON.stringify(username)};
    document.querySelector('#password').value = ${JSON.stringify(password)};
    document.querySelector('form button[type=submit]').click();
  })()`);
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    if (await evaluate(`location.pathname === '/'`)) return;
  }
  throw new Error(`Sign-in failed for ${username}.`);
}

const results = [];
async function shot(name, path, { width = 1440, height = 900, mobile = false } = {}) {
  await viewport(width, height, mobile);
  await goto(path);
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(size.h, 6000), scale: 1 },
  });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, path, width, horizontalScroll: size.w > size.inner });
}

// --- Login screens -----------------------------------------------------------
const MAYAN = `http://127.0.0.1:${env.RECAFCO_DEV_MAYAN_PORT ?? '8091'}/api/v4`;
const RUN = `l${Date.now().toString(36)}`;
const WIDTHS = { phone: [390, 844, true], tablet: [768, 1024, true], desktop: [1440, 900, false], wide: [1920, 1080, false] };
const checks = {};

async function api(path, { token, body } = {}) {
  const response = await fetch(`${MAYAN}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function snap(name, [width, height, mobile], scale = 1) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await sleep(350);
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.max(height, Math.min(size.h, 4000)), scale: 1 },
  });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, path: await evaluate('location.pathname + location.search'), width, height, scale, horizontalScroll: size.w > size.inner, contentHeight: size.h });
}

const typeInto = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const submit = () => evaluate(`document.querySelector('main form button[type=submit]').click()`);
const clickButton = (text) => evaluate(`[...document.querySelectorAll('main button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`);
async function waitFor(expression, timeout = 15000) {
  for (const start = Date.now(); Date.now() - start < timeout; ) {
    if (await evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}
async function tab(times) {
  for (let i = 0; i < times; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
}
async function fresh(path = '/login') {
  await send('Network.clearBrowserCookies');
  await goto(path);
}

// Test accounts for this run (dev stack only): one with a pending first-login
// change, one that will be locked. Passwords are throwaway values.
const admin = (await api('/recafco/auth/login/', { body: { username: 'dev_admin', password: env.RECAFCO_DEV_PASSWORD_ADMIN } })).body.token;
const firstUser = `first_${RUN}`;
const lockUser = `lock_${RUN}`;
// Wrong passwords are tried only on a throwaway account, never on dev users.
const wrongUser = `wrong_${RUN}`;
for (const username of [firstUser, lockUser, wrongUser]) {
  const created = await api('/recafco/admin/users/', { token: admin, body: { username, password: '123', first_name: 'Sample', last_name: 'Employee' } });
  if (created.status !== 201) throw new Error(`Could not create ${username}: ${created.status}`);
}
const lockToken = (await api('/recafco/auth/login/', { body: { username: lockUser, password: '123' } })).body.token;
await api('/recafco/auth/password/', { token: lockToken, body: { current_password: '123', new_password: 'right12' } });

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
try {
  // 1. Default view at four widths.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await fresh();
  for (const key of ['phone', 'tablet', 'desktop', 'wide']) await snap(`01-login-${key}`, WIDTHS[key]);
  checks.autocomplete = await evaluate(`({ username: document.querySelector('#username')?.autocomplete, password: document.querySelector('#password')?.autocomplete, usernameValue: document.querySelector('#username')?.value, passwordValue: document.querySelector('#password')?.value })`);

  // 2. Signed out.
  await fresh('/login?signedout=1');
  await snap('02-signed-out-desktop', WIDTHS.desktop);
  await snap('02-signed-out-phone', WIDTHS.phone);

  // 3. Empty submit.
  await fresh();
  await snap('03-empty-submit-before', WIDTHS.desktop);
  await submit();
  await sleep(800);
  await snap('03-empty-submit-desktop', WIDTHS.desktop);

  // 4. Wrong password: username kept, password never echoed.
  await fresh();
  await typeInto('#username', wrongUser);
  await typeInto('#password', `Wrong-${RUN}`);
  await submit();
  await waitFor(`document.body.innerText.includes('not correct')`);
  await snap('04-wrong-password-desktop', WIDTHS.desktop);
  await snap('04-wrong-password-phone', WIDTHS.phone);
  checks.wrongPassword = await evaluate(`({ usernameKept: document.querySelector('#username').value, passwordInHtml: document.documentElement.outerHTML.includes('Wrong-${RUN}') })`);

  // 5. Show / Hide password and its accessible name.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await fresh();
  await typeInto('#password', 'example-pass');
  const toggleName = () => evaluate(`(() => { const b = document.querySelector('[aria-controls=password]'); return b ? (b.getAttribute('aria-label') || b.textContent.trim().replace(/\\s+/g, ' ')) + ' | type=' + document.querySelector('#password').type : null; })()`);
  checks.toggleBefore = await toggleName();
  await evaluate(`document.querySelector('[aria-controls=password]').click()`);
  await sleep(200);
  checks.toggleAfter = await toggleName();
  await snap('05-password-shown-desktop', WIDTHS.desktop);

  // 6. Keyboard only: Tab into the form (skip link, username, password, toggle).
  await fresh();
  await tab(2);
  checks.focusAfter2Tabs = await evaluate(`document.activeElement?.id || document.activeElement?.textContent?.trim()`);
  await snap('06-keyboard-focus-username', WIDTHS.desktop);
  await tab(2);
  checks.focusAfter4Tabs = await evaluate(`document.activeElement?.getAttribute('aria-controls') ? 'password toggle' : (document.activeElement?.id || document.activeElement?.textContent?.trim())`);
  await snap('06-keyboard-focus-toggle', WIDTHS.desktop);

  // 7. Lockout: five wrong passwords, then the right one.
  for (let i = 0; i < 5; i += 1) await api('/recafco/auth/login/', { body: { username: lockUser, password: `bad${i}` } });
  await fresh();
  await typeInto('#username', lockUser.toUpperCase());
  await typeInto('#password', 'right12');
  await submit();
  await waitFor(`document.body.innerText.includes('Too many')`);
  await snap('07-lockout-desktop', WIDTHS.desktop);
  await snap('07-lockout-phone', WIDTHS.phone);

  // 8. Pending: slow network, then the button says "Signing in…" and is disabled.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await fresh();
  await typeInto('#username', wrongUser);
  await typeInto('#password', `Slow-${RUN}`);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 3000, downloadThroughput: -1, uploadThroughput: -1 });
  await submit();
  await sleep(500);
  checks.pending = await evaluate(`(() => { const b = document.querySelector('main form button[type=submit]'); return { text: b.textContent.trim(), disabled: b.disabled }; })()`);
  await snap('08-pending-desktop', WIDTHS.desktop);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(3500);

  // 9. Short screens, on-screen keyboard (phone 390x480) and 200% zoom.
  await fresh();
  await snap('09-short-desktop-1440x600', [1440, 600, false]);
  await snap('09-phone-keyboard-open-390x480', [390, 480, true]);
  await snap('09-zoom-200-desktop', [720, 450, false], 2);

  // 10. First sign-in with a temporary password: change-password screen.
  await fresh();
  await typeInto('#username', firstUser);
  await typeInto('#password', '123');
  await submit();
  await waitFor(`location.pathname === '/change-password'`);
  await sleep(400);
  await snap('10-first-login-change-password-desktop', WIDTHS.desktop);
  await snap('10-first-login-change-password-phone', WIDTHS.phone);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await typeInto('#current_password', '123');
  await typeInto('#new_password', '12345');
  await typeInto('#new_password_again', '12345');
  await submit();
  await waitFor(`document.body.innerText.includes('Use at least 6 characters')`);
  await snap('11-first-login-too-short-desktop', WIDTHS.desktop);
  await snap('11-first-login-too-short-phone', WIDTHS.phone);
} finally {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  socket.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* Edge may still hold files */ }
}

writeFileSync(join(out, 'index.json'), JSON.stringify({ results, checks }, null, 2) + '\n');
for (const result of results) console.log(`${result.horizontalScroll ? 'SIDEWAYS SCROLL' : 'ok'}\t${result.width}x${result.height}@${result.scale}\t${result.name}`);
console.log(JSON.stringify(checks, null, 2));
if (results.some((result) => result.horizontalScroll)) process.exitCode = 1;
