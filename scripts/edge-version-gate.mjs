#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const edgeRoot = path.resolve(new URL('../', import.meta.url).pathname);
const expectedVersion = argValue('--version', process.env.COWD_EDGE_VERSION || '');
const coreRoot = path.resolve(argValue('--core', process.env.COWD_BACKEND_REPO || path.join(edgeRoot, '..', 'cowd-develop')));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

function workspaceVersion() {
  const text = fs.readFileSync(path.join(edgeRoot, 'Cargo.toml'), 'utf8');
  return text.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1] || '';
}

const findings = [];
if (!expectedVersion) {
  findings.push('expected version is required; pass --version <semver>');
}

if (!fs.existsSync(path.join(coreRoot, 'crates/surface/src/lib.rs'))) {
  findings.push(`core repository missing edge-compatible surface contract at ${coreRoot}`);
}

const workspace = workspaceVersion();
if (expectedVersion && workspace !== expectedVersion) {
  findings.push(`workspace version ${workspace || '<missing>'} != ${expectedVersion}`);
}

const manifestRoots = [
  path.join(edgeRoot, 'surfaces'),
  path.join(edgeRoot, 'connectors', 'message'),
  path.join(edgeRoot, 'connectors', 'source'),
  path.join(edgeRoot, 'connectors', 'automation'),
];
const manifests = manifestRoots.flatMap((root) => walk(root)).filter((file) => file.endsWith('surface.json'));
for (const manifestPath of manifests) {
  const manifest = readJson(manifestPath);
  const label = path.relative(edgeRoot, manifestPath);
  if (manifest.schema !== 'cowd.surface.v1') {
    findings.push(`${label}: schema ${manifest.schema || '<missing>'} != cowd.surface.v1`);
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    findings.push(`${label}: version ${manifest.version || '<missing>'} != ${expectedVersion}`);
  }
}

const readme = fs.existsSync(path.join(edgeRoot, 'README.md'))
  ? fs.readFileSync(path.join(edgeRoot, 'README.md'), 'utf8')
  : '';
if (expectedVersion && readme && !readme.includes(`当前版本：\`${expectedVersion}\``)) {
  findings.push(`README.md: current version line does not mention ${expectedVersion}`);
}

const report = {
  version: expectedVersion,
  generated_at: new Date().toISOString(),
  core_root: coreRoot,
  workspace_version: workspace,
  manifest_count: manifests.length,
  findings,
  status: findings.length ? 'fail' : 'pass',
};

console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exit(1);
