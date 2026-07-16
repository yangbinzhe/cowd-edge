import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceContext } from './evidence-context.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const surfaceRoot = resolve(__dirname, '..', '..');
const workspaceRoot = resolve(surfaceRoot, '..');
const webuiRoot = resolve(__dirname, '..');
const provenance = evidenceContext('mfg-write-contracts');
const planRoot = provenance.plan_root;
const version = provenance.version;
const sourcePath = resolve(webuiRoot, 'src', 'data', 'mfgWriteContracts.json');
const reportPath = resolve(planRoot, 'reports', version, `${version}-mfg-write-contracts.json`);

const contracts = JSON.parse(await readFile(sourcePath, 'utf8'));

const requiredDomains = ['Data Plane', 'Facts', 'Entities', 'Metrics', 'Evidence', 'Incidents', 'Cockpit'];
const requiredKeys = ['id', 'domain', 'title', 'endpoint', 'method', 'current_return', 'plan', 'dry_run', 'live', 'receipt', 'audit_ref', 'changed_refs', 'approval_required', 'kernel_boundary'];

const failures = [];
const domains = new Set();

for (const contract of contracts) {
  domains.add(contract.domain);
  const serialized = JSON.stringify(contract);
  if (serialized.includes('/api/iacc/') || serialized.includes('IACC')) {
    failures.push(`${contract.id || 'unknown'} still uses legacy IACC runtime naming`);
  }
  for (const key of requiredKeys) {
    if (!(key in contract) || contract[key] === '' || contract[key] === null) {
      failures.push(`${contract.id || 'unknown'} missing ${key}`);
    }
  }
  if (String(contract.endpoint || '').startsWith('/api/apps/mfg/') && !String(contract.kernel_boundary || '').includes('cowd')) {
    failures.push(`${contract.id} does not explain cowd/MFG boundary`);
  }
  if (String(contract.endpoint || '').startsWith('/api/matrix/') && !String(contract.kernel_boundary || '').match(/cowd|Matrix|structured/i)) {
    failures.push(`${contract.id} does not explain Matrix/cowd structured boundary`);
  }
  if (contract.live && !contract.receipt) failures.push(`${contract.id} live endpoint lacks receipt requirement`);
  if (contract.live && !contract.live_policy) failures.push(`${contract.id} live endpoint lacks live_policy`);
}

for (const domain of requiredDomains) {
  if (!domains.has(domain)) failures.push(`missing governed domain ${domain}`);
}

const report = {
  provenance,
  version,
  generated_at: new Date().toISOString(),
  source: sourcePath,
  gates: {
    required_domains: requiredDomains,
    required_keys: requiredKeys,
    status: failures.length ? 'fail' : 'pass',
    failures,
  },
  summary: {
    contract_count: contracts.length,
    domains: Array.from(domains).sort(),
    live_count: contracts.filter((contract) => contract.live).length,
    approval_required_count: contracts.filter((contract) => contract.approval_required).length,
    quarantined_count: contracts.filter((contract) => String(contract.live_policy || '').includes('quarantined')).length,
  },
  contracts,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`MFG write contract gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log(`MFG write contract gate passed: ${reportPath}`);
