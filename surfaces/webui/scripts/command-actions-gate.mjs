#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const surfaceRoot = path.resolve(webuiRoot, '../..');
const workspaceRoot = path.resolve(surfaceRoot, '..');
const provenance = evidenceContext('command-actions-gate');
const planRoot = provenance.plan_root;
const reportDir = path.join(planRoot, 'reports', provenance.version);
const version = provenance.version;
const gate = process.argv.includes('--gate');

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const files = {
  client: path.join(webuiRoot, 'src/api/client.ts'),
  store: path.join(webuiRoot, 'src/stores/app.ts'),
  chat: path.join(webuiRoot, 'src/pages/ChatPage.vue'),
  tools: path.join(webuiRoot, 'src/pages/ToolsPage.vue'),
  capabilities: path.join(webuiRoot, 'src/data/capabilities.ts'),
};

const clientText = read(files.client);
const storeText = read(files.store);
const chatText = read(files.chat);
const toolsText = read(files.tools);
const capabilitiesText = read(files.capabilities);
const failures = [];
const legacyCommandsPath = `/api/${'commands'}`;

for (const required of [
  "commands: (surface = 'webui')",
  'resolveCommand:',
  "'/api/slash/resolve'",
  'executeCommand:',
  "'/api/slash/dispatch'",
]) {
  if (!clientText.includes(required)) failures.push(`client missing ${required}`);
}

if (clientText.includes(legacyCommandsPath)) failures.push(`client still references legacy ${legacyCommandsPath}`);

if (!storeText.includes('api.resolveCommand(command')) failures.push('store executeCommand does not resolve before execute');
if (!storeText.includes('api.executeCommand(resolvedCommand')) failures.push('store executeCommand does not execute resolved command');
if (!toolsText.includes('api.resolveCommand(selectedCommand.value')) failures.push('ToolsPage command execution does not resolve before execute');
if (!toolsText.includes('api.executeCommand(resolvedCommand')) failures.push('ToolsPage command execution does not execute resolved command');
if (!chatText.includes('store.commands')) failures.push('chat command modal does not use command registry state');
if (!toolsText.includes('api.commands()')) failures.push('ToolsPage does not load command registry projection');

for (const [label, text] of [['store', storeText], ['ToolsPage', toolsText]]) {
  const executeCount = (text.match(/api\.executeCommand\(/g) || []).length;
  const resolveCount = (text.match(/api\.resolveCommand\(/g) || []).length;
  if (executeCount > resolveCount) {
    failures.push(`${label} has api.executeCommand calls without matching resolveCommand coverage`);
  }
}

const commandActionFiles = [storeText, chatText].join('\n');
for (const endpoint of ['/api/runtime', '/api/skills', '/api/tools', '/api/cross-plane', '/api/matrix', '/api/apps/mfg']) {
  if (commandActionFiles.includes(`'${endpoint}`) || commandActionFiles.includes(`"${endpoint}`)) {
    failures.push(`command action surface hardcodes endpoint ${endpoint}`);
  }
}

if (!capabilitiesText.includes('/api/tools')) {
  failures.push('capabilities matrix no longer documents page endpoint coverage');
}

const report = {
  provenance,
  version,
  generated_at: new Date().toISOString(),
  status: failures.length ? 'fail' : 'pass',
  scope: 'command action flow must use slash registry, resolve, and dispatch; static capabilities remain page coverage metadata only',
  failures,
};

fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${version}-command-actions-gate.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`Command actions gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  if (gate) process.exit(1);
}

console.log(`Command actions gate written to ${reportPath}`);
