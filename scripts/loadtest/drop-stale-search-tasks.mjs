#!/usr/bin/env node
/*
 * DEV STACK ONLY. Removes queued search-index tasks whose object no longer
 * exists from the dev Redis broker (queue "search").
 *
 * Why: permanently deleting a document makes Mayan queue index tasks for the
 * document, its files, versions and pages. A task whose object is gone is
 * retried up to 40 times with back-off up to 60 s (Mayan's
 * task_index_instance), i.e. for about 35 minutes. Between retries the
 * worker HOLDS the task (Redis hash "unacked"), so the queue looks empty
 * while work is still pending. That contaminated a measurement once (see
 * docs/performance-report.md).
 *
 *   node drop-stale-search-tasks.mjs                    # queue only
 *   node drop-stale-search-tasks.mjs --restore-unacked  # app container
 *       must be STOPPED: first hands every held task back to its queue
 *       (what Celery does after its 1-hour visibility timeout), then drops
 *       the stale ones.
 *
 * Existence is checked in the dev PostgreSQL directly (read-only SELECTs),
 * so it works while the app container is stopped.
 */
import { execFileSync } from 'node:child_process';

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const docker = (args, options = {}) =>
  execFileSync('docker', args, { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, ...options });
const redis = (...args) => docker(['exec', '-i', 'recafco-dms-dev-redis-1', 'redis-cli', '-n', '0', ...args]);
const resp = (...parts) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
const pipe = (commands) => {
  if (commands.length) docker(['exec', '-i', 'recafco-dms-dev-redis-1', 'redis-cli', '-n', '0', '--pipe'], { input: commands.join(''), stdio: ['pipe', 'ignore', 'ignore'] });
};

if (process.argv.includes('--restore-unacked')) {
  const running = docker(['inspect', '-f', '{{.State.Running}}', 'recafco-dms-dev-app-1']).trim();
  if (running !== 'false') {
    console.error('Refusing to restore held tasks while the app container is running.');
    process.exit(2);
  }
  // HGETALL --raw prints field and value on alternate lines.
  const lines = redis('--raw', 'hgetall', 'unacked').split('\n').filter((l) => l !== '');
  const commands = [];
  for (let i = 1; i < lines.length; i += 2) {
    const [message, , routingKey] = JSON.parse(lines[i]);
    commands.push(resp('LPUSH', routingKey, JSON.stringify(message)));
  }
  commands.push(resp('DEL', 'unacked', 'unacked_index', 'unacked_mutex'));
  pipe(commands);
  console.log(`held tasks returned to their queues: ${commands.length - 1}`);
}

const raw = redis('lrange', 'search', '0', '-1').trim();
const messages = raw ? raw.split('\n') : [];
const targets = new Map();
for (const message of messages) {
  try {
    const parsed = JSON.parse(message);
    if (!parsed.headers?.task?.endsWith('task_index_instance')) continue;
    const kwargs = JSON.parse(Buffer.from(parsed.body, 'base64').toString())[1] ?? {};
    if (/^[a-z_]+$/.test(kwargs.app_label ?? '') && /^[a-z_]+$/.test(kwargs.model_name ?? '') && Number.isInteger(Number(kwargs.object_id))) {
      targets.set(message, `${kwargs.app_label}_${kwargs.model_name}|${Number(kwargs.object_id)}`);
    }
  } catch { /* leave anything unexpected in the queue */ }
}

const byTable = new Map();
for (const key of new Set(targets.values())) {
  const [table, id] = key.split('|');
  if (!byTable.has(table)) byTable.set(table, new Set());
  byTable.get(table).add(id);
}
const existing = new Set();
for (const [table, ids] of byTable) {
  const sql = `select id from ${table} where id in (${[...ids].join(',')})`;
  const out = docker(['exec', 'recafco-dms-dev-postgresql-1', 'psql', '-U', 'mayan', '-d', 'mayan', '-Atc', sql]);
  for (const id of out.split('\n').filter(Boolean)) existing.add(`${table}|${id.trim()}`);
}
const stale = [...targets.entries()].filter(([, key]) => !existing.has(key)).map(([message]) => message);
pipe(stale.map((message) => resp('LREM', 'search', '1', message)));
console.log(`queued search tasks: ${messages.length}; for deleted objects: ${stale.length} removed; remaining: ${redis('llen', 'search').trim()}`);
