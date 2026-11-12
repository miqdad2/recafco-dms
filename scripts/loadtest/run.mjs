#!/usr/bin/env node
/*
 * RECAFCO DMS load test. ISOLATED DEVELOPMENT STACK ONLY.
 *
 * Drives the production build of the portal (default http://127.0.0.1:3107,
 * pointed at the dev Mayan on port 8091) with synthetic employees created by
 * `recafco_loadtest users`. Each virtual user (VU) has its own account and
 * portal session and runs a closed loop: pick an operation, run it to the
 * last byte, wait the think time, repeat.
 *
 * A VU is a request stream, not a person. With think time 0 one VU keeps one
 * request in flight all the time; a real employee reading pages issues a
 * request every ~20-60 s. See docs/performance-report.md for the conversion.
 *
 * Safety:
 * - Refuses any portal URL that is not on 127.0.0.1/localhost.
 * - Never prints the synthetic password (read from .state/state.json).
 * - Checks every HTML response for leaks across user boundaries: the
 *   confidential marker LTCONF (no synthetic employee may see it) and the
 *   full name of a different VU (a cross-user cache would show it).
 *
 * Usage:
 *   node scripts/loadtest/run.mjs [--stages 1,5,10,20,40] [--stage-seconds 60]
 *     [--mix mixed|read|search|upload] [--think-ms 0] [--label name]
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '.state');

// ------------------------------------------------------------ arguments

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]?.startsWith('--') ? 'true' : all[index + 1]]);
    return pairs;
  }, []),
);
const PORTAL = args.portal ?? 'http://127.0.0.1:3107';
if (!['127.0.0.1', 'localhost'].includes(new URL(PORTAL).hostname)) {
  console.error('Refusing to run: the load test only targets the local development portal.');
  process.exit(2);
}
const STAGES = (args.stages ?? '1,5,10,20,40').split(',').map(Number);
const STAGE_SECONDS = Number(args['stage-seconds'] ?? 60);
const THINK_MS = Number(args['think-ms'] ?? 0);
const MIX_NAME = args.mix ?? 'mixed';
// Every result file name carries a timestamp, so no run overwrites another.
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LABEL = `${args.label ?? MIX_NAME}-${STAMP}`;
// Same seed = same sequence of operations, queries and documents per VU,
// so before/after runs make the same choices (timing still differs).
const SEED = Number(args.seed ?? 1);
const LOGIN_BURST = Number(args['login-burst'] ?? 20);

// Weights per operation (relative). "mixed" approximates an office day:
// mostly reading and searching, some downloads, few uploads.
const MIXES = {
  mixed: { home: 15, department: 20, departmentDeep: 5, search: 20, searchDepartment: 5, document: 15, download: 12, upload: 8 },
  read: { home: 25, department: 30, departmentDeep: 5, document: 25, download: 15 },
  search: { search: 80, searchDepartment: 20 },
  upload: { upload: 100 },
  download: { download: 100 },
};
const MIX = MIXES[MIX_NAME];
if (!MIX) throw new Error(`Unknown mix ${MIX_NAME}`);

const WORDS = {
  common: ['invoice', 'purchase', 'order', 'steel', 'delivery', 'report'],
  medium: ['rebar', 'cement', 'glazing', 'facade', 'warranty', 'inspection', 'quotation', 'contract'],
  rare: ['anodized', 'mullion', 'transom', 'louver', 'gasket'],
  none: ['zzqxnomatch'],
};

// ------------------------------------------------------------ helpers

// Seeded generator (mulberry32). Each VU gets its own stream; see vuRandom.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let random = mulberry32(SEED);
const pick = (items) => items[Math.floor(random() * items.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function weighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (const [name, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return Object.keys(weights)[0];
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function makePdf(text, padBytes = 0) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  if (padBytes > 0) output += `%${'x'.repeat(padBytes)}\n`;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

function hiddenFields(html) {
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
  const fields = [];
  for (const match of form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) {
    fields.push([match[1], (match[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")]);
  }
  return fields;
}

async function signIn(username, password) {
  const started = performance.now();
  const html = await (await fetch(`${PORTAL}/login`)).text();
  const form = new FormData();
  for (const [name, value] of hiddenFields(html)) form.append(name, value);
  form.append('username', username);
  form.append('password', password);
  const response = await fetch(`${PORTAL}/login`, { method: 'POST', body: form, redirect: 'manual', headers: { Origin: PORTAL } });
  await response.arrayBuffer();
  const match = /recafco_portal_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '');
  return { cookie: match ? `recafco_portal_session=${match[1]}` : null, ms: performance.now() - started, status: response.status };
}

// ------------------------------------------------------------ resources

const samples = [];
let portalPid = null;
let lastPortalCpu = null;

async function findPortalPid() {
  const { stdout } = await run('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${new URL(PORTAL).port} -State Listen | Select-Object -First 1).OwningProcess`]);
  return Number(stdout.trim()) || null;
}

async function sampleResources(stage) {
  const at = Date.now();
  const sample = { at, stage, containers: {}, background: {}, portal: null, backlog: null };
  try {
    // Dev stack plus any running container of the ORIGINAL Mayan (read only:
    // `docker stats` observes it; nothing is sent to it).
    const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}']);
    for (const line of stdout.trim().split('\n')) {
      const [name, cpu, mem] = line.split('|');
      const used = mem.split('/')[0].trim();
      const mib = used.endsWith('GiB') ? parseFloat(used) * 1024 : used.endsWith('MiB') ? parseFloat(used) : parseFloat(used) / 1024;
      const value = { cpu: parseFloat(cpu), memMiB: Math.round(mib) };
      if (name.startsWith('recafco-dms-dev-')) sample.containers[name.replace('recafco-dms-dev-', '').replace(/-1$/, '')] = value;
      else if (name.startsWith('mayan-')) sample.background[name] = value;
    }
  } catch { /* docker busy: skip */ }
  if (portalPid) {
    try {
      const { stdout } = await run('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${portalPid}; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"`]);
      const [cpuMs, ws] = stdout.trim().split(' ').map(Number);
      const cpu = lastPortalCpu ? ((cpuMs - lastPortalCpu.cpuMs) / (at - lastPortalCpu.at)) * 100 : null;
      lastPortalCpu = { cpuMs, at };
      sample.portal = { cpu: cpu === null ? null : Math.round(cpu), memMiB: Math.round(ws / 1048576) };
    } catch { /* ignore */ }
  }
  try {
    const { stdout } = await run('sh', [join(here, 'backlog.sh')], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    const backlog = {};
    for (const part of stdout.trim().split(/\s+/).filter(Boolean)) {
      const [queue, length] = part.split('=');
      backlog[queue] = Number(length);
    }
    sample.backlog = backlog;
  } catch { /* ignore */ }
  samples.push(sample);
}

// ---------------------------------------------------------- environment

async function describeEnvironment() {
  const git = async (...a) => (await run('git', a, { cwd: join(here, '..', '..') })).stdout.trim();
  const env = { commit: await git('rev-parse', '--short', 'HEAD'), dirty: (await git('status', '--porcelain', '--', 'portal', 'mayan-extensions')) !== '' };
  // --code-ref <commit>: the extension and portal source in the working tree
  // must be exactly that commit's (checked, not assumed).
  if (args['code-ref']) {
    try {
      await git('diff', '--quiet', args['code-ref'], '--', 'mayan-extensions/recafco_dms', 'portal/src');
    } catch {
      throw new Error(`Source differs from ${args['code-ref']}; refusing to label the run with it.`);
    }
    env.codeRef = await git('rev-parse', '--short', args['code-ref']);
  }
  const dockerExec = (cmd) => run('docker', ['exec', 'recafco-dms-dev-app-1', 'sh', '-c', cmd], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  try {
    const { stdout } = await dockerExec('cat /proc/1/environ | tr "\\0" "\\n" | grep -E "^MAYAN_(GUNICORN_WORKERS|GUNICORN_MAX_REQUESTS|GUNICORN_REQUESTS_JITTER|WORKER_[A-F]_CONCURRENCY)="');
    env.mayan = Object.fromEntries(stdout.trim().split(/\r?\n/).map((l) => l.split('=')));
    env.mayan.gunicornWorkers = env.mayan.MAYAN_GUNICORN_WORKERS;
    const mem = await run('docker', ['inspect', 'recafco-dms-dev-app-1', '--format', '{{.HostConfig.Memory}}']);
    env.mayan.memLimitMiB = Math.round(Number(mem.stdout.trim()) / 1048576);
  } catch { env.mayan = {}; }
  try {
    const { stdout } = await run('docker', ['exec', '-u', 'mayan', 'recafco-dms-dev-app-1', '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_loadtest', 'status'], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    env.dataset = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } catch { env.dataset = null; }
  try {
    const { stdout } = await run('docker', ['ps', '--filter', 'label=com.docker.compose.project=mayan', '--format', '{{.Names}}']);
    env.originalMayanRunning = stdout.trim().split(/\r?\n/).filter(Boolean);
  } catch { env.originalMayanRunning = []; }
  return env;
}

// ------------------------------------------------------------ targets

async function discover(vu) {
  const get = (path) => fetch(`${PORTAL}${path}`, { headers: { Cookie: vu.cookie } }).then((r) => r.text());
  const home = await get('/');
  const departments = [...new Set([...home.matchAll(/href="\/departments\/(\d+)"/g)].map((m) => Number(m[1])))];
  const documents = new Set();
  const pagesPerDepartment = {};
  for (const id of departments) {
    const html = await get(`/departments/${id}`);
    for (const m of html.matchAll(/href="\/documents\/(\d+)"/g)) documents.add(Number(m[1]));
    const pages = [...html.matchAll(/[?&]amp;page=(\d+)|[?&]page=(\d+)/g)].map((m) => Number(m[1] ?? m[2]));
    pagesPerDepartment[id] = Math.max(1, ...pages);
  }
  const docs = [];
  for (const id of [...documents].slice(0, 120)) {
    const html = await get(`/documents/${id}`);
    const download = /href="(\/api\/documents\/\d+\/files\/\d+\/download)"/.exec(html)?.[1];
    const image = /src="(\/api\/documents\/\d+\/versions\/\d+\/pages\/\d+\/image)\?/.exec(html)?.[1];
    docs.push({ id, download, image });
  }
  const upload = await get('/upload');
  const optionValues = (name) => {
    const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(upload)?.[1] ?? '';
    return [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  };
  return { departments, pagesPerDepartment, docs, uploadDepartments: optionValues('department'), uploadCategories: optionValues('category') };
}

// ------------------------------------------------------------ operations

const results = [];
const leaks = [];
// Positive control: responses to the administrator that did contain
// confidential documents while the employees were running.
const control = { requests: 0, withConfidential: 0 };

/** Reads one value from deploy/dev/.env without printing anything. */
function devEnv(name) {
  const text = readFileSync(join(here, '..', '..', 'deploy', 'dev', '.env'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : null;
}

function checkHtml(vu, others, op, body) {
  if (body.includes('LTCONF')) leaks.push({ op, vu: vu.username, kind: 'confidential marker' });
  // The page header (account menu) shows only the signed-in person. Other
  // employees' names may legitimately appear in the page body (uploader of
  // a general document), so only the header is compared.
  const header = body.slice(body.indexOf('<header'), body.indexOf('</header>'));
  if (!header.includes(vu.fullName)) leaks.push({ op, vu: vu.username, kind: 'own name missing from header' });
  for (const other of others) {
    if (other !== vu && header.includes(other.fullName)) {
      leaks.push({ op, vu: vu.username, kind: `name of ${other.username}` });
      break;
    }
  }
}

async function timed(vu, op, stage, request, check) {
  const started = performance.now();
  let status = 0;
  let bytes = 0;
  let error = null;
  try {
    const response = await request();
    status = response.status;
    const buffer = Buffer.from(await response.arrayBuffer());
    bytes = buffer.length;
    if (status >= 300 && status < 400) error = `redirect ${response.headers.get('location')}`;
    else if (status >= 400) error = `HTTP ${status}`;
    else if (check) {
      // The portal's error boundary can answer 200 once streaming started.
      if (buffer.includes('Something went wrong')) error = 'error page (HTTP 200)';
      else check(buffer);
    }
  } catch (caught) {
    error = caught.cause?.code ?? caught.message;
  }
  results.push({ op, stage, ms: performance.now() - started, status, bytes, error, at: Date.now() });
}

function operations(vus, targets) {
  const page = (vu, path, op, stage) =>
    timed(vu, op, stage, () => fetch(`${PORTAL}${path}`, { headers: { Cookie: vu.cookie }, redirect: 'manual' }), (buffer) =>
      checkHtml(vu, vus, op, buffer.toString('utf8')));
  const query = () => {
    const kind = weighted({ common: 40, medium: 35, rare: 15, none: 5, two: 5 });
    return kind === 'two' ? `${pick(WORDS.common)} ${pick(WORDS.medium)}` : pick(WORDS[kind]);
  };
  return {
    home: (vu, stage) => page(vu, '/', 'home', stage),
    department: (vu, stage) => {
      const id = pick(targets.departments);
      return page(vu, `/departments/${id}`, 'department', stage);
    },
    departmentDeep: (vu, stage) => {
      const id = pick(targets.departments);
      const last = targets.pagesPerDepartment[id] ?? 1;
      return page(vu, `/departments/${id}?page=${1 + Math.floor(random() * last)}`, 'departmentDeep', stage);
    },
    search: (vu, stage) => page(vu, `/search?q=${encodeURIComponent(query())}`, 'search', stage),
    searchDepartment: (vu, stage) =>
      page(vu, `/departments/${pick(targets.departments)}?q=${encodeURIComponent(query())}`, 'searchDepartment', stage),
    document: async (vu, stage) => {
      const doc = pick(targets.docs);
      await page(vu, `/documents/${doc.id}`, 'document', stage);
      if (doc.image) {
        await timed(vu, 'pageImage', stage, () =>
          fetch(`${PORTAL}${doc.image}?width=1200`, { headers: { Cookie: vu.cookie }, redirect: 'manual' }));
      }
    },
    download: (vu, stage) => {
      const doc = pick(targets.docs.filter((d) => d.download));
      return timed(vu, 'download', stage, () => fetch(`${PORTAL}${doc.download}`, { headers: { Cookie: vu.cookie }, redirect: 'manual' }));
    },
    upload: (vu, stage) => {
      // 1 in 10 uploads is a 5 MB file, the rest ~60 KB.
      const large = random() < 0.1;
      const text = `LTUP ${randomBytes(4).toString('hex')} ${pick(WORDS.common)} ${pick(WORDS.medium)}`;
      const file = makePdf(text, large ? 5 * 1024 * 1024 : 60 * 1024);
      const operationId = randomBytes(16).toString('hex');
      const form = new FormData();
      form.append('operation_id', operationId);
      form.append('label', text);
      form.append('department', pick(targets.uploadDepartments));
      form.append('category', pick(targets.uploadCategories));
      form.append('file', new Blob([file], { type: 'application/pdf' }), `${text.replace(/ /g, '_')}.pdf`);
      return timed(vu, large ? 'upload5MB' : 'upload60KB', stage, () =>
        fetch(`${PORTAL}/api/upload`, {
          method: 'POST',
          body: form,
          redirect: 'manual',
          headers: { Cookie: vu.cookie, Origin: PORTAL, 'X-Upload-Operation': operationId },
        }));
    },
  };
}

// ------------------------------------------------------------ main

async function main() {
  mkdirSync(stateDir, { recursive: true });
  const { password } = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
  const maxVus = Math.max(...STAGES);
  if (maxVus > 60) throw new Error('At most 60 synthetic accounts exist (lt_emp_001..060).');
  portalPid = await findPortalPid();
  const environment = await describeEnvironment();
  console.log(`Code ${environment.commit}${environment.dirty ? ' (uncommitted changes)' : ''}; Mayan ${environment.mayan.gunicornWorkers} web workers, ${environment.mayan.memLimitMiB} MiB; ${environment.dataset?.documents} documents; original Mayan containers running: ${environment.originalMayanRunning.join(', ') || 'none'}`);

  // Login burst: LOGIN_BURST employees sign in at the same moment
  // (start of a shift). Measured separately; it is CPU-bound in Mayan
  // (password hashing).
  console.log(`Signing in ${maxVus} synthetic employees (burst of ${Math.min(LOGIN_BURST, maxVus)})...`);
  const vus = [];
  const loginTimes = [];
  const names = Array.from({ length: maxVus }, (_, i) => `lt_emp_${String(i + 1).padStart(3, '0')}`);
  for (let i = 0; i < names.length; i += LOGIN_BURST) {
    const batch = names.slice(i, i + LOGIN_BURST);
    const signed = await Promise.all(batch.map((username) => signIn(username, password).then((r) => ({ username, ...r }))));
    for (const s of signed) {
      loginTimes.push({ ms: s.ms, ok: Boolean(s.cookie), status: s.status, burst: i === 0 });
      if (!s.cookie) throw new Error(`Sign-in failed for ${s.username} (HTTP ${s.status}).`);
      vus.push({ username: s.username, cookie: s.cookie, fullName: `Load Test ${s.username.slice(-3)}`, random: mulberry32(SEED * 1000 + vus.length + 1) });
    }
  }

  // Administrator who opens confidential documents during every stage.
  const admin = await signIn('dev_admin', devEnv('RECAFCO_DEV_PASSWORD_ADMIN'));
  if (!admin.cookie) throw new Error('dev_admin could not sign in (run "recafco_dev users").');
  const adminSearch = await (await fetch(`${PORTAL}/search?q=LTCONF`, { headers: { Cookie: admin.cookie } })).text();
  const confidentialIds = [...new Set([...adminSearch.matchAll(/href="\/documents\/(\d+)"/g)].map((m) => Number(m[1])))];
  console.log(`  administrator sees ${confidentialIds.length} confidential documents on the first search page`);

  console.log('Discovering departments, documents and files...');
  const targets = await discover(vus[0]);
  console.log(`  ${targets.departments.length} departments, ${targets.docs.length} documents, ${targets.uploadDepartments.length}/${targets.uploadCategories.length} upload options`);
  const ops = operations(vus, targets);

  let currentStage = 'idle';
  await sampleResources('idle-before');
  const sampler = setInterval(() => sampleResources(currentStage).catch(() => {}), 5000);

  for (const concurrency of STAGES) {
    currentStage = `c${concurrency}`;
    const stage = currentStage;
    const stopAt = Date.now() + STAGE_SECONDS * 1000;
    process.stdout.write(`Stage ${stage}: ${concurrency} VUs for ${STAGE_SECONDS}s... `);
    const before = results.length;
    const adminLoop = (async () => {
      while (Date.now() < stopAt) {
        // Not part of the measured workload: uses its own unseeded choices.
        const path = Math.random() < 0.5 || !confidentialIds.length ? '/search?q=LTCONF' : `/documents/${confidentialIds[Math.floor(Math.random() * confidentialIds.length)]}`;
        try {
          const response = await fetch(`${PORTAL}${path}`, { headers: { Cookie: admin.cookie }, redirect: 'manual' });
          const body = await response.text();
          control.requests += 1;
          if (body.includes('LTCONF')) control.withConfidential += 1;
          else {
            const kind = response.status !== 200 ? `HTTP ${response.status} ${response.headers.get('location') ?? ''}`.trim()
              : body.includes('Something went wrong') ? 'error page' : `200 without marker (${path.split('?')[0]})`;
            control.other = control.other ?? {};
            control.other[kind] = (control.other[kind] ?? 0) + 1;
          }
        } catch (caught) {
          control.failed = (control.failed ?? 0) + 1;
          control.lastFailure = caught.cause?.code ?? caught.message;
        }
        await sleep(250);
      }
    })();
    await Promise.all(
      vus.slice(0, concurrency).map(async (vu) => {
        while (Date.now() < stopAt) {
          // All random choices of an operation happen synchronously when it
          // starts, so switching to this VU's own stream here is safe.
          random = vu.random;
          await ops[weighted(MIX)](vu, stage);
          random = vu.random;
          if (THINK_MS) await sleep(THINK_MS * (0.5 + random()));
        }
      }),
    );
    await adminLoop;
    const done = results.slice(before);
    const errors = done.filter((r) => r.error).length;
    console.log(`${done.length} requests, ${errors} errors`);
  }
  currentStage = 'cooldown';
  clearInterval(sampler);
  await sampleResources('after');

  writeReport({ vus: vus.length, targets, loginTimes, environment });
}

function summarize(rows) {
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const errors = rows.filter((r) => r.error);
  return {
    n: rows.length,
    errors: errors.length,
    errorRate: rows.length ? errors.length / rows.length : 0,
    p50: Math.round(percentile(ms, 50) ?? 0),
    p95: Math.round(percentile(ms, 95) ?? 0),
    p99: Math.round(percentile(ms, 99) ?? 0),
    max: Math.round(ms.at(-1) ?? 0),
    errorKinds: [...new Set(errors.map((e) => e.error))].slice(0, 5),
  };
}

function writeReport(meta) {
  const stages = [...new Set(results.map((r) => r.stage))];
  const ops = [...new Set(results.map((r) => r.op))].sort();
  const table = {};
  for (const stage of stages) {
    const rows = results.filter((r) => r.stage === stage);
    const seconds = (Math.max(...rows.map((r) => r.at)) - Math.min(...rows.map((r) => r.at - r.ms))) / 1000;
    const stageSamples = samples.filter((s) => s.stage === stage);
    const stat = (get) => {
      const values = stageSamples.map(get).filter((v) => typeof v === 'number' && !Number.isNaN(v));
      return values.length ? { avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), max: Math.round(Math.max(...values)) } : null;
    };
    const backlogTotal = (s) => (s.backlog ? Object.values(s.backlog).reduce((a, b) => a + b, 0) : null);
    table[stage] = {
      throughputRps: Math.round((rows.length / seconds) * 10) / 10,
      all: summarize(rows),
      byOp: Object.fromEntries(ops.map((op) => [op, summarize(rows.filter((r) => r.op === op))]).filter(([, v]) => v.n)),
      resources: {
        mayanCpu: stat((s) => s.containers.app?.cpu),
        mayanMemMiB: stat((s) => s.containers.app?.memMiB),
        postgresCpu: stat((s) => s.containers.postgresql?.cpu),
        postgresMemMiB: stat((s) => s.containers.postgresql?.memMiB),
        portalCpu: stat((s) => s.portal?.cpu),
        portalMemMiB: stat((s) => s.portal?.memMiB),
        backlogTasks: stat(backlogTotal),
        backlogEnd: stageSamples.at(-1)?.backlog ?? null,
        // Original Mayan (observed only), summed over its containers.
        originalMayanCpu: stat((s) => (Object.keys(s.background ?? {}).length ? Object.values(s.background).reduce((a, b) => a + b.cpu, 0) : undefined)),
        originalMayanMemMiB: stat((s) => (Object.keys(s.background ?? {}).length ? Object.values(s.background).reduce((a, b) => a + b.memMiB, 0) : undefined)),
      },
    };
  }
  const login = summarize(meta.loginTimes.filter((l) => l.burst).map((l) => ({ ms: l.ms, error: l.ok ? null : `HTTP ${l.status}` })));
  const report = {
    label: LABEL,
    seed: SEED,
    environment: meta.environment,
    portal: PORTAL,
    mix: MIX_NAME,
    weights: MIX,
    thinkMs: THINK_MS,
    stageSeconds: STAGE_SECONDS,
    stages: STAGES,
    virtualUsers: meta.vus,
    targets: { departments: meta.targets.departments.length, documents: meta.targets.docs.length },
    loginBurst: { size: Math.min(LOGIN_BURST, meta.vus), ...login },
    leaks: leaks.slice(0, 50),
    confidentialControl: control,
    leakCount: leaks.length,
    table,
    samples,
  };
  const file = join(stateDir, `result-${LABEL}.json`);
  if (existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
  writeFileSync(file, JSON.stringify(report, null, 1), { flag: 'wx' });

  console.log(`\nLogin burst (${report.loginBurst.size} at once): p50 ${login.p50} ms, p95 ${login.p95} ms, errors ${login.errors}`);
  console.log(`Leak checks: ${leaks.length === 0 ? 'none found' : `${leaks.length} FOUND`} (administrator saw confidential documents in ${control.withConfidential}/${control.requests} concurrent responses)`);
  for (const [stage, data] of Object.entries(table)) {
    const r = data.resources;
    console.log(`\n${stage}: ${data.throughputRps} req/s, all p50 ${data.all.p50} ms p95 ${data.all.p95} ms, errors ${(data.all.errorRate * 100).toFixed(1)}%`);
    console.log(`  CPU% mayan ${r.mayanCpu?.avg}/${r.mayanCpu?.max} pg ${r.postgresCpu?.avg}/${r.postgresCpu?.max} portal ${r.portalCpu?.avg}/${r.portalCpu?.max}; mem MiB mayan ${r.mayanMemMiB?.max} pg ${r.postgresMemMiB?.max} portal ${r.portalMemMiB?.max}; backlog ${r.backlogTasks?.avg}/${r.backlogTasks?.max}`);
    for (const [op, s] of Object.entries(data.byOp)) {
      console.log(`  ${op.padEnd(17)} n=${String(s.n).padStart(5)} p50=${String(s.p50).padStart(6)} p95=${String(s.p95).padStart(6)} max=${String(s.max).padStart(6)} err=${s.errors}${s.errorKinds.length ? ` (${s.errorKinds.join('; ')})` : ''}`);
    }
  }
  console.log(`\nWritten: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
