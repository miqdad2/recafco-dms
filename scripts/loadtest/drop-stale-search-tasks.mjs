#!/usr/bin/env node
/*
 * DEV STACK ONLY. Removes queued search-index tasks whose object no longer
 * exists from the dev Redis broker (queue "search").
 *
 * Why: permanently deleting a document makes Mayan queue ~20
 * task_index_instance tasks per document (document, files, versions,
 * pages). Each still runs, at full cost, against an object that is gone.
 * After prepare.sh removes a run's uploads, ~100 deleted documents left
 * ~4,000 such tasks, which took hours to drain and would have overlapped
 * the next measurement. Tasks for objects that still exist are kept.
 *
 * Usage: node scripts/loadtest/drop-stale-search-tasks.mjs
 */
import { execFileSync } from 'node:child_process';

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const redis = (...args) =>
  execFileSync('docker', ['exec', '-i', 'recafco-dms-dev-redis-1', 'redis-cli', '-n', '0', ...args], {
    env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  });

const raw = redis('lrange', 'search', '0', '-1').trim();
const messages = raw ? raw.split('\n') : [];
const targets = new Map();
for (const message of messages) {
  try {
    const parsed = JSON.parse(message);
    if (!parsed.headers?.task?.endsWith('task_index_instance')) continue;
    const kwargs = JSON.parse(Buffer.from(parsed.body, 'base64').toString())[1] ?? {};
    if (kwargs.app_label && kwargs.model_name && kwargs.object_id !== undefined) {
      targets.set(message, [kwargs.app_label, kwargs.model_name, Number(kwargs.object_id)]);
    }
  } catch { /* leave anything unexpected in the queue */ }
}
const unique = [...new Map([...targets.values()].map((t) => [t.join('|'), t])).values()];
if (!unique.length) {
  console.log(`queued search tasks: ${messages.length}; none checked`);
  process.exit(0);
}
const output = execFileSync(
  'docker',
  ['exec', '-i', '-u', 'mayan', 'recafco-dms-dev-app-1', '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_loadtest', 'missing-objects'],
  { env, input: JSON.stringify(unique), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] },
);
const missing = new Set(JSON.parse(output.trim().split(/\r?\n/).at(-1)).missing.map((t) => t.join('|')));
const stale = [...targets.entries()].filter(([, t]) => missing.has(t.join('|'))).map(([m]) => m);

// LREM each stale message (exact match), sent as one RESP pipeline.
const resp = (...parts) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
if (stale.length) {
  execFileSync('docker', ['exec', '-i', 'recafco-dms-dev-redis-1', 'redis-cli', '-n', '0', '--pipe'], {
    env, input: stale.map((m) => resp('LREM', 'search', '1', m)).join(''), stdio: ['pipe', 'ignore', 'ignore'],
  });
}
console.log(`queued search tasks: ${messages.length}; for deleted objects: ${stale.length} removed; remaining: ${redis('llen', 'search').trim()}`);
