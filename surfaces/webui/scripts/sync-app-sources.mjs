#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const webuiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(webuiRoot, 'apps');
const cacheRoot = path.join(webuiRoot, '.cowd', 'app-source-cache');
const stagedRoot = path.join(webuiRoot, '.cowd', 'apps');
const generatedPath = path.join(webuiRoot, 'src', 'apps.generated.ts');
const requested = (process.env.COWD_WEBUI_APPS || 'mfg').split(',').map((value) => value.trim()).filter(Boolean);
const enabled = new Set(requested);
const offline = process.env.COWD_WEBUI_OFFLINE === '1';
const lockPath = path.join(webuiRoot, '.cowd', 'app-source-sync.lock');

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, ...options }).trim();
}

function fail(message) {
  process.stderr.write(`cowd app source sync: ${message}\n`);
  process.exit(1);
}

function lockFor(appId) {
  const lockPath = path.join(appRoot, appId, 'source.lock.json');
  if (!existsSync(lockPath)) fail(`missing source lock for ${appId}`);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.app_id !== appId || !/^https:\/\//.test(lock.repository || '') || !/^[0-9a-f]{40}$/i.test(lock.revision || '') || !lock.package || !lock.module) {
    fail(`invalid immutable source lock for ${appId}`);
  }
  return lock;
}

function stage(lock) {
  const cache = path.join(cacheRoot, `${lock.app_id}.git`);
  mkdirSync(cacheRoot, { recursive: true });
  if (!existsSync(cache)) {
    if (offline) fail(`offline cache has no source for ${lock.app_id}; set COWD_WEBUI_APPS=none for a core-only build`);
    run('git', ['clone', '--bare', '--filter=blob:none', lock.repository, cache]);
  }
  if (!offline) {
    try {
      run('git', ['--git-dir', cache, 'fetch', '--depth=1', 'origin', lock.revision]);
    } catch (error) {
      fail(`cannot fetch ${lock.app_id} locked revision ${lock.revision}; set COWD_WEBUI_APPS=none for a core-only build`);
    }
  }
  let resolved = '';
  try {
    resolved = run('git', ['--git-dir', cache, 'rev-parse', `${lock.revision}^{commit}`]);
  } catch {
    fail(`${offline ? 'offline cache' : 'source cache'} lacks locked revision ${lock.revision} for ${lock.app_id}`);
  }
  if (resolved !== lock.revision) fail(`source revision mismatch for ${lock.app_id}: expected ${lock.revision}, got ${resolved}`);
  const destination = path.join(stagedRoot, lock.app_id);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  // Stage the immutable APP checkout, not only its WebUI directory. Edge's
  // cross-surface acceptance gates must inspect the same locked APP backend
  // source without falling back to a mutable sibling worktree.
  const archive = execFileSync(
    'git',
    ['--git-dir', cache, 'archive', '--format=tar', lock.revision],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const tar = execFileSync('tar', ['-x', '-C', destination], { input: archive });
  if (tar?.length) fail(`cannot unpack ${lock.app_id} source`);
  const entry = path.join(destination, lock.package, 'src', 'index.ts');
  if (!existsSync(entry)) fail(`${lock.app_id} package has no src/index.ts entry`);
  return { ...lock, staged: path.relative(webuiRoot, entry).replace(/\\/g, '/') };
}

let lockFd;
try {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  lockFd = openSync(lockPath, 'wx');
} catch {
  fail('another app source synchronization is active; retry after it exits');
}
try {
  const contributions = [];
  if (!enabled.has('none')) {
    for (const appId of enabled) contributions.push(stage(lockFor(appId)));
  }
  const imports = contributions.map((entry, index) => `import { ${entry.app_id}WebUiContribution as app${index} } from '${entry.module}';`).join('\n');
  const values = contributions.map((_, index) => `app${index}`).join(', ');
  writeFileSync(generatedPath, `/* 由 scripts/sync-app-sources.mjs 生成；不要手改。 */\n${imports}\n\nexport const appContributions = [${values}];\n`);
  process.stdout.write(JSON.stringify({ status: 'ok', offline, apps: contributions.map(({ app_id, revision, staged }) => ({ app_id, revision, staged })) }) + '\n');
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  rmSync(lockPath, { force: true });
}
