#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { appRepositoryPath, appWebUiPath, appWebUiSourceRoot } from './app-source-paths.mjs';
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
const args = process.argv.slice(2);
const gate = args.includes('--gate');
const probe = args.includes('--probe');
const probeBaseUrl = (process.env.COWD_PROBE_BASE_URL || 'http://127.0.0.1:8643').replace(/\/$/, '');

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const provenance = evidenceContext('api-matrix');
const planRoot = provenance.plan_root;
const reportDir = path.resolve(argValue('--report-dir', process.env.COWD_REPORT_DIR || path.join(planRoot, 'reports', provenance.version)));
const version = argValue('--version', provenance.version).replace(/^v/, '');
if (version !== provenance.version) throw new Error(`api matrix version ${version} does not match provenance ${provenance.version}`);
const requiredRoutes = argValues('--require');

const mfgSourceRoot = appWebUiSourceRoot('mfg');
const clientSources = [
  { file: path.join(webuiRoot, 'src/api/client.ts'), marker: 'export const api = {' },
  { file: appWebUiPath('mfg', 'api', 'mfgApi.ts'), marker: 'export const mfgApi = {' },
];
const sourceDirs = [
  path.join(webuiRoot, 'src/pages'),
  path.join(webuiRoot, 'src/components'),
  path.join(webuiRoot, 'src/stores'),
  mfgSourceRoot,
];
const testDirs = [
  path.join(webuiRoot, 'src'),
  mfgSourceRoot,
  webuiRoot,
];
const routeDirs = [
  path.join(backendRoot, 'crates/gateway/src/api_routes'),
  appRepositoryPath('mfg', 'crates', 'app-mfg-contract', 'src'),
];

