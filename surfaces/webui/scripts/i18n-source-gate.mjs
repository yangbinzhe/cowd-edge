#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext } from './evidence-context.mjs';

const provenance = evidenceContext('i18n-source-gate');

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const srcRoot = path.join(webuiRoot, 'src');
const gate = process.argv.includes('--gate');

const sourceRoots = [
  path.join(srcRoot, 'pages'),
  path.join(srcRoot, 'components'),
  path.join(srcRoot, 'data'),
  path.join(srcRoot, 'stores'),
];

const visibleProps = [
  'label',
  'title',
  'summary',
  'description',
  'detail',
  'placeholder',
  'current_return',
  'validate',
  'plan',
  'dry_run',
  'live_policy',
  'kernel_boundary',
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

function isTechnicalLiteral(value) {
  const trimmed = value.trim();
  return !trimmed
    || /^[a-z0-9_./:#-]+$/.test(trimmed)
    || /^[A-Z0-9_./:#-]+$/.test(trimmed)
    || /^\/api\//.test(trimmed)
    || trimmed.includes('{{')
    || trimmed.includes('t(');
}

function scanStaticTemplateText(file, text) {
  const failures = [];
  if (!file.endsWith('.vue')) return failures;
  const templateMatch = text.match(/<template>([\s\S]*?)<\/template>/);
  if (!templateMatch) return failures;
  const template = templateMatch[1];
  const templateStart = templateMatch.index + '<template>'.length;
  const textNodeRegex = />([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g;
  let match;
  while ((match = textNodeRegex.exec(template))) {
    const value = match[1].replace(/\s+/g, ' ').trim();
    if (isTechnicalLiteral(value)) continue;
    failures.push(`${path.relative(webuiRoot, file)}:${lineOf(text, templateStart + match.index)} static template text "${value}" must use t()`);
  }
  const attrRegex = /\s(placeholder|aria-label|title)="([^"]*[A-Za-z]{3,}[^"]*)"/g;
  while ((match = attrRegex.exec(template))) {
    const value = match[2].replace(/\s+/g, ' ').trim();
    if (isTechnicalLiteral(value)) continue;
    failures.push(`${path.relative(webuiRoot, file)}:${lineOf(text, templateStart + match.index)} static ${match[1]} "${value}" must use t()`);
  }
  return failures;
}

function scanVisibleScriptStrings(file, text) {
  const failures = [];
  const regex = new RegExp(`\\b(${visibleProps.join('|')}):\\s*'((?:\\\\'|[^'])*)'`, 'g');
  let match;
  while ((match = regex.exec(text))) {
    const value = match[2].replace(/\\'/g, "'");
    if (isTechnicalLiteral(value)) continue;
    failures.push(`${path.relative(webuiRoot, file)}:${lineOf(text, match.index)} script ${match[1]} "${value}" must use t()`);
  }
  return failures;
}

const files = sourceRoots
  .flatMap(walk)
  .filter((file) => /\.(vue|ts)$/.test(file) && !/\.(?:test|spec)\.ts$/.test(file));
const failures = [];

if (fs.existsSync(path.join(srcRoot, 'i18n/catalog.ts'))) {
  failures.push('src/i18n/catalog.ts must not exist; use explicit message catalogs');
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/zhText|translatePattern|installDomI18n|MutationObserver|translateText\(|translateStatus\(/.test(text)) {
    failures.push(`${path.relative(webuiRoot, file)} contains legacy DOM/string translation path`);
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    failures.push(`${path.relative(webuiRoot, file)} contains hard-coded Chinese; move it to i18n/messages`);
  }
  failures.push(...scanStaticTemplateText(file, text));
  failures.push(...scanVisibleScriptStrings(file, text));
}

const report = {
  provenance,
  status: failures.length ? 'fail' : 'pass',
  checked_files: files.length,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length && gate) process.exit(1);
