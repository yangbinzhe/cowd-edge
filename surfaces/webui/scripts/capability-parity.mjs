#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { appRepositoryPath, appWebUiPath } from './app-source-paths.mjs';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const surfaceRoot = path.resolve(webuiRoot, '../..');
const workspaceRoot = path.resolve(surfaceRoot, '..');
const backendRoot = process.env.COWD_BACKEND_REPO
  || [
    path.join(workspaceRoot, 'cowd'),
  ].find((candidate) => (
    fs.existsSync(path.join(candidate, 'crates/gateway/src/api_routes/mod.rs'))
  ))
  || surfaceRoot;
const provenance = evidenceContext('capability-parity');
const planRoot = provenance.plan_root;
const reportDir = path.join(planRoot, 'reports', provenance.version);
const version = provenance.version;
const gate = process.argv.includes('--gate');

const modules = [
  { id: 'runtime', page: 'RuntimePage.vue', routes: ['/api/runtime', '/api/growth'] },
  { id: 'context', page: 'ContextPage.vue', routes: ['/api/context', '/api/evidence'] },
  { id: 'memory', page: 'MemoryPage.vue', routes: ['/api/memory', '/api/cowd/structured'] },
  { id: 'reality', page: 'RealityCorePage.vue', routes: ['/api/reality', '/api/matrix'] },
  { id: 'skills', page: 'SkillsPage.vue', routes: ['/api/skills'] },
  { id: 'agents', page: 'AgentsPage.vue', routes: ['/api/agents', '/api/tasks'] },
  { id: 'tools', page: 'ToolsPage.vue', routes: ['/api/tools', '/api/slash'] },
  { id: 'surfaces', page: 'SurfacePage.vue', routes: ['/api/surfaces'] },
  { id: 'gateway', page: 'GatewayPage.vue', routes: ['/api/connectors', '/api/cross-plane', '/api/platforms'] },
  { id: 'mfg', page: appWebUiPath('mfg', 'MfgApp.vue'), routes: ['/api/apps/mfg'] },
  { id: 'audit', page: 'AuditPage.vue', routes: ['/api/audit', '/api/usage', '/api/cowd/release-gate'] },
];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function parseMessageCatalog(file) {
  const text = read(file);
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

function renderablePageEvidence(pageText) {
  const keys = new Set();
  const regex = /\bt[c]?\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(pageText))) keys.add(match[1]);
  const values = [];
  for (const key of keys) {
    for (const catalog of messageCatalogs) {
      const value = catalog.get(key);
      if (value) values.push(value);
    }
  }
  return `${pageText}\n${values.join('\n')}`;
}

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

function extractBackendRoutes() {
  const files = [
    ...walk(path.join(backendRoot, 'crates/gateway/src/api_routes')).filter((file) => file.endsWith('.rs')),
    ...walk(appRepositoryPath('mfg', 'crates', 'app-mfg-contract', 'src')).filter((file) => file.endsWith('.rs')),
  ];
  const routes = [];
  for (const file of files) {
    const text = read(file);
    const regex = /\.route\(\s*"([^"]+)"/g;
    let match;
    while ((match = regex.exec(text))) {
      routes.push({ path: match[1], file: path.relative(backendRoot, file) });
    }
    if (file.startsWith(appRepositoryPath('mfg'))) {
      const appRouteRegex = /["'](\/api\/apps\/mfg[^"']*)["']/g;
      while ((match = appRouteRegex.exec(text))) {
        routes.push({ path: match[1], file: path.relative(appRepositoryPath('mfg'), file) });
      }
    }
  }
  return routes;
}

