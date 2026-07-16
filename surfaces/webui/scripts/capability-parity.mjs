#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const surfaceRoot = path.resolve(webuiRoot, '../..');
const workspaceRoot = path.resolve(surfaceRoot, '..');
const backendRoot = process.env.COWD_BACKEND_REPO
  || [
    path.join(workspaceRoot, 'cowd-develop'),
    path.join(workspaceRoot, 'cowd'),
    path.join(workspaceRoot, 'dev-iacc'),
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
  { id: 'runtime', page: 'RuntimePage.vue', routes: ['/api/runtime', '/api/growth'], tui: ['runtime_activity_panel.rs', 'system_status_bar.rs'], cli: ['gateway', 'doctor'] },
  { id: 'context', page: 'ContextPage.vue', routes: ['/api/context', '/api/evidence'], tui: ['context_panel.rs', 'context_suggestions.rs'], cli: ['prompt', 'compact'] },
  { id: 'memory', page: 'MemoryPage.vue', routes: ['/api/memory', '/api/cowd/structured'], tui: ['memory_panel.rs', 'l4_memory_view.rs'], cli: ['Config'] },
  { id: 'reality', page: 'RealityCorePage.vue', routes: ['/api/reality', '/api/matrix'], tui: ['gateway_panel.rs', 'runtime_control_store.rs', 'gateway_client.rs'], cli: ['gateway'] },
  { id: 'skills', page: 'SkillsPage.vue', routes: ['/api/skills'], tui: ['skills_panel.rs'], cli: ['Skill'] },
  { id: 'agents', page: 'AgentsPage.vue', routes: ['/api/agents', '/api/tasks'], tui: ['agent_team_panel.rs', 'agents_overlay.rs'], cli: ['prompt'] },
  { id: 'tools', page: 'ToolsPage.vue', routes: ['/api/tools', '/api/slash'], tui: ['tool_ops_panel.rs', 'gateway_client.rs', 'runtime_activity_panel.rs'], cli: ['prompt'] },
  { id: 'surfaces', page: 'SurfacePage.vue', routes: ['/api/surfaces'], tui: ['surface_panel.rs', 'gateway_panel.rs'], cli: ['gateway'] },
  { id: 'gateway', page: 'GatewayPage.vue', routes: ['/api/connectors', '/api/cross-plane', '/api/platforms'], tui: ['gateway_panel.rs', 'approval_cockpit_panel.rs'], cli: ['gateway'] },
  { id: 'mfg', page: 'MfgPage.vue', routes: ['/api/apps/mfg'], tui: ['goal_workbench_panel.rs', 'task_decomposition_view.rs'], cli: ['gateway'] },
  { id: 'audit', page: 'AuditPage.vue', routes: ['/api/audit', '/api/usage', '/api/cowd/release-gate'], tui: ['export_dialog.rs', 'approval_cockpit_panel.rs'], cli: ['Doctor'] },
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
  ];
  const routes = [];
  for (const file of files) {
    const text = read(file);
    const regex = /\.route\(\s*"([^"]+)"/g;
    let match;
    while ((match = regex.exec(text))) {
      routes.push({ path: match[1], file: path.relative(backendRoot, file) });
    }
  }
  return routes;
}

