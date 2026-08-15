import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, 'src');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (['.ts', '.vue'].includes(extname(path)) && !path.endsWith('.test.ts')) files.push(path);
  }
};
walk(sourceRoot);
const failures = [];
let drawers = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (relative(sourceRoot, file).startsWith(`pages${process.platform === 'win32' ? '\\' : '/'}`) && source.includes('<RawPayload')) {
    failures.push(`${relative(root, file)} renders an untyped raw payload directly from a page`);
  }
  for (const tag of source.matchAll(/<ObjectInspectorDrawer\b[^>]*>/gs)) {
    drawers += 1;
    if (!/\b(?::title|title)=/.test(tag[0])) failures.push(`${relative(root, file)} has an untitled evidence inspector`);
  }
}
if (drawers === 0) failures.push('No typed evidence inspector is reachable');
console.log(JSON.stringify({ gate: 'typed-evidence-payload', scanned_files: files.length, drawers, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
