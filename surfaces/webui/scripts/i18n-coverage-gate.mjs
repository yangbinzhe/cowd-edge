#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext } from './evidence-context.mjs';

const provenance = evidenceContext('i18n-coverage-gate');

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const srcRoot = path.join(webuiRoot, 'src');
const zhFile = path.join(srcRoot, 'i18n/messages/zh-CN.ts');
const enFile = path.join(srcRoot, 'i18n/messages/en-US.ts');
const gate = process.argv.includes('--gate');

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

function parseCatalog(file) {
  const text = fs.readFileSync(file, 'utf8');
  const entries = new Map();
  const duplicates = [];
  for (const match of text.matchAll(/^\s*"([^"]+)":\s*"((?:\\.|[^"])*)",?$/gm)) {
    const key = match[1];
    const value = JSON.parse(`"${match[2]}"`);
    if (entries.has(key)) duplicates.push(key);
    entries.set(key, value);
  }
  return { entries, duplicates };
}

function sourceFiles() {
  return walk(srcRoot).filter((file) => /\.(vue|ts)$/.test(file) && !file.includes('/i18n/messages/'));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function collectI18nKeys() {
  const keys = new Map();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const regex = /\b(?:t|tc)\(\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = regex.exec(text))) {
      if (!keys.has(match[1])) keys.set(match[1], []);
      keys.get(match[1]).push(`${path.relative(webuiRoot, file)}:${lineOf(text, match.index)}`);
    }
  }
  return keys;
}

function isAllowedTechnicalChineseValue(value) {
  if (/[\u4e00-\u9fff]/.test(value)) return true;
  if (!/[A-Za-z]/.test(value)) return true;
  return /^[A-Z0-9_./:+# -]+$/.test(value)
    || /^(Cowd|WebUI|TUI|CLI|MFG|MCP|API|JSON|HTTP|SSE|ID|DLQ|Profile|Provider|Gateway|Runtime|Surface|Slash)$/i.test(value);
}

const zh = parseCatalog(zhFile);
const en = parseCatalog(enFile);
const failures = [];

for (const key of zh.duplicates) failures.push(`zh-CN duplicate key: ${key}`);
for (const key of en.duplicates) failures.push(`en-US duplicate key: ${key}`);

for (const key of zh.entries.keys()) {
  if (!en.entries.has(key)) failures.push(`missing en-US key: ${key}`);
}
for (const key of en.entries.keys()) {
  if (!zh.entries.has(key)) failures.push(`missing zh-CN key: ${key}`);
}

for (const [key, value] of zh.entries) {
  if (!isAllowedTechnicalChineseValue(value) && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(value)) {
    failures.push(`zh-CN appears untranslated: ${key} = ${value}`);
  }
  if (/(事件s|错误s|上下文项s|re来源|un可用|No [\u4e00-\u9fff]|[A-Za-z]+ [\u4e00-\u9fff]+s)/.test(value)) {
    failures.push(`zh-CN contains migration artifact: ${key} = ${value}`);
  }
}

for (const [key, locations] of collectI18nKeys()) {
  if (!zh.entries.has(key) || !en.entries.has(key)) {
    failures.push(`source references missing i18n key ${key} at ${locations.join(', ')}`);
  }
}

const report = {
  provenance,
  status: failures.length ? 'fail' : 'pass',
  zh_keys: zh.entries.size,
  en_keys: en.entries.size,
  checked_source_files: sourceFiles().length,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length && gate) process.exit(1);
