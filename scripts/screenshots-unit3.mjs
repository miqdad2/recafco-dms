// Unit 3 screenshots: confidential upload and upload-recovery states, taken
// in headless Microsoft Edge through the Chrome DevTools protocol against
// the portal on 127.0.0.1:3107 (development stack only).
//
//   node scripts/screenshots-unit3.mjs docs/screenshots/unit-3
//
// Recovery states are produced for real: the upload reaches the server and
// is saved, but the browser is told the connection dropped (DevTools
// "Fetch.failRequest" on the reply). Passwords come from deploy/dev/.env
// and are never printed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] ?? 'docs/screenshots/unit-3');
const PORTAL = 'http://127.0.0.1:3107';
const env = Object.fromEntries(
  readFileSync(join(root, 'deploy', 'dev', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const ADMIN = ['dev_admin', env.RECAFCO_DEV_PASSWORD_ADMIN];
const EMPLOYEE = ['dev_employee_a', env.RECAFCO_DEV_PASSWORD_EMPLOYEE_A];
const RUN = `s${Date.now().toString(36)}`;

function makePdf(text) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) throw new Error('Microsoft Edge not found.');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'recafco-shots3-'));
const pdfPath = join(profile, `Supplier contract ${RUN}.pdf`);
writeFileSync(pdfPath, makePdf(`Sample ${RUN}`));
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
async function setFile() {
  const { root: docRoot } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '#file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [pdfPath] });
}
// Choose an <option> by its visible text and tell React about it.
const choose = (selector, text) => evaluate(`(() => {
  const select = document.querySelector(${JSON.stringify(selector)});
  const option = [...select.options].find((o) => o.textContent.trim().startsWith(${JSON.stringify(text)}));
  if (!option) return false;
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

// Network control: decide per request what the browser experiences.
let failUploadReply = false;
let failStatus = false;
let holdStatus = null;
listeners.add(async (message) => {
  if (message.method !== 'Fetch.requestPaused') return;
  const { requestId, request, responseStatusCode } = message.params;
  if (request.url.endsWith('/api/upload') && responseStatusCode !== undefined && failUploadReply) {
    // The server saved the upload; the browser never gets the reply.
    await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
    return;
  }
  if (request.url.includes('/api/upload/operations/')) {
    if (failStatus) {
      await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return;
    }
    if (holdStatus) {
      holdStatus.push(requestId);
      return;
    }
  }
  await send('Fetch.continueRequest', { requestId });
});

mkdirSync(out, { recursive: true });
await send('Page.enable');
await send('Network.enable');
await send('DOM.enable');
try {
  await viewport(1440, 900);
  await signIn(ADMIN);

  // 1. Confidential upload form (administrator).
  await goto('/upload');
  await evaluate(`document.querySelector('input[name=access][value=confidential]').click()`);
  await sleep(300);
  await choose('#department', 'Finance');
  await choose('#category', 'Invoice');
  await choose('#confidential_group', 'Confidential (original group)');
  await evaluate(`(() => { const i = document.querySelector('#label'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Salary review ${RUN}'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setFile();
  await sleep(300);
  await shot('01-confidential-upload-form-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('02-confidential-upload-form-mobile', 390, 844);
  await viewport(1440, 900);

  // 2. Receipt: saved to a group the administrator is not a member of.
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await waitUntil(`document.body.innerText.includes('The document is saved')`);
  await shot('03-confidential-upload-receipt-desktop');

  // 3. Recovery: the reply is lost, the status check is still running.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/upload', requestStage: 'Response' }, { urlPattern: '*/api/upload/operations/*', requestStage: 'Request' }] });
  await signIn(EMPLOYEE);
  await goto('/upload?department=1');
  await choose('#category', 'Bill');
  await setFile();
  failUploadReply = true;
  holdStatus = [];
  await evaluate(`document.querySelector('main form button[type=submit]').click()`);
  await waitUntil(`document.body.innerText.includes('We are not sure your upload was saved')`);
  await sleep(300);
  await shot('04-upload-uncertain-checking-desktop');

  // 4. The status check cannot reach the server either.
  failStatus = true;
  const held = holdStatus;
  holdStatus = null;
  for (const requestId of held) await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
  await waitUntil(`document.body.innerText.includes('We could not confirm your upload')`);
  await shot('05-upload-unconfirmed-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('06-upload-unconfirmed-mobile', 390, 844);
  await viewport(1440, 900);

  // 5. After a reload, the page offers to check the earlier upload.
  failStatus = false;
  failUploadReply = false;
  await goto('/upload');
  await waitUntil(`document.body.innerText.includes('An earlier upload was not confirmed')`);
  await shot('07-upload-recovery-banner-after-reload-desktop');

  // 6. Checking finds the saved document: no copy is made.
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Check whether it was saved')).click()`);
  await waitUntil(`location.pathname.startsWith('/documents/')`);
  await sleep(800);
  await shot('08-upload-recovered-document-desktop');
  const recoveredPath = await evaluate('location.pathname');
  await send('Fetch.disable');

  // 7. Administrator: document page with responsibility and "Make confidential".
  await signIn(ADMIN);
  await goto(`/admin${recoveredPath}`);
  await shot('09-admin-document-reclassify-desktop');
  await viewport(390, 844, true);
  await sleep(300);
  await shot('10-admin-document-reclassify-mobile', 390, 844);
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