const criticalMethods = {
  uploadFile: { criticality: 'p0', page: 'workspace' },
  saveFile: { criticality: 'p1', page: 'workspace' },
  renameWorkspacePath: { criticality: 'p1', page: 'workspace' },
  deleteWorkspacePath: { criticality: 'p1', page: 'workspace' },
  skillAction: { criticality: 'p1', page: 'skills' },
  createMemoryEntry: { criticality: 'p1', page: 'memory' },
  updateMemoryEntry: { criticality: 'p1', page: 'memory' },
  deleteMemoryEntry: { criticality: 'p1', page: 'memory' },
  crossPlaneExecute: { criticality: 'p0', page: 'gateway' },
  matrixSourcePackUpsert: { criticality: 'p0', page: 'gateway' },
  matrixSourceSnapshotPlan: { criticality: 'p0', page: 'gateway' },
  matrixSourceSnapshotRun: { criticality: 'p0', page: 'gateway' },
  mfgSourcePackUpsert: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgSourcePackValidate: { criticality: 'p1', page: 'mfg' },
  mfgSourcePackDeltaPlan: { criticality: 'p1', page: 'mfg' },
  mfgSourcePackConnectorPlan: { criticality: 'p1', page: 'mfg' },
  mfgSourcePackConnectorRun: { criticality: 'p0', page: 'mfg' },
  mfgComputeJobPlan: { criticality: 'p1', page: 'mfg' },
  mfgComputeJobRun: { criticality: 'p0', page: 'mfg' },
  mfgEvidenceQualityGate: { criticality: 'p1', page: 'mfg' },
  mfgDecisionTrace: { criticality: 'p1', page: 'mfg' },
  mfgRecommendPlaybooks: { criticality: 'p1', page: 'mfg' },
  mfgIngestFact: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgExecuteAction: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgExecutionBridge: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgExecutionFeedback: { criticality: 'p1', page: 'mfg' },
  mfgRetryReportDelivery: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgUpsertProfile: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgDeleteCockpitProfile: { criticality: 'p1', page: 'mfg', governedReceiptRequired: true },
  mfgCloneCockpitProfile: { criticality: 'p1', page: 'mfg', governedReceiptRequired: true },
  mfgShareCockpitProfile: { criticality: 'p1', page: 'mfg', governedReceiptRequired: true },
  mfgCockpitWidgetProjection: { criticality: 'p1', page: 'mfg' },
  mfgReports: { criticality: 'p1', page: 'mfg' },
  mfgUpsertAlertRule: { criticality: 'p1', page: 'mfg', governedReceiptRequired: true },
  mfgAlertCommand: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgUpsertAlertSubscription: { criticality: 'p1', page: 'mfg', governedReceiptRequired: true },
  mfgUpsertAssignment: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
  mfgAssignmentCommand: { criticality: 'p0', page: 'mfg', governedReceiptRequired: true },
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const base = path.basename(target);
  if (['node_modules', 'dist', 'test-results', 'coverage', '.vite'].includes(base)) return [];
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

function stripTemplateExpressions(route) {
  let result = '';
  for (let index = 0; index < route.length; index += 1) {
    if (route[index] !== '$' || route[index + 1] !== '{') {
      result += route[index];
      continue;
    }
    if (result.endsWith('/')) result += ':param';
    let depth = 1;
    index += 2;
    while (index < route.length && depth > 0) {
      if (route[index] === '{') depth += 1;
      if (route[index] === '}') depth -= 1;
      index += 1;
    }
    index -= 1;
  }
  return result;
}

function normalizeRoute(route) {
  return stripTemplateExpressions(route)
    .replace(/\?.*$/, '')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param')
    .replace(/\/+/g, '/');
}

function firstRequestRoute(body) {
  const call = /(?:read|write|writeWithReceipt|readText|mfgWrite)\s*(?:<[^>]+>)?\s*\(\s*/.exec(body);
  if (!call) return null;
  const start = call.index + call[0].length;
  const quote = body[start];
  if (!quote || !['`', "'", '"'].includes(quote)) return null;
  if (quote !== '`') {
    const end = body.indexOf(quote, start + 1);
    return end < 0 ? null : body.slice(start + 1, end);
  }
  let interpolationDepth = 0;
  for (let index = start + 1; index < body.length; index += 1) {
    if (body[index] === '$' && body[index + 1] === '{') {
      interpolationDepth += 1;
      index += 1;
      continue;
    }
    if (interpolationDepth > 0) {
      if (body[index] === '{') interpolationDepth += 1;
      else if (body[index] === '}') interpolationDepth -= 1;
      continue;
    }
    if (body[index] === '`') return body.slice(start + 1, index);
  }
  return null;
}

function inferMethod(body) {
  const method = body.match(/method:\s*['"`]([A-Z]+)['"`]/)?.[1];
  if (method) return method;
  if (body.includes("'DELETE'") || body.includes('"DELETE"') || body.includes('`DELETE`')) return 'DELETE';
  if (body.includes('write<') || body.includes('write(') || body.includes('writeWithReceipt(') || body.includes('mfgWrite(') || body.includes('mfgWrite<')) return 'POST';
  return 'GET';
}

function extractClientMethods() {
  const entries = [];
  for (const source of clientSources) {
    const text = read(source.file);
    const apiStart = text.indexOf(source.marker);
    if (apiStart < 0) throw new Error(`API object ${source.marker} is missing from ${source.file}`);
    const apiText = text.slice(apiStart);
    const members = Array.from(apiText.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm));
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const [, name] = member;
      const memberStart = member.index;
      const memberEnd = members[index + 1]?.index ?? apiText.indexOf('\n};', memberStart);
      const memberText = apiText.slice(memberStart, memberEnd < 0 ? apiText.length : memberEnd);
      const arrow = memberText.indexOf('=>');
      if (arrow < 0) continue;
      const body = memberText.slice(arrow + 2);
      const route = firstRequestRoute(body)?.trim();
      if (!route) continue;
      const method = inferMethod(body);
      entries.push({
        client_method: name,
        method,
        path: route,
        normalized_path: normalizeRoute(route),
        operation: method === 'GET' ? 'read' : 'write',
        criticality: criticalMethods[name]?.criticality || 'p2',
        page: criticalMethods[name]?.page || inferPage(name, route),
        governed_receipt_required: Boolean(criticalMethods[name]?.governedReceiptRequired),
      });
    }
  }
  return entries;
}

function inferPage(name, route) {
  const text = `${name} ${route}`.toLowerCase();
  for (const page of ['runtime', 'context', 'memory', 'skills', 'agents', 'tools', 'gateway', 'mfg', 'audit', 'settings', 'workspace']) {
    if (text.includes(page)) return page;
  }
  if (text.includes('session') || text.includes('message')) return 'chat';
  if (text.includes('connector') || text.includes('cross-plane') || text.includes('platform')) return 'gateway';
  return 'unknown';
}

function extractUiCalls() {
  const calls = new Map();
  for (const file of sourceDirs.flatMap(walk).filter((item) => /\.(vue|ts)$/.test(item))) {
    const text = read(file);
    const regex = /api\.([A-Za-z0-9_]+)\s*\(/g;
    let match;
    while ((match = regex.exec(text))) {
      const name = match[1];
      if (!calls.has(name)) calls.set(name, []);
      calls.get(name).push(path.relative(webuiRoot, file));
    }
  }
  return calls;
}

function extractTestEvidence() {
  const evidence = new Map();
  for (const file of testDirs.flatMap(walk).filter((item) => /\.(test|spec)\.(ts|js)$/.test(item))) {
    const text = read(file);
    const regex = /api\.([A-Za-z0-9_]+)\s*\(/g;
    let match;
    while ((match = regex.exec(text))) {
      const name = match[1];
      if (!evidence.has(name)) evidence.set(name, []);
      evidence.get(name).push(path.relative(backendRoot, file));
    }
  }
  return evidence;
}

function extractRoutes() {
  const routes = [];
  for (const file of routeDirs.flatMap(walk).filter((item) => item.endsWith('.rs'))) {
    const text = read(file);
    // External APPs own a declarative route contract. This macro input is the
    // authoritative method/path source even though Axum registration happens
    // later through the compiled APP contribution.
    const appContractRegex = /^\s*[A-Za-z0-9_]+,\s*"[^"]+",\s*"([A-Z]+)",\s*"([^"]+)"/gm;
    let appContract;
    while ((appContract = appContractRegex.exec(text))) {
      const [, method, route] = appContract;
      routes.push({
        method,
        path: route,
        normalized_path: normalizeRoute(route),
        file: path.relative(webuiRoot, file),
      });
    }
    // TypedRouteSpec is the authoritative route declaration for the
    // projection family. Do not make the matrix claim those APIs disappeared
    // simply because their Axum registration uses `spec.path` instead of a
    // repeated literal in `.route(...)`.
    const typedRouteRegex = /TypedRouteSpec::new\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g;
    let typedRoute;
    while ((typedRoute = typedRouteRegex.exec(text))) {
      const [, method, route] = typedRoute;
      routes.push({
        method,
        path: route,
        normalized_path: normalizeRoute(route),
        file: path.relative(webuiRoot, file),
      });
    }
    let offset = 0;
    while (offset < text.length) {
      const routeIndex = text.indexOf('.route(', offset);
      if (routeIndex < 0) break;
      const afterRoute = text.slice(routeIndex + '.route('.length);
      const pathMatch = afterRoute.match(/^\s*"([^"]+)"/);
      offset = routeIndex + '.route('.length;
      if (!pathMatch) continue;
      const route = pathMatch[1];
      const afterPath = afterRoute.slice(pathMatch[0].length);
      const nextRoute = afterPath.indexOf('.route(');
      const handlers = afterPath.slice(0, nextRoute >= 0 ? nextRoute : Math.min(afterPath.length, 512));
      offset = routeIndex + '.route('.length + pathMatch[0].length + handlers.length;
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const methodRegex = new RegExp(`\\b${method}\\s*\\(`, 'i');
        if (methodRegex.test(handlers)) {
          routes.push({
            method: method.toUpperCase(),
            path: route,
            normalized_path: normalizeRoute(route),
            file: path.relative(webuiRoot, file),
          });
        }
      }
    }
  }
  return routes;
}

function routeMatches(entry, route) {
  if (entry.method !== route.method) return false;
  if (entry.normalized_path === route.normalized_path) return true;
  const a = entry.normalized_path.split('/').filter(Boolean);
  const b = route.normalized_path.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((part, index) => part === b[index] || part === ':param' || b[index] === ':param');
}

function hasGovernedReceiptEvidence(entry) {
  if (!entry.governed_receipt_required) return true;
  const sources = [
    read(appWebUiPath('mfg', 'components', 'mfg', 'MfgCockpitWorkspace.vue')),
    read(appWebUiPath('mfg', 'components', 'mfg', 'MfgFocusWorkspace.vue')),
    read(appWebUiPath('mfg', 'components', 'mfg', 'MfgCollaborationWorkspace.vue')),
    read(appWebUiPath('mfg', 'components', 'mfg', 'MfgDomainWorkspace.vue')),
    read(appWebUiPath('mfg', 'stores', 'mfgCockpit.ts')),
  ].join('\n');
  const hasReceiptOrTerminalState = /RequestReceipt|cockpit\.saving|operationError|\bbusy\b/.test(sources);
  return sources.includes(entry.client_method) && hasReceiptOrTerminalState;
}

const clientEntries = extractClientMethods();
const uiCalls = extractUiCalls();
const testEvidence = extractTestEvidence();
const routes = extractRoutes();

const entries = clientEntries.map((entry) => {
  const matchedRoutes = routes.filter((route) => routeMatches(entry, route));
  const uiFiles = uiCalls.get(entry.client_method) || [];
  const testFiles = testEvidence.get(entry.client_method) || [];
  return {
    version,
    ...entry,
    ui_files: uiFiles,
    backend_routes: matchedRoutes.map((route) => route.file),
    has_ui_call: uiFiles.length > 0,
    has_backend_route: matchedRoutes.length > 0,
    has_frontend_test: testFiles.length > 0,
    test_files: testFiles,
    governed_receipt_ok: hasGovernedReceiptEvidence(entry),
  };
});

const probeFixtures = (() => {
  try { return JSON.parse(process.env.COWD_PROBE_FIXTURES || '{}'); }
  catch { throw new Error('COWD_PROBE_FIXTURES must be a JSON object'); }
})();
const probeResults = [];
if (probe) {
  for (const entry of entries.filter((item) => item.operation === 'read')) {
    const hasParameter = entry.normalized_path.includes(':param') || /:[a-z_]+/.test(entry.normalized_path);
    const fixture = probeFixtures[entry.client_method];
    if (hasParameter && !fixture) {
      probeResults.push({ client_method: entry.client_method, status: 'not_probed_missing_fixture', evidence_level: null });
      continue;
    }
    const probePath = entry.normalized_path.replace(/:param|:[a-z_]+/g, () => encodeURIComponent(String(fixture || 'acceptance-probe')));
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch(`${probeBaseUrl}${probePath}`, {
        headers: process.env.COWD_API_TOKEN ? { Authorization: `Bearer ${process.env.COWD_API_TOKEN}` } : undefined,
      });
      probeResults.push({
        client_method: entry.client_method,
        path: probePath,
        http_status: response.status,
        status: [200, 204, 400, 401, 403].includes(response.status) ? 'route_reached' : 'probe_failed',
        evidence_level: 'integration-local',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    } catch (error) {
      probeResults.push({ client_method: entry.client_method, path: probePath, status: 'probe_failed', evidence_level: null, error: error instanceof Error ? error.message : String(error), started_at: startedAt, finished_at: new Date().toISOString() });
    }
  }
}

const blocking = [];
for (const entry of entries.filter((item) => item.has_ui_call)) {
  if (!entry.has_backend_route) blocking.push(`${entry.client_method}: missing backend route for ${entry.method} ${entry.path}`);
}
if (probe) {
  for (const result of probeResults.filter((item) => item.status === 'probe_failed')) {
    blocking.push(`${result.client_method}: real HTTP probe failed${result.http_status ? ` with ${result.http_status}` : ''}`);
  }
}
for (const entry of entries.filter((item) => item.criticality === 'p0' || item.criticality === 'p1')) {
  if (!entry.has_ui_call) blocking.push(`${entry.client_method}: missing UI call`);
  if (entry.operation === 'write' && !entry.has_frontend_test) blocking.push(`${entry.client_method}: missing frontend request test`);
  if (entry.governed_receipt_required && !entry.governed_receipt_ok) blocking.push(`${entry.client_method}: missing MFG governed receipt evidence`);
}

const requiredFindings = [];
for (const route of requiredRoutes) {
  const normalized = normalizeRoute(route);
  const matched = routes.some((backendRoute) => {
    const requiredEntry = { method: backendRoute.method, normalized_path: normalized };
    return routeMatches(requiredEntry, backendRoute);
  });
  if (!matched) {
    const finding = `required route missing: ${route}`;
    requiredFindings.push(finding);
    blocking.push(finding);
  }
}

fs.mkdirSync(reportDir, { recursive: true });
const matrixPath = path.join(reportDir, `${version}-api-matrix.json`);
const gatePath = path.join(reportDir, `${version}-api-matrix-gate.md`);
fs.writeFileSync(matrixPath, JSON.stringify({
  provenance,
  version,
  mode: probe ? 'source_mapping_and_real_get_probe' : 'source_mapping',
  evidence_level: probe ? 'integration-local' : 'static',
  generated_at: new Date().toISOString(),
  totals: {
    client_methods: entries.length,
    backend_routes: routes.length,
    required_routes: requiredRoutes.length,
    blocking: blocking.length,
  },
  required_routes: requiredRoutes.map((route) => ({
    path: route,
    normalized_path: normalizeRoute(route),
    present: !requiredFindings.includes(`required route missing: ${route}`),
  })),
  entries,
  probes: probeResults,
}, null, 2));
fs.writeFileSync(gatePath, [
  `# ${version} API Matrix Gate`,
  '',
  `Generated: ${new Date().toISOString()}`,
  `Frontend commit: ${provenance.frontend.commit}`,
  `Backend commit: ${provenance.backend.commit}`,
  '',
  `Client methods: ${entries.length}`,
  `Backend routes: ${routes.length}`,
  `Required routes: ${requiredRoutes.length}`,
  `Blocking findings: ${blocking.length}`,
  '',
  ...(blocking.length ? ['## Blocking', '', ...blocking.map((item) => `- ${item}`)] : ['## Blocking', '', 'None']),
  '',
].join('\n'));

if (blocking.length) {
  console.error(blocking.join('\n'));
  if (gate) process.exit(1);
}

console.log(`API matrix written to ${matrixPath}`);
