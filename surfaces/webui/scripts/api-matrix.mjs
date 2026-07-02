#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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

const planRoot = process.env.COWD_PLAN_ROOT || path.resolve(workspaceRoot, 'plan/0702-Edge治理终态落地方案');
const reportDir = path.resolve(argValue('--report-dir', process.env.COWD_REPORT_DIR || path.join(planRoot, 'reports')));
const version = argValue('--version', process.env.COWD_VERSION || 'v0.9.444');
const requiredRoutes = argValues('--require');

const clientPath = path.join(webuiRoot, 'src/api/client.ts');
const sourceDirs = [
  path.join(webuiRoot, 'src/pages'),
  path.join(webuiRoot, 'src/components'),
  path.join(webuiRoot, 'src/stores'),
];
const testDirs = [
  path.join(webuiRoot, 'src'),
  webuiRoot,
];
const routeDirs = [
  path.join(backendRoot, 'crates/gateway/src/api_routes'),
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
  mfgSourcePackUpsert: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgIngestFact: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgEntityUpsert: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgRelationUpsert: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgComputeJobRun: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgSeedDomain: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgSeedOntology: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgExecuteAction: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgExecutionBridge: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
  mfgRetryReportDelivery: { criticality: 'p0', page: 'mfg', quarantineRequired: true },
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

function normalizeRoute(route) {
  return route
    .replace(/\$\{[^`'"]+?\}/g, (match, offset, input) => (input[offset - 1] === '/' ? ':param' : ''))
    .replace(/\?.*$/, '')
    .replace(/:id/g, ':param')
    .replace(/:name/g, ':param')
    .replace(/:reference/g, ':param')
    .replace(/:run_id/g, ':param')
    .replace(/:phase_id/g, ':param')
    .replace(/\/+/g, '/');
}

function inferMethod(body) {
  const method = body.match(/method:\s*['"`]([A-Z]+)['"`]/)?.[1];
  if (method) return method;
  if (body.includes('write<') || body.includes('write(') || body.includes('writeWithReceipt(')) return 'POST';
  return 'GET';
}

function extractClientMethods() {
  const text = read(clientPath);
  const apiStart = text.indexOf('export const api = {');
  const apiText = text.slice(apiStart);
  const methodRegex = /^\s{2}([A-Za-z0-9_]+):\s*(?:async\s*)?\([^)]*\)\s*=>\s*([\s\S]*?)(?=\n\s{2}[A-Za-z0-9_]+:\s*(?:async\s*)?\([^)]*\)\s*=>|\n};)/gm;
  const entries = [];
  let match;
  while ((match = methodRegex.exec(apiText))) {
    const [, name, body] = match;
    const pathMatch = body.match(/(?:read|write|writeWithReceipt|readText)\s*(?:<[^>]+>)?\(\s*([`'"])([\s\S]*?)\1/);
    if (!pathMatch) continue;
    const route = pathMatch[2].trim();
    entries.push({
      client_method: name,
      method: inferMethod(body),
      path: route,
      normalized_path: normalizeRoute(route),
      operation: inferMethod(body) === 'GET' ? 'read' : 'write',
      criticality: criticalMethods[name]?.criticality || 'p2',
      page: criticalMethods[name]?.page || inferPage(name, route),
      quarantine_required: Boolean(criticalMethods[name]?.quarantineRequired),
    });
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

function hasQuarantineEvidence(entry) {
  if (!entry.quarantine_required) return true;
  const mfgPath = path.join(webuiRoot, 'src/pages/MfgPage.vue');
  const text = read(mfgPath);
  return text.includes(`data-mfg-risk="${entry.client_method}"`) && text.includes('mfg-live-quarantined');
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
    quarantine_ok: hasQuarantineEvidence(entry),
  };
});

const blocking = [];
for (const entry of entries.filter((item) => item.has_ui_call)) {
  if (!entry.has_backend_route) blocking.push(`${entry.client_method}: missing backend route for ${entry.method} ${entry.path}`);
}
for (const entry of entries.filter((item) => item.criticality === 'p0' || item.criticality === 'p1')) {
  if (!entry.has_ui_call) blocking.push(`${entry.client_method}: missing UI call`);
  if (entry.operation === 'write' && !entry.has_frontend_test) blocking.push(`${entry.client_method}: missing frontend request test`);
  if (entry.quarantine_required && !entry.quarantine_ok) blocking.push(`${entry.client_method}: missing MFG temporary quarantine evidence`);
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
  version,
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
}, null, 2));
fs.writeFileSync(gatePath, [
  `# ${version} API Matrix Gate`,
  '',
  `Generated: ${new Date().toISOString()}`,
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
