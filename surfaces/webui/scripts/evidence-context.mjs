import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
export const webuiRoot = path.resolve(scriptDir, '..');
export const frontendRoot = path.resolve(webuiRoot, '../..');
export const workspaceRoot = path.resolve(frontendRoot, '..');
const siblingBackend = path.join(workspaceRoot, 'cowd');
export const backendRoot = process.env.COWD_BACKEND_REPO
  || (fs.existsSync(path.join(siblingBackend, 'Cargo.toml'))
    ? siblingBackend
    : (() => { throw new Error(`Cowd backend repository is missing at ${siblingBackend}; set COWD_BACKEND_REPO explicitly`); })());
export const manifestPath = path.join(webuiRoot, 'evaluation/acceptance-manifest.json');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function cargoVersion(root) {
  const manifest = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
  const value = manifest.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
  if (!value) throw new Error(`workspace version is missing from ${root}/Cargo.toml`);
  return value;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`final evidence mode requires ${name}`);
  return value;
}

export function evidenceContext(scriptId, { final = process.argv.includes('--final') } = {}) {
  const detectedVersion = cargoVersion(frontendRoot);
  const detectedBackendVersion = cargoVersion(backendRoot);
  const detectedFrontendCommit = git(frontendRoot, 'rev-parse', 'HEAD');
  const detectedBackendCommit = git(backendRoot, 'rev-parse', 'HEAD');
  const frontendDirty = Boolean(git(frontendRoot, 'status', '--porcelain'));
  const backendDirty = Boolean(git(backendRoot, 'status', '--porcelain'));
  const planRoot = final
    ? path.resolve(requiredEnv('COWD_PLAN_ROOT'))
    : path.resolve(process.env.COWD_PLAN_ROOT || path.join(workspaceRoot, 'plan/0815-Cowd-APP统一Supervisor终态解耦'));
  const version = final ? requiredEnv('COWD_VERSION').replace(/^v/, '') : (process.env.COWD_VERSION || detectedVersion).replace(/^v/, '');
  const frontendCommit = final ? requiredEnv('COWD_FRONTEND_COMMIT') : (process.env.COWD_FRONTEND_COMMIT || detectedFrontendCommit);
  const backendCommit = final ? requiredEnv('COWD_BACKEND_COMMIT') : (process.env.COWD_BACKEND_COMMIT || detectedBackendCommit);
  if (version !== detectedVersion) throw new Error(`evidence version ${version} does not match frontend Cargo version ${detectedVersion}`);
  if (frontendCommit !== detectedFrontendCommit) throw new Error(`frontend evidence commit ${frontendCommit} does not match HEAD ${detectedFrontendCommit}`);
  if (backendCommit !== detectedBackendCommit) throw new Error(`backend evidence commit ${backendCommit} does not match HEAD ${detectedBackendCommit}`);
  if (final && (frontendDirty || backendDirty)) throw new Error(`final evidence requires clean worktrees; frontend_dirty=${frontendDirty} backend_dirty=${backendDirty}`);
  if (final && !fs.existsSync(manifestPath)) throw new Error(`acceptance manifest is missing: ${manifestPath}`);
  return {
    schema_version: 1,
    script_id: scriptId,
    final,
    version,
    plan_root: planRoot,
    manifest_path: manifestPath,
    frontend: {
      root: frontendRoot,
      branch: git(frontendRoot, 'branch', '--show-current'),
      commit: frontendCommit,
      version: detectedVersion,
      dirty: frontendDirty,
    },
    backend: {
      root: backendRoot,
      branch: git(backendRoot, 'branch', '--show-current'),
      commit: backendCommit,
      version: detectedBackendVersion,
      dirty: backendDirty,
    },
    generated_at: new Date().toISOString(),
  };
}

export function writeJsonReport(context, fileName, value) {
  const reportDir = path.join(context.plan_root, 'reports', context.version);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, fileName);
  fs.writeFileSync(reportPath, `${JSON.stringify({ provenance: context, ...value }, null, 2)}\n`);
  return reportPath;
}
