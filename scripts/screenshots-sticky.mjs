// Sticky toolbar checks and screenshots (development stack only; portal on
// 127.0.0.1:3107). Temporarily reactivates dev-only inactive departments so
// the home page fills several screens, and restores them afterwards.
// Passwords from deploy/dev/.env are never printed.
//
//   node scripts/screenshots-sticky.mjs docs/screenshots/sticky-toolbar
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
const PORT = 9338;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots-sticky-'));
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

// --- Sticky toolbar checks ---------------------------------------------------
const MAYAN = `http://127.0.0.1:${env.RECAFCO_DEV_MAYAN_PORT ?? '8091'}/api/v4`;
const checks = {};
async function mayan(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${MAYAN}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Screenshot of what is on screen (viewport only), so sticky parts are visible. */
async function view(name, [width, height, mobile], scale = 1) {
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, width, height, scale, horizontalScroll: size.w > size.inner });
}
async function setSize([width, height, mobile], scale = 1) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await sleep(300);
}
/** Where the toolbar and header are after scrolling `by` pixels. */
const measure = (by) => evaluate(`(async () => {
  window.scrollTo(0, ${by});
  await new Promise((r) => setTimeout(r, 400));
  const bar = document.querySelector('[role=region][aria-label="Search and upload"]');
  const header = document.querySelector('header');
  const b = bar.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  return {
    scrollY: Math.round(scrollY),
    position: getComputedStyle(bar).position,
    stuck: bar.dataset.stuck === 'true',
    barTop: Math.round(b.top), barBottom: Math.round(b.bottom), barHeight: Math.round(b.height),
    headerBottom: Math.round(h.bottom),
    overlapsHeader: b.top < h.bottom - 0.5,
    background: getComputedStyle(bar).backgroundColor,
    viewportHeight: innerHeight,
    pageHeight: document.documentElement.scrollHeight,
  };
})()`);

const SIZES = { phone: [390, 844, true], tablet: [768, 1024, true], desktop: [1440, 900, false], wide: [1920, 1080, false] };

// Fill the home page: temporarily reactivate dev-only inactive departments
// (restored afterwards). Dev stack only.
const admin = (await mayan('/recafco/auth/login/', { method: 'POST', body: { username: 'dev_admin', password: env.RECAFCO_DEV_PASSWORD_ADMIN } })).body.token;
const all = (await mayan('/recafco/admin/departments/', { token: admin })).body.results;
const reactivated = all.filter((d) => !d.is_active).slice(0, 14).map((d) => d.id);
for (const id of reactivated) await mayan(`/recafco/admin/departments/${id}/`, { token: admin, method: 'PATCH', body: { is_active: true } });
checks.temporarilyReactivated = reactivated.length;

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
try {
  await setSize(SIZES.desktop);
  await signIn(accounts.employee);
  const department = await evaluate(`[...document.querySelectorAll('a[href^="/departments/"]')].find((a) => a.textContent.includes('Finance'))?.getAttribute('href')`);
  checks.home = {};
  checks.department = {};
  for (const [key, size] of Object.entries(SIZES)) {
    await setSize(size);
    await goto('/');
    await view(`01-home-top-${key}`, size);
    checks.home[key] = await measure(900);
    await view(`02-home-scrolled-${key}`, size);
    await goto(department);
    await view(`03-department-top-${key}`, size);
    checks.department[key] = await measure(1200);
    await view(`04-department-scrolled-${key}`, size);
  }

  // Keyboard focus far down the page lands below the sticky toolbar.
  await setSize(SIZES.desktop);
  await goto(department);
  checks.focus = await evaluate(`(async () => {
    const links = [...document.querySelectorAll('table a[href^="/documents/"]')];
    const target = links[Math.min(14, links.length - 1)];
    window.scrollTo(0, 0);
    target.focus();
    await new Promise((r) => setTimeout(r, 400));
    const bar = document.querySelector('[role=region][aria-label="Search and upload"]').getBoundingClientRect();
    const t = target.getBoundingClientRect();
    return { linkTop: Math.round(t.top), toolbarBottom: Math.round(bar.bottom), visibleBelowToolbar: t.top >= bar.bottom, activeIsTarget: document.activeElement === target };
  })()`);
  await view('05-focus-below-toolbar-desktop', SIZES.desktop);

  // Search and category from the stuck toolbar; values and Upload link kept.
  await measure(1200);
  await evaluate(`(() => {
    const q = document.querySelector('#department-search');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(q, 'PROC');
    const select = document.querySelector('#category');
    select.value = [...select.options].find((o) => o.textContent.trim() === 'Invoice')?.value ?? '';
    q.form.requestSubmit();
  })()`);
  for (let i = 0; i < 40 && !(await evaluate(`location.search.includes('q=PROC')`)); i += 1) await sleep(200);
  await sleep(800);
  checks.searchFromToolbar = await evaluate(`({
    url: location.pathname + location.search,
    inputKept: document.querySelector('#department-search').value,
    categoryKept: document.querySelector('#category').selectedOptions[0]?.textContent.trim(),
    uploadHref: document.querySelector('[role=region] a[href^="/upload"]')?.getAttribute('href') ?? null,
  })`);
  await view('06-department-search-result-desktop', SIZES.desktop);

  // Short screens: 200% zoom (1440x900 at 2x = 720x450 CSS px) and a phone
  // with the keyboard open (390x480).
  for (const [name, size, scale] of [['zoom-200', [720, 450, false], 2], ['phone-keyboard-open', [390, 480, true], 1]]) {
    await setSize(size, scale);
    await goto(department);
    checks[name] = await measure(900);
    await view(`07-${name}-scrolled`, size, scale);
  }
  // Keyboard-only: Tab from the top of the department page into the toolbar.
  await setSize(SIZES.desktop);
  await goto(department);
  const order = [];
  for (let i = 0; i < 14; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    order.push(await evaluate(`(() => { const e = document.activeElement; return e.id || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30); })()`));
  }
  checks.tabOrder = order;
} finally {
  for (const id of reactivated) await mayan(`/recafco/admin/departments/${id}/`, { token: admin, method: 'PATCH', body: { is_active: false } });
  checks.restored = reactivated.length;
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
