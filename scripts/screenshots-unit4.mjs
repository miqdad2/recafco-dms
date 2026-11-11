// Unit 4 screenshots: sign-in, first-login password change and administrator
// password reset, taken in headless Microsoft Edge through the Chrome
// DevTools protocol against the portal on 127.0.0.1:3107 (development stack
// only). Creates one dev account per run.
//
//   node scripts/screenshots-unit4.mjs docs/screenshots/unit-4
//
// Dev passwords come from deploy/dev/.env and are never printed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] ?? 'docs/screenshots/unit-4');
const PORTAL = 'http://127.0.0.1:3107';
const env = Object.fromEntries(
  readFileSync(join(root, 'deploy', 'dev', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const ADMIN = ['dev_admin', env.RECAFCO_DEV_PASSWORD_ADMIN];
const RUN = `s${Date.now().toString(36)}`;

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) throw new Error('Microsoft Edge not found.');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORT = 9335;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots4-'));
const browser = spawn(edge, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* starting */ }
    await sleep(200);
  }
  throw new Error('Edge did not start.');
}
const socket = new WebSocket(await wsUrl());
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const listeners = new Set();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  } else for (const listener of listeners) listener(message);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
async function waitUntil(expression, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(200);
  }
  const text = await evaluate("document.querySelector('main')?.innerText.slice(0, 900)");
  throw new Error(`Timed out: ${expression}
--- page shows:
${text}`);
}
async function goto(path) {
  await send('Page.navigate', { url: `${PORTAL}${path}` });
  await sleep(400);
  await waitUntil(`document.readyState === 'complete'`);
  await sleep(300);
}
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const results = [];
async function shot(name, width = 1440, height = 900) {
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(size.h, 5000), scale: 1 } });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, width, horizontalScroll: size.w > size.inner });
}
async function signIn([username, password]) {
  await send('Network.clearBrowserCookies');
  await goto('/login');
  await evaluate(`(() => { document.querySelector('#username').value = ${JSON.stringify(username)}; document.querySelector('#password').value = ${JSON.stringify(password)}; document.querySelector('form button[type=submit]').click(); })()`);
  await waitUntil(`location.pathname === '/'`);
}

// --- Unit 4 flow -----------------------------------------------------------
const typeInto = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText = (text) => evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`);

async function signInAs(username, password) {
  await send('Network.clearBrowserCookies');
  await goto('/login');
  await typeInto('#username', username);
  await typeInto('#password', password);
  await click('form button[type=submit]');
}

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
await send('DOM.enable');
const NEW_USER = `Emp_${RUN}`;
try {
  await viewport(1440, 900);

  // 1. Login page with the password shown.
  await send('Network.clearBrowserCookies');
  await goto('/login');
  await typeInto('#username', 'dev_employee_a');
  await typeInto('#password', 'example-password');
  await clickText('Show');
  await sleep(200);
  await shot('01-login-password-shown-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('02-login-password-shown-mobile', 390, 844);
  await viewport(1440, 900);

  // 2. Administrator creates an account with a temporary password "123".
  await signInAs(...ADMIN);
  await waitUntil(`location.pathname === '/'`);
  await goto('/admin/users/new');
  await typeInto('#username', NEW_USER);
  await typeInto('#password', '123');
  await clickText('Show');
  await typeInto('#first_name', 'Sample');
  await typeInto('#last_name', 'Employee');
  await sleep(200);
  await shot('03-admin-create-user-temporary-password-desktop');
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await waitUntil(`location.pathname.startsWith('/admin/users/') && document.body.innerText.includes('was created')`);
  const userPath = await evaluate('location.pathname');
  await shot('04-admin-user-created-must-change-desktop');

  // 3. First sign-in: only the change-password page and sign-out.
  await signInAs(NEW_USER.toUpperCase(), '123');
  await waitUntil(`location.pathname === '/change-password'`);
  await shot('05-first-login-choose-password-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('06-first-login-choose-password-mobile', 390, 844);
  await viewport(1440, 900);
  // Too short: the rule is explained next to the field.
  await typeInto('#current_password', '123');
  await typeInto('#new_password', '12345');
  await typeInto('#new_password_again', '12345');
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await waitUntil(`document.body.innerText.includes('Use at least 6 characters')`);
  await shot('07-first-login-too-short-desktop');
  await typeInto('#current_password', '123');
  await typeInto('#new_password', '246810');
  await typeInto('#new_password_again', '246810');
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await waitUntil(`location.pathname === '/' && document.body.innerText.includes('Your password is saved')`);
  await shot('08-password-saved-home-desktop');

  // 4. Voluntary change from the account menu.
  await goto('/change-password');
  await shot('09-change-password-signed-in-desktop');

  // 5. Administrator resets the password: confirmation shown, nothing echoed.
  await signInAs(...ADMIN);
  await waitUntil(`location.pathname === '/'`);
  await goto(userPath);
  await typeInto('#new-password', '123');
  await evaluate(`window.confirm = () => true`);
  await clickText('Reset password');
  await waitUntil(`document.body.innerText.includes('Password reset.')`);
  await sleep(300);
  await shot('10-admin-password-reset-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('11-admin-password-reset-mobile', 390, 844);
  await viewport(1440, 900);
} finally {
  socket.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* Edge may still hold files briefly */ }
}

writeFileSync(join(out, 'index.json'), JSON.stringify(results, null, 2) + '\n');
for (const result of results) console.log(`${result.horizontalScroll ? 'SIDEWAYS SCROLL' : 'ok'}\t${result.width}px\t${result.name}`);
if (results.some((result) => result.horizontalScroll)) process.exitCode = 1;
