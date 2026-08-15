#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { evidenceContext } from './evidence-context.mjs';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const separator = process.argv.indexOf('--');
const name = option('--name').trim();
const cwdOption = option('--cwd', 'webui').trim();
const dataSource = option('--data-source', name).trim();
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
const optionArgs = process.argv.slice(2, separator >= 0 ? separator : undefined);
const claims = optionArgs.flatMap((value, index) => value === '--claim' ? [optionArgs[index + 1]] : [])
  .filter((value) => typeof value === 'string' && value.length > 0);

if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  throw new Error('--name must be a lowercase evidence identifier');
}
if (claims.some((claim) => !/^[a-z0-9][a-z0-9:._-]*$/.test(claim))) {
  throw new Error('--claim must be a stable lowercase evidence identifier');
}
if (!command.length) throw new Error('record-evidence-command requires a command after --');

const context = evidenceContext('record-evidence-command', { final: true });
const cwdAliases = {
  frontend: context.frontend.root,
  backend: context.backend.root,
  webui: path.join(context.frontend.root, 'surfaces/webui'),
};
const cwd = cwdAliases[cwdOption] || path.resolve(cwdOption);
const reportDir = path.join(context.plan_root, 'test-reports', context.version);
const logPath = path.join(reportDir, `${name}.log`);
const metadataPath = path.join(reportDir, `${name}.json`);
fs.mkdirSync(reportDir, { recursive: true });

const startedAt = new Date().toISOString();
const log = fs.createWriteStream(logPath, { flags: 'w' });
const child = spawn(command[0], command.slice(1), {
  cwd,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  log.write(chunk);
});

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
});
await new Promise((resolve) => log.end(resolve));

const finishedAt = new Date().toISOString();
const metadata = {
  schema_version: 1,
  name,
  status: exitCode === 0 ? 'passed' : 'failed',
  exit_code: exitCode,
  command,
  command_text: command.map((part) => JSON.stringify(part)).join(' '),
  cwd,
  data_source: dataSource,
  claims: Array.from(new Set(claims)).sort(),
  started_at: startedAt,
  finished_at: finishedAt,
  log_path: logPath,
  provenance: context,
};
fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Evidence command ${metadata.status}: ${metadataPath}`);
if (exitCode !== 0) process.exit(exitCode);
