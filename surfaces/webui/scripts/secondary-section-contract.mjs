import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const specs = [
  ['mission', 'src/pages/MissionControlPage.vue'], ['agents', 'src/pages/AgentsPage.vue'],
  ['runtime', 'src/pages/RuntimePage.vue'], ['context', 'src/pages/ContextPage.vue'],
  ['memory', 'src/pages/MemoryPage.vue'], ['reality', 'src/pages/RealityCorePage.vue'],
  ['skills', 'src/pages/SkillsPage.vue'], ['gateway', 'src/pages/GatewayPage.vue'],
  ['tools', 'src/pages/ToolsPage.vue'], ['surfaces', 'src/pages/SurfacePage.vue'],
  ['audit', 'src/pages/AuditPage.vue'],
];
const capabilities = read('src/data/capabilities.ts');
const failures = [];
for (const [id, file] of specs) {
  const source = read(file);
  const sectionIds = [...source.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
  if (!sectionIds.length) failures.push(`${id} exposes no addressable sections`);
  for (const section of sectionIds) if (!capabilities.includes(section)) failures.push(`${id}.${section} is absent from capability metadata`);
}
console.log(JSON.stringify({ gate: 'core-secondary-sections', pages: specs.length, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
