import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const roots = ['src', ...(process.argv.includes('--dist') ? ['dist'] : [])];
const legacyId = ['m', 'f', 'g'].join('');
const legacyPath = new RegExp(`/api/apps/${legacyId}(?:/|["'\\s])`, 'i');
const legacySymbol = new RegExp(`\\b${legacyId}(?:[._-]|[A-Z])`, 'i');
const failures = [];

async function scan(path) {
  const metadata = await stat(path);
  if (metadata.isDirectory()) {
    for (const name of await readdir(path)) await scan(resolve(path, name));
    return;
  }
  if (!/\.(?:css|html|js|json|ts|vue)$/.test(path)) return;
  const source = await readFile(path, 'utf8');
  if (legacyPath.test(source) || legacySymbol.test(source)) failures.push(path);
}

for (const root of roots) await scan(resolve(root));
console.log(JSON.stringify({ gate: 'generic-app-production-residual', roots, failures }, null, 2));
if (failures.length) process.exit(1);
