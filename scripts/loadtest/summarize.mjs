#!/usr/bin/env node
/*
 * Prints Markdown tables from one or more load test result files
 * (scripts/loadtest/.state/result-*.json written by run.mjs).
 *
 *   node scripts/loadtest/summarize.mjs scripts/loadtest/.state/result-<label>.json [...]
 */
import { readFileSync } from 'node:fs';

const fmt = (v) => (v === null || v === undefined ? '–' : String(v));
const pct = (v) => `${(v * 100).toFixed(1)}%`;

for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n### ${r.label} (mix: ${r.mix}, think time ${r.thinkMs} ms, ${r.stageSeconds} s per stage)\n`);
  const e = r.environment;
  if (e) {
    console.log(`Code ${e.commit}${e.dirty ? ' + uncommitted changes' : ''}; seed ${r.seed}; Mayan ${e.mayan?.gunicornWorkers} web workers, ${e.mayan?.memLimitMiB} MiB; dataset ${e.dataset?.documents} documents (${e.dataset?.documents_waiting_for_pages} waiting for pages); original Mayan running: ${e.originalMayanRunning?.length ? e.originalMayanRunning.join(', ') : 'no'}.`);
  }
  console.log(`Login burst: ${r.loginBurst.size} sign-ins at once, p50 ${r.loginBurst.p50} ms, p95 ${r.loginBurst.p95} ms, errors ${r.loginBurst.errors}.`);
  console.log(`Leak checks: ${r.leakCount} found; administrator received confidential documents in ${r.confidentialControl?.withConfidential}/${r.confidentialControl?.requests} concurrent responses.\n`);
  console.log('| VUs | req/s | p50 ms | p95 ms | p99 ms | errors | Mayan CPU avg/max % | Postgres CPU avg/max % | Portal CPU avg/max % | Mayan mem max MiB | Portal mem max MiB | Backlog tasks avg/max | Original Mayan CPU avg/max %, mem MiB |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [stage, d] of Object.entries(r.table)) {
    const x = d.resources;
    const pair = (s) => (s ? `${s.avg}/${s.max}` : '–');
    console.log(`| ${stage.slice(1)} | ${d.throughputRps} | ${d.all.p50} | ${d.all.p95} | ${d.all.p99} | ${pct(d.all.errorRate)} | ${pair(x.mayanCpu)} | ${pair(x.postgresCpu)} | ${pair(x.portalCpu)} | ${fmt(x.mayanMemMiB?.max)} | ${fmt(x.portalMemMiB?.max)} | ${pair(x.backlogTasks)} | ${x.originalMayanCpu ? `${pair(x.originalMayanCpu)}, ${x.originalMayanMemMiB?.max}` : 'not running'} |`);
  }
  const ops = [...new Set(Object.values(r.table).flatMap((d) => Object.keys(d.byOp)))].sort();
  const stages = Object.keys(r.table);
  console.log(`\np50 / p95 in ms per operation:\n`);
  console.log(`| Operation | ${stages.map((s) => `${s.slice(1)} VUs`).join(' | ')} |`);
  console.log(`| --- | ${stages.map(() => '---').join(' | ')} |`);
  for (const op of ops) {
    const cells = stages.map((s) => {
      const o = r.table[s].byOp[op];
      return o ? `${o.p50} / ${o.p95}${o.errors ? ` (${o.errors} err)` : ''}` : '–';
    });
    console.log(`| ${op} | ${cells.join(' | ')} |`);
  }
}