function extractClientEndpoints() {
  const texts = [
    read(path.join(webuiRoot, 'src/api/client.ts')),
    read(appWebUiPath('mfg', 'api', 'mfgApi.ts')),
  ];
  const endpoints = new Set();
  for (const text of texts) {
    const regex = /(?:read|write|readText|mfgWrite)\s*(?:<[^>]+>)?\(\s*([`'"])([\s\S]*?)\1/g;
    let match;
    while ((match = regex.exec(text))) endpoints.add(match[2]);
  }
  return Array.from(endpoints).sort();
}

function extractCapabilityEndpoints() {
  const texts = [
    read(path.join(webuiRoot, 'src/data/capabilities.ts')),
    read(appWebUiPath('mfg', 'index.ts')),
  ];
  const endpoints = new Set();
  for (const text of texts) {
    const regex = /(?:endpoint|appApi|contractApi):\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = regex.exec(text))) endpoints.add(match[1]);
  }
  return Array.from(endpoints).sort();
}

const backendRoutes = extractBackendRoutes();
const clientEndpoints = extractClientEndpoints();
const capabilityEndpoints = extractCapabilityEndpoints();
const apiClientText = [
  read(path.join(webuiRoot, 'src/api/client.ts')),
  read(appWebUiPath('mfg', 'api', 'mfgApi.ts')),
].join('\n');
const memoryManifest = read(path.join(backendRoot, 'crates/memory/Cargo.toml'));
const matrixManifest = read(path.join(backendRoot, 'crates/matrix/core/Cargo.toml'));
const matrixMfgRoutes = [
  read(path.join(backendRoot, 'crates/gateway/src/api_routes/matrix_routes.rs')),
  ...walk(appRepositoryPath('mfg', 'crates', 'app-mfg-contract', 'src'))
    .filter((file) => file.endsWith('.rs'))
    .map(read),
  ...walk(appRepositoryPath('mfg', 'crates', 'app-mfg-adapter', 'src'))
    .filter((file) => file.endsWith('.rs'))
    .map(read),
].join('\n');
const mfgContracts = read(appWebUiPath('mfg', 'data', 'mfgWriteContracts.json'));
function contractConsumptionFindings() {
  const findings = [];
  for (const endpoint of [
    '/api/gateway/capability-contract',
    '/api/gateway/openapi.json',
    '/api/gateway/openai-tools',
  ]) {
    if (!apiClientText.includes(endpoint)) {
      findings.push(`WebUI API client does not consume ${endpoint}`);
    }
  }
  return findings;
}

const moduleReports = modules.map((module) => {
  const pagePath = path.isAbsolute(module.page) ? module.page : path.join(webuiRoot, 'src/pages', module.page);
  const pageText = read(pagePath);
  const pageEvidenceText = renderablePageEvidence(pageText);
  const backend = module.routes.flatMap((prefix) => backendRoutes.filter((route) => route.path.startsWith(prefix)));
  const client = module.routes.flatMap((prefix) => clientEndpoints.filter((endpoint) => endpoint.startsWith(prefix)));
  const capability = module.routes.flatMap((prefix) => capabilityEndpoints.filter((endpoint) => endpoint.startsWith(prefix)));
  const findings = [];
  if (!pageText) findings.push('missing WebUI page');
  if (!backend.length) findings.push('missing backend route family');
  if (!client.length) findings.push('missing WebUI API client family');
  if (!capability.length) findings.push('missing capability projection endpoint');
  if (module.id === 'mfg' && !(pageEvidenceText.includes('独立的制造应用') && pageEvidenceText.includes('不承担底层引擎管理职责'))) {
    findings.push('MFG independent application boundary text is missing from WebUI');
  }
  if (module.id === 'mfg') {
    if (!memoryManifest.includes('fact-kernel =') || !matrixManifest.includes('fact-kernel =')) {
      findings.push('Memory and Matrix must both consume the fact-kernel contract');
    }
    if (!matrixMfgRoutes.includes('/api/matrix/') || !matrixMfgRoutes.includes('/api/apps/mfg/')) {
      findings.push('Matrix and MFG routes are not split by kernel/application boundary');
    }
    if (!matrixMfgRoutes.includes('/api/apps/mfg/reality/health')) {
      findings.push('MFG Reality facade routes are missing');
    }
    if (!apiClientText.includes('/api/apps/mfg/reality/health')) {
      findings.push('MFG WebUI client does not consume Reality Core through app facade');
    }
    if (/mfg[A-Za-z0-9_]*:\s*\([^)]*\)\s*=>\s*(?:read|write)\(['"`]\/api\/matrix\//.test(apiClientText)) {
      findings.push('MFG WebUI client must not call /api/matrix/* directly');
    }
    if (pageEvidenceText.includes('Open Reality Core')) {
      findings.push('MFG page must not present Reality Core as its management entry');
    }
    if (pageEvidenceText.includes('endpoint="/api/apps/mfg/* + /api/matrix/*"')) {
      findings.push('MFG degraded banner must not merge app and Matrix API ownership');
    }
    if (!pageEvidenceText.includes('Reality Core projection')) {
      findings.push('MFG page must label Matrix-derived data as a Reality Core projection');
    }
    if (mfgContracts.includes('/api/iacc/') || mfgContracts.includes('IACC')) {
      findings.push('MFG write contracts still contain legacy IACC runtime endpoints');
    }
  }
  if (module.id === 'memory' && !['Structured Data Core', 'structured', '结构化数据核心'].some((term) => pageEvidenceText.includes(term))) {
    findings.push('structured data core is not visible in Memory page');
  }
  if (module.id === 'reality') {
    const requiredRealityTerms = [
      'Reality Core',
      'Fact Flow',
      'realityStatus',
      'realityFlow',
      'realityBoundaries',
    ];
    for (const term of requiredRealityTerms) {
      if (!pageEvidenceText.includes(term) && !read(path.join(webuiRoot, 'src/api/client.ts')).includes(term)) {
        findings.push(`Reality Core WebUI evidence missing ${term}`);
      }
    }
    if (!pageEvidenceText.includes('Matrix') || !pageEvidenceText.includes('/api/matrix')) {
      findings.push('Reality Core must expose Matrix Engine as a core management lane');
    }
  }
  return {
    id: module.id,
    page: path.relative(webuiRoot, pagePath),
    status: findings.length ? 'review' : 'pass',
    findings,
    webui: {
      page_exists: Boolean(pageText),
      client_endpoint_count: new Set(client).size,
      capability_endpoint_count: new Set(capability).size,
    },
    backend: {
      route_count: backend.length,
      route_files: Array.from(new Set(backend.map((route) => route.file))).sort(),
    },
  };
});

