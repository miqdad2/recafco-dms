// Unit 5 admin UI verification: drives the administration screens with real
// clicks in headless Edge (role create, department create+delete, bulk
// recycle+restore, document recycle+permanent delete, account delete) and
// captures screenshots of every dialog. Development stack only; portal on
// 127.0.0.1:3107. Creates throwaway dev data. Passwords are never printed.
//
//   node scripts/screenshots-admin-control.mjs docs/screenshots/unit-5
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
const PORT = 9339;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots-admin-'));
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

// --- Unit 5 admin UI: real clicks in the browser ------------------------------
const MAYAN = `http://127.0.0.1:${env.RECAFCO_DEV_MAYAN_PORT ?? '8091'}/api/v4`;
const RUN = `u${Date.now().toString(36)}`;
const checks = {};
const DESKTOP = [1440, 900, false];
const PHONE = [390, 844, true];

async function mayan(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${MAYAN}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function makePdf(text) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
async function upload(token, label) {
  const form = new FormData();
  form.append('file', new Blob([makePdf(label)], { type: 'application/pdf' }), `${label}.pdf`);
  form.append('label', label);
  form.append('department', 'Finance (dev sample)');
  form.append('category', 'Bill');
  form.append('operation_id', [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
  const response = await fetch(`${MAYAN}/recafco/uploads/`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Token ${token}` }, body: form });
  return (await response.json()).id;
}

async function snap(name, [width, height, mobile] = DESKTOP, fullPage = true) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await sleep(350);
  const size = await evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: innerWidth })`);
  const capture = await send('Page.captureScreenshot', fullPage
    ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(size.h, 5000), scale: 1 } }
    : { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(capture.data, 'base64'));
  results.push({ name, width, horizontalScroll: size.w > size.inner });
}
const typeInto = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
  set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const clickText = (text, scope = 'main') => evaluate(`(() => {
  const el = [...document.querySelectorAll('${scope} button, ${scope} a')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}) && b.offsetParent !== null);
  if (!el) return false;
  el.click();
  return true;
})()`);
const clickInDialog = (text) => evaluate(`(() => {
  const dialog = [...document.querySelectorAll('dialog')].find((d) => d.open);
  const el = dialog && [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`);
async function waitFor(expression, timeout = 30000) {
  for (const start = Date.now(); Date.now() - start < timeout; ) {
    if (await evaluate(expression)) return true;
    await sleep(200);
  }
  return false;
}
const bodyHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;

const tokenAdmin = (await mayan('/recafco/auth/login/', { method: 'POST', body: { username: 'dev_admin', password: env.RECAFCO_DEV_PASSWORD_ADMIN } })).body.token;
const tokenEmployee = (await mayan('/recafco/auth/login/', { method: 'POST', body: { username: 'dev_employee_a', password: env.RECAFCO_DEV_PASSWORD_EMPLOYEE_A } })).body.token;
const bulkDoc = await upload(tokenEmployee, `UIBULK-${RUN}`);
const pageDoc = await upload(tokenEmployee, `UIPAGE-${RUN}`);
const leaver = (await mayan('/recafco/admin/users/', { token: tokenAdmin, method: 'POST', body: { username: `uileaver_${RUN}`, password: '123', first_name: 'Ui', last_name: 'Leaver' } })).body;

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(accounts.admin);

  // 1. Overview and roles: create a role through the form.
  await goto('/admin');
  await snap('01-admin-overview');
  await goto('/admin/roles');
  await typeInto('#new-role-name', `UI role ${RUN}`);
  await typeInto('#new-role-description', 'Created through the browser');
  await evaluate(`document.querySelector('input[name=permissions][value="documents.recycle"]').click()`);
  await snap('02-roles-list-and-create');
  await evaluate(`[...document.querySelectorAll('main form button[type=submit]')].pop().click()`);
  checks.roleCreatedInUi = await waitFor(`location.pathname.startsWith('/admin/roles/') && ${bodyHas('The role was created')}`);
  await snap('03-role-detail');

  // 2. Departments: create, then delete through the dialog.
  await goto('/admin/departments');
  await typeInto('#new-name', `UI dept ${RUN}`);
  await evaluate(`document.querySelector('#new-name').form.querySelector('button[type=submit]').click()`);
  await waitFor(bodyHas(`UI dept ${RUN}`));
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('main li')].find((li) => li.innerText.includes(${JSON.stringify(`UI dept ${RUN}`)}));
    [...item.querySelectorAll('button')].find((b) => b.textContent.includes('Delete or merge')).click();
  })()`);
  await sleep(300);
  await snap('04-department-delete-dialog', DESKTOP, false);
  await clickInDialog('Delete department');
  // The add form above still says the department was added, so look at the list rows only.
  checks.departmentDeletedInUi = await waitFor(`location.search.includes('done=department-deleted') && ${bodyHas('Department deleted.')} && ![...document.querySelectorAll('main li')].some((li) => li.innerText.includes(${JSON.stringify(`UI dept ${RUN}`)}))`);
  await snap('04b-department-deleted', DESKTOP, false);
  // A populated department's dialog (counts and choices), not submitted.
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('main li')].find((li) => li.innerText.includes('Finance (dev sample)'));
    [...item.querySelectorAll('button')].find((b) => b.textContent.includes('Delete or merge')).click();
  })()`);
  await sleep(300);
  await snap('05-department-populated-dialog', DESKTOP, false);
  await clickInDialog('Cancel');

  // 3. Categories dialog (not submitted).
  await goto('/admin/categories');
  await evaluate(`[...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Delete or merge')).click()`);
  await sleep(300);
  await snap('06-category-delete-dialog', DESKTOP, false);

  // 4. Documents: bulk recycle and restore through the bulk bar.
  await goto(`/admin/documents?q=UIBULK-${RUN}`);
  await evaluate(`document.querySelector('input[form="bulk-documents"][name=ids]').click()`);
  await evaluate(`(() => { const s = document.querySelector('#bulk-action'); s.value = 'trash'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  await snap('07-documents-bulk-bar');
  await clickText('Apply');
  await sleep(300);
  await snap('08-bulk-confirm-dialog', DESKTOP, false);
  await clickInDialog('Confirm');
  checks.bulkTrashInUi = await waitFor(`location.search.includes('done=bulk-trash') && ${bodyHas('1 of 1 document moved to the recycle bin.')}`);
  await snap('08b-bulk-result', DESKTOP, false);
  checks.bulkTrashServer = (await mayan(`/recafco/admin/documents/?status=trash&q=UIBULK-${RUN}`, { token: tokenAdmin })).body.count === 1;
  await goto(`/admin/documents?status=trash&q=UIBULK-${RUN}`);
  await snap('09-recycle-bin');
  await evaluate(`document.querySelector('input[form="bulk-documents"][name=ids]').click()`);
  await clickText('Apply');
  await sleep(200);
  await clickInDialog('Confirm');
  checks.bulkRestoreInUi = await waitFor(`location.search.includes('done=bulk-restore') && ${bodyHas('1 of 1 document restored.')}`);
  checks.employeeSeesRestored = (await mayan(`/recafco/documents/${bulkDoc}/`, { token: tokenEmployee })).status === 200;

  // 5. Document page: files, access, recycle bin, permanent delete.
  await goto(`/admin/documents/${pageDoc}`);
  await snap('10-admin-document-page');
  await clickText('Move to recycle bin');
  await sleep(200);
  await clickInDialog('Move to recycle bin');
  checks.pageTrashInUi = await waitFor(`location.search.includes('done=document-trashed') && ${bodyHas('Moved to the recycle bin.')}`);
  await snap('10b-page-trash-result', DESKTOP, false);
  await goto(`/admin/documents/${pageDoc}`);
  await clickText('Delete permanently');
  await sleep(300);
  await snap('11-purge-dialog', DESKTOP, false);
  await clickInDialog('Delete permanently');
  checks.purgeInUi = await waitFor(`location.search.includes('purged=1') && ${bodyHas('permanently deleted')}`);
  checks.purgeServer404 = (await mayan(`/recafco/admin/documents/${pageDoc}/`, { token: tokenAdmin })).status === 404;

  // 6. Users: delete an account through the dialog.
  await goto(`/admin/users/${leaver.id}`);
  await snap('12-user-page-roles-delete');
  await clickText('Delete account');
  await sleep(300);
  await snap('13-user-delete-dialog', DESKTOP, false);
  await clickInDialog('Delete account');
  checks.userDeletedInUi = await waitFor(`location.pathname === '/admin/users' && ${bodyHas('The account was deleted')}`);

  // 7. Confidential group dialogs (not submitted) and activity log.
  const groups = (await mayan('/recafco/admin/confidential-groups/', { token: tokenAdmin })).body.results;
  const deletable = groups.find((group) => !group.is_builtin);
  if (deletable) {
    await goto(`/admin/confidential-groups/${deletable.id}`);
    await clickText('Delete group');
    await sleep(300);
    await snap('14-confidential-group-delete-dialog', DESKTOP, false);
  }
  await goto('/admin/activity?outcome=success');
  await snap('15-activity-log-filters');
  checks.exportLink = await evaluate(`!!document.querySelector('a[href^="/api/admin/activity/export"]')`);
  const exportResponse = await evaluate(`fetch(document.querySelector('a[href^="/api/admin/activity/export"]').href).then((r) => ({ status: r.status, type: r.headers.get('content-type') }))`);
  checks.exportThroughPortal = exportResponse;

  // 8. Phone widths for the main admin screens.
  for (const [name, path] of [['16-documents-phone', '/admin/documents'], ['17-roles-phone', '/admin/roles'], ['18-activity-phone', '/admin/activity']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await goto(path);
    await snap(name, PHONE);
  }

  // 9. An employee does not see the Administration link and is refused.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await signIn(accounts.employee);
  checks.employeeAdminLink = await evaluate(`!!document.querySelector('a[href="/admin"]')`);
  await goto('/admin/documents');
  checks.employeeRefused = await evaluate(bodyHas('only for RECAFCO administrators'));
} finally {
  socket.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* Edge may still hold files */ }
}

writeFileSync(join(out, 'index.json'), JSON.stringify({ results, checks }, null, 2) + '\n');
for (const result of results) console.log(`${result.horizontalScroll ? 'SIDEWAYS SCROLL' : 'ok'}\t${result.width}px\t${result.name}`);
console.log(JSON.stringify(checks, null, 2));
if (results.some((result) => result.horizontalScroll)) process.exitCode = 1;
