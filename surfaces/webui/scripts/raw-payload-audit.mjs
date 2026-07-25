#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { appWebUiPath, appWebUiSourceRoot } from './app-source-paths.mjs';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const surfaceRoot = path.resolve(webuiRoot, '../..');
const workspaceRoot = path.resolve(surfaceRoot, '..');
const provenance = evidenceContext('raw-payload-audit');
const planRoot = provenance.plan_root;
const reportDir = path.join(planRoot, 'reports', provenance.version);
const version = provenance.version;
const gate = process.argv.includes('--gate');

const allowTitleTerms = [
  'action',
  'audit',
  'collections',
  'config',
  'context',
  'detail',
  'evidence',
  'gateway',
  'ingest',
  'lease',
  'payload',
  'performance',
  'plan',
  'platform',
  'registry',
  'resolved',
  'result',
  'run',
  'summary',
  '证据',
  '调试',
  '详情',
  '载荷',
  '结果',
  '审计',
  '运行',
  '配置',
  '策略',
  '摘要',
  '状态',
  '报告',
];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function parseMessageCatalog(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const messages = new Map();
  const regex = /\s*"([^"]+)":\s*"((?:\\.|[^"])*)",?/g;
  let match;
  while ((match = regex.exec(text))) {
    try {
      messages.set(match[1], JSON.parse(`"${match[2]}"`));
    } catch {
      messages.set(match[1], match[2]);
    }
  }
  return messages;
}

const messageCatalogs = [
  parseMessageCatalog(path.join(webuiRoot, 'src/i18n/messages/en-US.ts')),
  parseMessageCatalog(path.join(webuiRoot, 'src/i18n/messages/zh-CN.ts')),
  parseMessageCatalog(appWebUiPath('mfg', 'messages.ts')),
];

function resolveMessage(key) {
  return messageCatalogs.map((catalog) => catalog.get(key)).filter(Boolean).join('\n');
}

function renderablePageEvidence(text) {
  const keys = new Set();
  const regex = /\bt[c]?\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(text))) keys.add(match[1]);
  return `${text}\n${Array.from(keys).map(resolveMessage).join('\n')}`;
}

function titleOf(tag) {
  const dynamicKey = tag.match(/\B:title=["']t\(\s*['"`]([^'"`]+)['"`]/)?.[1];
  if (dynamicKey) return resolveMessage(dynamicKey);
  const literal = tag.match(/\btitle=(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/)?.slice(1).find(Boolean);
  if (literal) return literal;
  return '';
}

const files = [
  ...walk(path.join(webuiRoot, 'src')),
  ...walk(appWebUiSourceRoot('mfg')),
].filter((file) => /\.(vue|ts)$/.test(file));
const entries = [];
const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(webuiRoot, file);
  if (relative.startsWith('src/pages/') && /<RawPayload\b/.test(text)) {
    failures.push(`${relative}: page renders RawPayload directly; use ObjectInspectorDrawer instead`);
  }
  const pageEvidence = renderablePageEvidence(text);
  const regex = /<ObjectInspectorDrawer\b[^>]*\/?>/g;
  let match;
  while ((match = regex.exec(text))) {
    const tag = match[0];
    const line = lineOf(text, match.index);
    const title = titleOf(tag);
    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const beforeEvidence = renderablePageEvidence(before);
    const nearestSection = before.match(/<h[23][^>]*>([^<]+)<\/h[23]>/g)?.pop()?.replace(/<[^>]+>/g, '') || '';
    const normalizedTitle = title.toLowerCase();
    const allowedByTitle = title && allowTitleTerms.some((term) => normalizedTitle.includes(term));
    const hasManagementCompanion = /DataTable|DetailPanel|RequestReceipt|GovernedActionPanel|EndpointHealthList|TimelineList/.test(beforeEvidence);
    const entry = {
      file: relative,
      line,
      title: title || null,
      nearest_section: nearestSection || null,
      status: allowedByTitle || hasManagementCompanion ? 'pass' : 'review',
      evidence_role: title ? 'named object inspector' : 'unnamed object inspector',
    };
    entries.push(entry);
    if (!title) failures.push(`${entry.file}:${line} ObjectInspectorDrawer missing title`);
    if (!allowedByTitle && !hasManagementCompanion) {
      failures.push(`${entry.file}:${line} ObjectInspectorDrawer lacks a diagnostic title or nearby management component`);
    }
  }
}

const report = {
  provenance,
  version,
  generated_at: new Date().toISOString(),
  status: failures.length ? 'fail' : 'pass',
  policy: 'Primary management pages use ObjectInspectorDrawer for concise field summaries. Raw JSON is available only inside an explicit inspector, evidence, or diagnostic detail component.',
  totals: {
    raw_payload_instances: entries.length,
    failures: failures.length,
  },
  entries,
  failures,
};

fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${version}-raw-payload-audit.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`RawPayload audit failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  if (gate) process.exit(1);
}

console.log(`RawPayload audit written to ${reportPath}`);
