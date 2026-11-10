import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3107';
const portalRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(portalRoot, '..');

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status < 500;
  } catch {
    return false;
  }
}

let child: ChildProcess | null = null;

export async function setup() {
  // 1. The isolated dev Mayan must be up.
  if (!(await reachable('http://127.0.0.1:8091/api/v4/'))) {
    throw new Error('Dev Mayan is not reachable on 127.0.0.1:8091. Start deploy/dev first (see README).');
  }

  // 2. Reset the three dev users (passwords, groups, active flag).
  execFileSync(
    'docker',
    [
      'compose', '--project-name', 'recafco-dms-dev', '--file', path.join(repoRoot, 'deploy', 'dev', 'compose.yaml'),
      'exec', '-T', '--user', 'mayan', 'app', '/opt/mayan-edms/bin/mayan-edms.py', 'recafco_dev', 'users',
    ],
    { stdio: 'ignore' },
  );

  // 3. Start the production build of the portal unless one is running.
  if (await reachable(`${PORTAL}/login`)) return;
  if (!existsSync(path.join(portalRoot, '.next', 'BUILD_ID'))) {
    throw new Error('No portal build found. Run "npm run build" in portal/ first.');
  }
  const port = new URL(PORTAL).port || '3107';
  child = spawn(
    process.execPath,
    [path.join(portalRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', port, '-H', '127.0.0.1'],
    { cwd: portalRoot, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } },
  );
  const started = Date.now();
  while (!(await reachable(`${PORTAL}/login`))) {
    if (Date.now() - started > 60_000) throw new Error('Portal did not start within 60 s.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function teardown() {
  child?.kill();
}