function extractClientEndpoints() {
  const text = read(path.join(webuiRoot, 'src/api/client.ts'));
  const endpoints = new Set();
  const regex = /(?:read|write|readText)\s*(?:<[^>]+>)?\(\s*([`'"])([\s\S]*?)\1/g;
  let match;
  while ((match = regex.exec(text))) endpoints.add(match[2]);
  return Array.from(endpoints).sort();
}

function extractCapabilityEndpoints() {
  const text = read(path.join(webuiRoot, 'src/data/capabilities.ts'));
  const endpoints = new Set();
  const regex = /endpoint:\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(text))) endpoints.add(match[1]);
  return Array.from(endpoints).sort();
}

function referencesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

const backendRoutes = extractBackendRoutes();
const clientEndpoints = extractClientEndpoints();
const capabilityEndpoints = extractCapabilityEndpoints();
const tuiFiles = [
  ...walk(path.join(backendRoot, 'crates/tui/src')),
  ...walk(path.join(backendRoot, 'crates/cowd-cli/src/tui')),
].map((file) => path.basename(file));
const tuiSources = [
  ...walk(path.join(backendRoot, 'crates/tui/src')),
  ...walk(path.join(backendRoot, 'crates/cowd-cli/src/tui')),
]
  .filter((file) => file.endsWith('.rs'))
  .map((file) => read(file))
  .join('\n');
const cliMain = read(path.join(backendRoot, 'crates/cli/src/main.rs')) || read(path.join(backendRoot, 'crates/cowd-cli/src/main.rs'));
const cliMod = read(path.join(backendRoot, 'crates/cli/src/lib.rs')) || read(path.join(backendRoot, 'crates/cowd-cli/src/cli/mod.rs'));
const cliText = `${cliMain}\n${cliMod}`;
const runtimeCapability = read(path.join(backendRoot, 'crates/runtime/src/infrastructure/capability.rs'));
const apiClientText = read(path.join(webuiRoot, 'src/api/client.ts'));
const matrixBoundaryTest = [
  read(path.join(backendRoot, 'crates/gateway/tests/gateway_runtimehost_architecture.rs')),
  read(path.join(backendRoot, 'crates/runtime/tests/matrix_mfg_boundary.rs')),
].join('\n');
const matrixMfgRoutes = [
  read(path.join(backendRoot, 'crates/gateway/src/api_routes/matrix_routes.rs')),
  read(path.join(backendRoot, 'crates/gateway/src/api_routes/mfg_routes.rs')),
  read(path.join(backendRoot, 'crates/cowd-cli/src/api_routes/matrix_mfg_routes.rs')),
].join('\n');
const mfgContracts = read(path.join(webuiRoot, 'src/data/mfgWriteContracts.json'));
const contractConsumptionSources = {
  client: read(path.join(webuiRoot, 'src/api/client.ts')),
  store: read(path.join(webuiRoot, 'src/stores/app.ts')),
  sidebar: read(path.join(webuiRoot, 'src/components/CapabilitySidebar.vue')),
  gatewayPage: read(path.join(webuiRoot, 'src/pages/GatewayPage.vue')),
  tests: read(path.join(webuiRoot, 'src/app.test.ts')),
};

function contractConsumptionFindings() {
  const findings = [];
  const required = [
    { file: 'client', terms: ['/api/gateway/capability-contract', '/api/gateway/openapi.json', '/api/gateway/openai-tools', 'capabilityPageEndpointsFromContract'] },
    { file: 'store', terms: ['gatewayCapabilityContract', 'gatewayOpenAiTools', 'refreshGatewayCapabilityContract'] },
    { file: 'sidebar', terms: ['gatewayCapabilityContract', 'capabilityPageEndpointsFromContract', 'component.capability.sidebar.contract'] },
    { file: 'gatewayPage', terms: ['capabilityContract', 'openApiDocument', 'openAiTools', 'page.gateway.contract'] },
    { file: 'tests', terms: ['gatewayCapabilityContract', 'gatewayOpenAiTools', 'capabilityPageEndpointsFromContract'] },
  ];
  for (const item of required) {
    const text = contractConsumptionSources[item.file] || '';
    for (const term of item.terms) {
      if (!text.includes(term)) findings.push(`gateway contract consumption missing ${item.file}:${term}`);
    }
  }
  const runtimePageEndpointMatches = Array.from(contractConsumptionSources.client.matchAll(/pageEndpoints\s*\(/g));
  if (runtimePageEndpointMatches.length > 2) {
    findings.push('pageEndpoints must remain a fallback helper plus one loadCapabilityPage call in src/api/client.ts');
  }
  return findings;
}

const moduleReports = modules.map((module) => {
  const pagePath = path.join(webuiRoot, 'src/pages', module.page);
  const pageText = read(pagePath);
  const pageEvidenceText = renderablePageEvidence(pageText);
  const backend = module.routes.flatMap((prefix) => backendRoutes.filter((route) => route.path.startsWith(prefix)));
  const client = module.routes.flatMap((prefix) => clientEndpoints.filter((endpoint) => endpoint.startsWith(prefix)));
  const capability = module.routes.flatMap((prefix) => capabilityEndpoints.filter((endpoint) => endpoint.startsWith(prefix)));
  const tui = module.tui.filter((file) => tuiFiles.includes(file));
  const cli = module.cli.filter((term) => cliText.includes(term));
  const findings = [];
  if (!pageText) findings.push('missing WebUI page');
  if (!backend.length) findings.push('missing backend route family');
  if (!client.length) findings.push('missing WebUI API client family');
  if (!capability.length) findings.push('missing capability projection endpoint');
  if (!tui.length) findings.push('missing TUI projection evidence');
  if (!cli.length) findings.push('missing CLI core access evidence');
  if (module.id === 'mfg' && !(pageEvidenceText.includes('独立的制造应用') && pageEvidenceText.includes('不承担底层引擎管理职责'))) {
    findings.push('MFG independent application boundary text is missing from WebUI');
  }
  if (module.id === 'mfg') {
    if (!runtimeCapability.includes('cowd.matrix.engine') || !runtimeCapability.includes('CowdCapabilityKind::StructuredData')) {
      findings.push('Matrix Engine must be declared as a Reality Core structured-data engine');
    }
    if (!runtimeCapability.includes('capability_registry_declares_matrix_as_reality_core_engine_without_mfg_ownership')) {
      findings.push('Runtime capability registry must guard Matrix as Reality Core engine without MFG ownership');
    }
    if (runtimeCapability.includes('cowd.matrix.runtime')) {
      findings.push('Runtime capability registry must not reintroduce legacy Matrix runtime capability id');
    }
    if (!matrixBoundaryTest.includes('fact_kernel_is_consumed_by_memory_and_matrix_engines')) {
      findings.push('Matrix/fact-kernel source boundary test is missing');
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
  if (module.id === 'memory' && !referencesAny(pageEvidenceText, ['Structured Data Core', 'structured', '结构化数据核心'])) {
    findings.push('structured data core is not visible in Memory page');
  }
  if (module.id === 'memory' && !referencesAny(tuiSources, ['structured_sources', 'structured_facts', 'structured_evidence', 'structured_watermarks'])) {
    findings.push('TUI structured data projection is missing');
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
    for (const term of ['reality_status', 'reality_flow', 'reality_boundaries', 'gateway_reality_core', 'gateway_fact_flow']) {
      if (!tuiSources.includes(term)) findings.push(`TUI Reality Core projection is missing ${term}`);
    }
    if (!pageEvidenceText.includes('Matrix') || !pageEvidenceText.includes('/api/matrix')) {
      findings.push('Reality Core must expose Matrix Engine as a core management lane');
    }
  }
  if (module.id === 'tools') {
    const requiredToolOpsTerms = [
      'ToolOpsPanel',
      'tool_cache_stats',
      'tool_batch_readonly',
      'tool_mutation_preview',
      'tool_checkpoints',
      'tool_intent_plan',
      'tool_context_fanout_plan',
      'arm_restore_checkpoint',
      'arm_apply_mutation',
    ];
    for (const term of requiredToolOpsTerms) {
      if (!tuiSources.includes(term)) findings.push(`TUI tool operations evidence missing ${term}`);
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
    tui: {
      expected_panels: module.tui,
      matched_panels: tui,
      parity_role: 'same core capability set, console-first interaction',
    },
    cli: {
      matched_terms: cli,
      parity_role: 'minimal kernel control, import/view/start/status oriented',
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
