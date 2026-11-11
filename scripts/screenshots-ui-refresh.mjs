// UI refresh screenshots: every main screen at 390, 768, 1440 and 1920px,
// keyboard focus, mobile menu, validation errors, a long Arabic/English
// file name, populated and empty states. Development stack only; the portal
// must run on 127.0.0.1:3107. Uploads one small dev document per run.
//
//   node scripts/screenshots-ui-refresh.mjs docs/screenshots/ui-refresh/after
//
// Passwords come from deploy/dev/.env and are never printed.
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
const PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots-ui-'));
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

// --- UI refresh flow -------------------------------------------------------
const WIDTHS = { phone: [390, 844, true], tablet: [768, 1024, true], desktop: [1440, 900, false], wide: [1920, 1080, false] };

/** Screenshot of the current page at a named width (no navigation). */
async function snap(name, [width, height, mobile]) {
  await viewport(width, height, mobile);
  await sleep(350);
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(size.h, 6000), scale: 1 },
  });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, path: await evaluate('location.pathname + location.search'), width, horizontalScroll: size.w > size.inner });
}

async function at(name, path, widths) {
  await viewport(...WIDTHS[widths[0]]);
  await goto(path);
  for (const key of widths) await snap(`${name}-${key}`, WIDTHS[key]);
}

async function pressTab(times) {
  for (let i = 0; i < times; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
}

const LONG_NAME = 'عقد توريد ألواح الصلب للمشروع رقم ٤٥٢١ - Steel plates supply contract for project 4521 (signed copy, revision 3).pdf';
const filePath = join(profile, LONG_NAME);
writeFileSync(filePath, Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1'));

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
await send('DOM.enable');
try {
  await viewport(1440, 900, false);
  await signIn(accounts.employee);

  await at('01-home', '/', ['phone', 'tablet', 'desktop', 'wide']);
  // Keyboard: focus ring on the third interactive element of the home page.
  await viewport(...WIDTHS.desktop);
  await goto('/');
  await pressTab(6);
  await snap('02-home-keyboard-focus', WIDTHS.desktop);

  // Mobile navigation open.
  await viewport(...WIDTHS.phone);
  await goto('/');
  await evaluate(`document.querySelector('header details summary').click()`);
  await snap('03-mobile-menu-open', WIDTHS.phone);

  const department = await evaluate(`document.querySelector('a[href^="/departments/"]').getAttribute('href')`);
  await at('04-department', department, ['phone', 'tablet', 'desktop', 'wide']);
  await at('05-department-filtered-empty', `${department}?q=zzzz-no-such-text`, ['desktop']);
  await at('06-search-results', '/search?q=Supplier', ['phone', 'desktop']);
  await at('07-search-start', '/search', ['desktop']);

  // Upload: empty form, validation errors, then a long Arabic/English file name.
  await at('08-upload', `/upload?${department.replace('/departments/', 'department=')}`, ['phone', 'tablet', 'desktop']);
  await viewport(...WIDTHS.desktop);
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await sleep(300);
  await snap('09-upload-validation-errors', WIDTHS.desktop);
  const { root: docRoot } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '#file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await sleep(400);
  await snap('10-upload-file-selected-long-name-desktop', WIDTHS.desktop);
  await snap('10-upload-file-selected-long-name-phone', WIDTHS.phone);
  await viewport(...WIDTHS.desktop);
  await evaluate(`(() => { const s = document.querySelector('#category'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  for (let i = 0; i < 80 && !(await evaluate(`location.pathname.startsWith('/documents/')`)); i += 1) await sleep(250);
  await sleep(1500);
  await snap('11-document-long-title-desktop', WIDTHS.desktop);
  await snap('11-document-long-title-phone', WIDTHS.phone);

  await at('12-my-uploads', '/my-uploads', ['phone', 'desktop']);
  await at('13-favorites', '/favorites', ['desktop']);

  // Administrator: navigation, users, a user with access changes, a document.
  await viewport(...WIDTHS.desktop);
  await signIn(accounts.admin);
  await at('14-admin-overview', '/admin', ['phone', 'desktop']);
  await at('15-admin-users', '/admin/users', ['desktop']);
  const userHref = await evaluate(`[...document.querySelectorAll('a[href^="/admin/users/"]')].map((a) => a.getAttribute('href')).find((h) => /\\d+$/.test(h))`);
  if (userHref) await at('16-admin-user-access-changes', userHref, ['desktop', 'phone']);
  await at('17-admin-departments', '/admin/departments', ['desktop']);
  await goto('/admin/documents');
  const docHref = await evaluate(`document.querySelector('a[href^="/admin/documents/"]')?.getAttribute('href') ?? null`);
  if (docHref) await at('18-admin-document-reclassify', docHref, ['desktop']);
  await at('19-upload-confidential-option', '/upload', ['desktop']);
  await evaluate(`document.querySelector('input[name=access][value=confidential]').click()`);
  await sleep(200);
  await evaluate(`(() => { const s = document.querySelector('#confidential_group'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await snap('20-upload-confidential-group-chosen', WIDTHS.desktop);
} finally {
  socket.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* Edge may still hold files */ }
}

writeFileSync(join(out, 'index.json'), JSON.stringify(results, null, 2) + '\n');
for (const result of results) console.log(`${result.horizontalScroll ? 'SIDEWAYS SCROLL' : 'ok'}\t${result.width}px\t${result.name}`);
if (results.some((result) => result.horizontalScroll)) process.exitCode = 1;
