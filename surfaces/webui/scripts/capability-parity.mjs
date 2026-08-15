import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const fixture = JSON.parse(read('src/apps/fixtures/catalog-single.json'));
const registry = read('src/plugins/registry.ts');
const sidebar = read('src/components/CapabilitySidebar.vue');
const inbox = read('src/components/ApprovalInbox.vue');
const failures = [];

if (fixture.schema_version !== 1 || fixture.apps.length !== 1) failures.push('Reference Catalog fixture must be a single valid V1 application');
for (const token of ['effective_capabilities', "group: 'Apps'", '/apps/:appId/:pathMatch(.*)*']) {
  if (!registry.includes(token)) failures.push(`Registry is missing ${token}`);
}
if (!registry.includes('.application') || !registry.includes('.app_id')) failures.push('Approval ownership must use source.application.app_id');
if (registry.includes('source.kind')) failures.push('Approval ownership must not infer an application from source.kind');
if (!sidebar.includes('effective_capabilities') || !sidebar.includes('effective_authorization_profile')) failures.push('Capability sidebar must consume the effective Catalog projection');
if (!inbox.includes('applicationAppIdFromApproval')) failures.push('Approval inbox must use explicit application identity');

console.log(JSON.stringify({ gate: 'catalog-capability-boundary', app_id: fixture.apps[0]?.app_id, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