const contractFindings = contractConsumptionFindings();
const blocking = [
  ...moduleReports.flatMap((module) => module.findings.map((finding) => `${module.id}: ${finding}`)),
  ...contractFindings,
];

const report = {
  provenance,
  version,
  generated_at: new Date().toISOString(),
  status: blocking.length ? 'fail' : 'pass',
  principles: [
    'WebUI is the strongest management surface and must expose complete management workflows.',
    'TUI keeps the same core capability set with console-appropriate interaction density.',
    'CLI stays minimal and controls only kernel entry, import/view/status/start workflows.',
    'Reality Core is the visible fact system boundary; Fact Flow is the runtime trace across Memory, Matrix, Growth, Context, and Audit.',
    'Matrix Engine is a Reality Core structured-data engine; MFG is an independent application above the core and must not be used as Matrix management.',
  ],
  totals: {
    modules: moduleReports.length,
    backend_routes: backendRoutes.length,
    client_endpoints: clientEndpoints.length,
    capability_endpoints: capabilityEndpoints.length,
    blocking: blocking.length,
  },
  gateway_contract_consumption: {
    status: contractFindings.length ? 'review' : 'pass',
    findings: contractFindings,
    source: '/api/gateway/capability-contract + /api/gateway/openapi.json + /api/gateway/openai-tools',
  },
  modules: moduleReports,
  blocking,
};

fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${version}-capability-parity.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (blocking.length) {
  console.error(`Capability parity gate failed:\n${blocking.map((item) => `- ${item}`).join('\n')}`);
  if (gate) process.exit(1);
}

console.log(`Capability parity report written to ${reportPath}`);
