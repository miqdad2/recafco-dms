// Captures desktop and phone screenshots of the portal running on
// 127.0.0.1:3107 (development stack only), using headless Microsoft Edge
// through the Chrome DevTools protocol. No extra packages needed (Node 22+).
//
//   node scripts/screenshots.mjs <output folder>
//
// Signs in as the dev users with the passwords in deploy/dev/.env (never
// printed). Also checks that no page scrolls sideways on a phone.
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
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots-'));
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

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
try {
  const phone = { width: 390, height: 844, mobile: true };

  await viewport(1440, 900, false);
  await signIn(accounts.employee);
  const departments = await evaluate(
    `[...document.querySelectorAll('a[href^="/departments/"]')].map((a) => a.getAttribute('href'))`,
  );
  const department = departments[0];
  const documentHref = await (async () => {
    await goto(department);
    return evaluate(`document.querySelector('a[href^="/documents/"]')?.getAttribute('href') ?? null`);
  })();

  await shot('01-home-desktop', '/');
  await shot('02-home-mobile', '/', phone);
  await shot('03-department-desktop', department);
  await shot('04-department-mobile', department, phone);
  await shot('05-department-search-desktop', `${department}?q=journey`);
  await shot('06-upload-preselected-desktop', `/upload?department=${department.split('/').pop()}`);
  await shot('07-upload-preselected-mobile', `/upload?department=${department.split('/').pop()}`, phone);
  if (documentHref) {
    await shot('08-document-desktop', documentHref);
    await shot('09-document-mobile', documentHref, phone);
  }
  await shot('10-search-all-desktop', '/search?q=journey');
  await shot('11-favorites-desktop', '/favorites');
  await shot('12-admin-refused-employee-desktop', '/admin');

  await viewport(1440, 900, false);
  await signIn(accounts.admin);
  await shot('20-admin-overview-desktop', '/admin');
  await shot('21-admin-overview-mobile', '/admin', phone);
  await shot('22-admin-departments-desktop', '/admin/departments');
  await shot('23-admin-categories-desktop', '/admin/categories');
  await shot('24-admin-users-desktop', '/admin/users');
  await shot('25-admin-users-mobile', '/admin/users', phone);
  await shot('26-admin-user-new-desktop', '/admin/users/new');
  await shot('27-admin-confidential-groups-desktop', '/admin/confidential-groups');
  await shot('28-admin-documents-desktop', '/admin/documents');
  await shot('29-admin-activity-desktop', '/admin/activity');
  const userHref = await (async () => {
    await goto('/admin/users?q=dev_employee_b');
    return evaluate(`document.querySelector('a[href^="/admin/users/"]:not([href="/admin/users/new"])')?.getAttribute('href') ?? null`);
  })();
  if (userHref) await shot('30-admin-user-edit-desktop', userHref);
  const groupHref = await (async () => {
    await goto('/admin/confidential-groups');
    return evaluate(`document.querySelector('a[href^="/admin/confidential-groups/"]')?.getAttribute('href') ?? null`);
  })();
  if (groupHref) await shot('31-admin-confidential-group-desktop', groupHref);
} finally {
  socket.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* Edge may still hold the folder briefly */ }
}

writeFileSync(join(out, 'index.json'), JSON.stringify(results, null, 2) + '\n');
for (const result of results) {
  console.log(`${result.horizontalScroll ? 'SIDEWAYS SCROLL' : 'ok'}\t${result.width}px\t${result.name}\t${result.path}`);
}
if (results.some((result) => result.horizontalScroll)) process.exitCode = 1;
