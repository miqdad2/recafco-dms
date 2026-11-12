#!/usr/bin/env node
/*
 * DEV STACK ONLY, read-only. Watches Mayan's search-index tasks after a
 * deletion and tells DISTINCT tasks apart from RETRIES.
 *
 * Every sample reads the "search" queue and the tasks held by workers
 * (Redis hash "unacked": running, prefetched or waiting for a retry). A
 * Celery task keeps its ID across retries and carries its retry number in
 * the message headers, so:
 *   distinct tasks  = distinct task IDs seen,
 *   attempts        = sum over IDs of (highest retry number seen + 1).
 * Each task's target (app, model, ID) is checked in the dev database.
 *
 *   node scripts/loadtest/watch-index-tasks.mjs --seconds 600 --label before
 * Writes scripts/loadtest/.state/index-tasks-<label>-<timestamp>.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
const seconds = Number(args.seconds ?? 600);
const interval = Number(args.interval ?? 10);
const label = args.label ?? 'watch';
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const docker = (a) => execFileSync('docker', a, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
const redis = (...a) => docker(['exec', 'recafco-dms-dev-redis-1', 'redis-cli', '-n', '0', ...a]);

function readMessages() {
  const queued = redis('lrange', 'search', '0', '-1').split('\n').filter(Boolean).map((m) => ({ where: 'queued', m }));
  const lines = redis('--raw', 'hgetall', 'unacked').split('\n').filter((l) => l !== '');
  const held = [];
  for (let i = 1; i < lines.length; i += 2) {
    const [message, , routingKey] = JSON.parse(lines[i]);
    if (routingKey === 'search') held.push({ where: 'held', m: JSON.stringify(message) });
  }
  return [...queued, ...held];
}

const exists = new Map();
function existing(keys) {
  const byTable = new Map();
  for (const key of keys) {
    if (exists.has(key)) continue;
    const [table, id] = key.split('|');
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table).push(id);
  }
  for (const [table, ids] of byTable) {
    const found = new Set(docker(['exec', 'recafco-dms-dev-postgresql-1', 'psql', '-U', 'mayan', '-d', 'mayan', '-Atc', `select id from ${table} where id in (${ids.join(',')})`]).split('\n').filter(Boolean).map((s) => s.trim()));
    for (const id of ids) exists.set(`${table}|${id}`, found.has(id));
  }
}

const tasks = new Map(); // task id -> { target, maxRetries, firstSeen, lastSeen }
const timeline = [];
const started = Date.now();
for (;;) {
  const sample = { t: Math.round((Date.now() - started) / 1000), queued: 0, held: 0, retrying: 0 };
  for (const { where, m } of readMessages()) {
    let parsed;
    try { parsed = JSON.parse(m); } catch { continue; }
    if (!parsed.headers?.task?.endsWith('task_index_instance')) continue;
    const kwargs = JSON.parse(Buffer.from(parsed.body, 'base64').toString())[1] ?? {};
    if (!/^[a-z_]+$/.test(`${kwargs.app_label}${kwargs.model_name}`) || !Number.isInteger(Number(kwargs.object_id))) continue;
    const target = `${kwargs.app_label}_${kwargs.model_name}|${Number(kwargs.object_id)}`;
    const retries = Number(parsed.headers.retries ?? 0);
    sample[where] += 1;
    if (retries > 0) sample.retrying += 1;
    const task = tasks.get(parsed.headers.id) ?? { target, maxRetries: 0, firstSeen: sample.t };
    task.maxRetries = Math.max(task.maxRetries, retries);
    task.lastSeen = sample.t;
    tasks.set(parsed.headers.id, task);
  }
  existing([...new Set([...tasks.values()].map((t) => t.target))]);
  sample.distinctSoFar = tasks.size;
  timeline.push(sample);
  console.log(`${String(sample.t).padStart(5)} s  queued ${sample.queued}  held ${sample.held}  (retries among them ${sample.retrying})  distinct tasks so far ${tasks.size}`);
  if (Date.now() - started >= seconds * 1000) break;
  execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${interval * 1000})`]);
}

const all = [...tasks.values()];
const missing = all.filter((t) => exists.get(t.target) === false);
const present = all.filter((t) => exists.get(t.target) === true);
const summary = {
  label,
  watchedSeconds: seconds,
  distinctTasks: all.length,
  distinctTargets: new Set(all.map((t) => t.target)).size,
  tasksForDeletedObjects: missing.length,
  tasksForExistingObjects: present.length,
  attemptsSeen: all.reduce((n, t) => n + t.maxRetries + 1, 0),
  highestRetrySeen: Math.max(0, ...all.map((t) => t.maxRetries)),
  tasksStillPendingAtEnd: timeline.at(-1) ? timeline.at(-1).queued + timeline.at(-1).held : 0,
  byModel: Object.fromEntries([...new Set(all.map((t) => t.target.split('|')[0]))].map((m) => [m, all.filter((t) => t.target.startsWith(`${m}|`)).length])),
};
console.log(JSON.stringify(summary, null, 1));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(dirname(fileURLToPath(import.meta.url)), '.state', `index-tasks-${label}-${stamp}.json`);
if (existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
writeFileSync(file, JSON.stringify({ summary, timeline, tasks: Object.fromEntries(tasks) }, null, 1), { flag: 'wx' });
console.log(`Written: ${file}`);
