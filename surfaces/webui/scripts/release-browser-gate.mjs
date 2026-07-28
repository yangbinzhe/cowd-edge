import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const repoRoot = resolve(root, '../..');
const evidencePath = resolve(
  process.env.COWD_E2E_PROVENANCE_OUTPUT
    || join(root, 'test-results/release-browser-provenance.json'),
);
const reportPath = resolve(dirname(evidencePath), 'release-browser-playwright.json');
const gatewayLogPath = resolve(dirname(evidencePath), 'release-browser-gateway.log');
const providerLogPath = resolve(dirname(evidencePath), 'release-browser-provider.jsonl');
const providerStdoutPath = resolve(dirname(evidencePath), 'release-browser-provider.log');
const profileEvidencePath = resolve(dirname(evidencePath), 'release-browser-profile-manager.json');
const gatewayToken = randomBytes(32).toString('hex');
const gatewayObserverId = `webui:playwright-release:${randomBytes(8).toString('hex')}`;
const requiredGatewayBranch = process.env.COWD_E2E_GATEWAY_BRANCH || 'develop';
const requiredEdgeBranch = process.env.COWD_E2E_EDGE_BRANCH || 'develop';
const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required by the release browser gate`);
  return value;
};
const command = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${basename(executable)} ${args.join(' ')} failed (${result.status}): `
      + `${result.stderr || result.stdout || 'no output'}`.trim(),
    );
  }
  return String(result.stdout || '').trim();
};
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const edgeVersion = (() => {
  const manifest = readFileSync(join(repoRoot, 'Cargo.toml'), 'utf8');
  const match = manifest.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('unable to resolve Edge workspace version');
  return match[1];
})();

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForGateway(url, child) {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`specified Gateway exited before readiness (${child.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`specified Gateway did not become ready: ${lastError}`);
}

async function waitForProvider(url, child) {
  const deadline = Date.now() + 15_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`deterministic provider exited before readiness (${child.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`deterministic provider did not become ready: ${lastError}`);
}

function assetDigests(dir, current = dir, result = {}) {
  const entries = command('find', [current, '-type', 'f', '-print0'], { encoding: 'buffer' })
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const path of entries) {
    result[path.slice(dir.length + 1)] = sha256(path);
  }
  return result;
}

function reportCounts(node, counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }) {
  if (node?.stats) {
    for (const key of Object.keys(counts)) counts[key] = Number(node.stats[key] || 0);
    return counts;
  }
  for (const suite of node?.suites || []) reportCounts(suite, counts);
  for (const spec of node?.specs || []) {
    for (const test of spec.tests || []) {
      const outcome = String(test.status || test.outcome || '');
      if (outcome in counts) counts[outcome] += 1;
      else if (test.results?.some((result) => result.status === 'skipped')) counts.skipped += 1;
      else if (test.results?.some((result) => result.status === 'failed')) counts.unexpected += 1;
      else counts.expected += 1;
    }
  }
  return counts;
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

let gateway;
let provider;
let temporaryRoot = '';
let gatewayLogFd;
let providerLogFd;
let provenance = {
  schema_version: 1,
  gate: 'cowd-edge-release-browser',
  status: 'failed',
  started_at: new Date().toISOString(),
};

try {
  mkdirSync(dirname(evidencePath), { recursive: true });
  const binaryInput = required('COWD_E2E_GATEWAY_BINARY');
  if (!isAbsolute(binaryInput)) throw new Error('COWD_E2E_GATEWAY_BINARY must be absolute');
  const binary = realpathSync(binaryInput);
  if (!statSync(binary).isFile()) throw new Error('specified Gateway binary is not a file');
  if ((statSync(binary).mode & 0o111) === 0) throw new Error('specified Gateway binary is not executable');
  const expectedSha = required('COWD_E2E_GATEWAY_SHA256').toLowerCase();
  const actualSha = sha256(binary);
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || expectedSha !== actualSha) {
    throw new Error(`specified Gateway SHA-256 mismatch: expected ${expectedSha}, received ${actualSha}`);
  }

  const sourceDir = realpathSync(required('COWD_E2E_GATEWAY_SOURCE_DIR'));
  const expectedCommit = required('COWD_E2E_GATEWAY_COMMIT');
  const actualCommit = command('git', ['rev-parse', 'HEAD'], { cwd: sourceDir });
  const branch = command('git', ['branch', '--show-current'], { cwd: sourceDir });
  if (actualCommit !== expectedCommit) {
    throw new Error(`Gateway source commit mismatch: expected ${expectedCommit}, received ${actualCommit}`);
  }
  if (branch !== requiredGatewayBranch) {
    throw new Error(
      `Gateway source must be on ${requiredGatewayBranch}, received ${branch || 'detached'}`,
    );
  }
  if (command('git', ['status', '--porcelain'], { cwd: sourceDir })) {
    throw new Error('Gateway source provenance is dirty; commit the reviewed develop state first');
  }
  const binaryVersion = command(binary, ['--version']);
  if (!binaryVersion.includes(edgeVersion)) {
    throw new Error(`Gateway binary version ${binaryVersion} does not match Edge ${edgeVersion}`);
  }
  const binaryCommit = binaryVersion.match(/Git SHA\s+([0-9a-f]+)/i)?.[1]?.toLowerCase();
  if (!binaryCommit || !expectedCommit.toLowerCase().startsWith(binaryCommit)) {
    throw new Error(
      `Gateway binary Git SHA ${binaryCommit || '<missing>'} does not match source ${expectedCommit}`,
    );
  }
  const edgeBranch = command('git', ['branch', '--show-current'], { cwd: repoRoot });
  if (edgeBranch !== requiredEdgeBranch) {
    throw new Error(
      `Edge release source must be on ${requiredEdgeBranch}, received ${edgeBranch || 'detached'}`,
    );
  }
  if (command('git', ['status', '--porcelain'], { cwd: repoRoot })) {
    throw new Error('Edge release source is dirty; commit the reviewed develop state first');
  }

  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: process.env });
  if (build.status !== 0) throw new Error(`current Edge asset build failed (${build.status})`);
  if (command('git', ['status', '--porcelain'], { cwd: repoRoot })) {
    throw new Error(
      'current Edge asset build changed reviewed release source; rebuild and commit deterministic assets before release',
    );
  }

  temporaryRoot = mkdtempSync(join(tmpdir(), 'cowd-edge-release-'));
  const configHome = join(temporaryRoot, 'config');
  const runtimeDir = join(temporaryRoot, 'runtime');
  const homeDir = join(temporaryRoot, 'home');
  const workspaceDir = join(temporaryRoot, 'workspace');
  for (const path of [configHome, runtimeDir, homeDir, workspaceDir]) {
    mkdirSync(path, { recursive: true });
  }
  const providerFixture = realpathSync(join(sourceDir, 'scripts/fixtures/tui-acceptance-provider.mjs'));
  if (!statSync(providerFixture).isFile()) {
    throw new Error('deterministic provider fixture is not a file');
  }
  const providerPort = await availablePort();
  const providerUrl = `http://127.0.0.1:${providerPort}`;
  writeFileSync(join(configHome, 'config.yaml'), `
model: "cowd-tui-acceptance-model"
model_context_windows:
  cowd-tui-acceptance-model: 16384
providers:
  tui_acceptance:
    base_url: "${providerUrl}/v1"
    api_key: "local-fixture-key"
    protocol: "completions"
    models:
      - "cowd-tui-acceptance-model"
permissions:
  default_mode: "acceptEdits"
sandbox:
  enabled: false
gateway:
  enabled: true
  webui_dir: "${join(root, 'dist').replaceAll('\\', '\\\\')}"
  platforms:
    - platformType: "api_server"
      enabled: true
      host: "127.0.0.1"
      port: 0
      auth:
        enabled: true
        token: "${gatewayToken}"
apps:
  mfg:
    enabled: true
`.trimStart());

  const gatewayPort = await availablePort();
  const webPort = await availablePort();
  const configPath = join(configHome, 'config.yaml');
  writeFileSync(
    configPath,
    readFileSync(configPath, 'utf8').replace('port: 0', `port: ${gatewayPort}`),
  );
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  rmSync(providerLogPath, { force: true });
  providerLogFd = openSync(providerStdoutPath, 'w', 0o600);
  provider = spawn(process.execPath, [providerFixture], {
    cwd: sourceDir,
    env: {
      ...process.env,
      COWD_TUI_ACCEPTANCE_PROVIDER_PORT: String(providerPort),
      COWD_TUI_ACCEPTANCE_PROVIDER_LOG: providerLogPath,
    },
    stdio: ['ignore', providerLogFd, providerLogFd],
  });
  await waitForProvider(providerUrl, provider);

  const isolatedEnv = {
    ...process.env,
    HOME: homeDir,
    COWD_CONFIG_HOME: configHome,
    COWD_E2E_HARNESS: '1',
    COWD_E2E_STRATEGY_FIXTURE: 'explicit-team-negative',
    XDG_RUNTIME_DIR: runtimeDir,
    XDG_DATA_HOME: join(temporaryRoot, 'data'),
    XDG_STATE_HOME: join(temporaryRoot, 'state'),
    XDG_CACHE_HOME: join(temporaryRoot, 'cache'),
  };
  gatewayLogFd = openSync(gatewayLogPath, 'w', 0o600);
  gateway = spawn(binary, ['gateway', 'run'], {
    cwd: workspaceDir,
    env: isolatedEnv,
    stdio: ['ignore', gatewayLogFd, gatewayLogFd],
  });
  await waitForGateway(gatewayUrl, gateway);

  const currentEntitlement = JSON.parse(command(binary, ['auth', 'profile', 'show'], {
    env: isolatedEnv,
    input: `${gatewayToken}\n`,
  }));
  const profileArgs = [
    'auth',
    'profile',
    'set',
    '--core-profile',
    'core_manager',
    '--apps',
    'mfg=mfg_manager',
    '--expected-epoch',
    String(currentEntitlement.credential_epoch),
    '--expected-revision',
    String(currentEntitlement.profile_revision),
  ];
  const preview = spawnSync(binary, [...profileArgs, '--confirm', 'invalid'], {
    encoding: 'utf8',
    env: isolatedEnv,
    input: `${gatewayToken}\n`,
  });
  if (preview.status === 0) {
    throw new Error('invalid Auth Broker profile confirmation unexpectedly succeeded');
  }
  const confirmation = String(preview.stderr || '').match(/confirmation=(\S+)/)?.[1];
  if (!confirmation) {
    throw new Error(`Auth Broker profile preview did not emit a confirmation digest: ${preview.stderr}`);
  }
  const managerEntitlement = JSON.parse(command(
    binary,
    [...profileArgs, '--confirm', confirmation],
    {
      env: isolatedEnv,
      input: `${gatewayToken}\n`,
    },
  ));
  if (
    managerEntitlement.core_profile_id !== 'core_manager'
    || managerEntitlement.app_profiles?.mfg !== 'mfg_manager'
    || !managerEntitlement.ceiling?.includes('mfg.cockpit.manage')
  ) {
    throw new Error('Auth Broker did not project the required MFG manager entitlement');
  }
  writeFileSync(
    profileEvidencePath,
    `${JSON.stringify(managerEntitlement, null, 2)}\n`,
    { mode: 0o600 },
  );

  const openApiResponse = await fetch(`${gatewayUrl}/api/gateway/openapi.json`);
  if (!openApiResponse.ok) throw new Error(`Gateway OpenAPI provenance failed (${openApiResponse.status})`);
  const openApi = await openApiResponse.json();
  if (String(openApi?.info?.version || '') !== edgeVersion) {
    throw new Error(`Gateway OpenAPI version ${openApi?.info?.version || 'missing'} does not match ${edgeVersion}`);
  }

  provenance = {
    ...provenance,
    edge_version: edgeVersion,
    edge_commit: command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    edge_branch: edgeBranch,
    release_assets_sha256: assetDigests(join(root, 'dist')),
    gateway: {
      binary,
      sha256: actualSha,
      version_output: binaryVersion,
      source_dir: sourceDir,
      source_branch: branch,
      source_commit: actualCommit,
      pid: gateway.pid,
      url: gatewayUrl,
      openapi_version: openApi.info.version,
      isolated_state: true,
      auth: {
        mode: 'isolated-bearer',
        token_recorded: false,
        observer_id: gatewayObserverId,
      },
    },
    provider: {
      fixture: providerFixture,
      fixture_sha256: sha256(providerFixture),
      pid: provider.pid,
      url: providerUrl,
      model: 'cowd-tui-acceptance-model',
      deterministic: true,
      request_log: providerLogPath,
      stdout_log: providerStdoutPath,
    },
    strategy_fixture: {
      harness: 'isolated-e2e-only',
      name: 'explicit-team-negative',
      prompt_marker_required: true,
    },
    authorization_profile: {
      core_profile_id: managerEntitlement.core_profile_id,
      app_profiles: managerEntitlement.app_profiles,
      profile_revision: managerEntitlement.profile_revision,
      evidence: profileEvidencePath,
      confirmation_flow: 'preview-confirm-cas',
    },
    web_url: webUrl,
  };
  writeFileSync(evidencePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });

  const playwright = join(root, 'node_modules/.bin/playwright');
  if (!existsSync(playwright)) throw new Error('local Playwright executable is missing');
  rmSync(reportPath, { force: true });
  const testRun = spawnSync(playwright, [
    'test',
    '--browser=chromium',
    '--workers=1',
    '--forbid-only',
    '--reporter=json',
    `--output=${join(dirname(evidencePath), 'playwright-artifacts')}`,
  ], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      COWD_E2E_RELEASE_ENTRY: '1',
      COWD_E2E_GATEWAY_URL: gatewayUrl,
      COWD_E2E_GATEWAY_TOKEN: gatewayToken,
      COWD_E2E_OBSERVER_ID: gatewayObserverId,
      COWD_VITE_GATEWAY_URL: gatewayUrl,
      COWD_E2E_WEB_URL: webUrl,
      COWD_E2E_GATEWAY_PROVENANCE: evidencePath,
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
    },
  });
  if (!existsSync(reportPath)) throw new Error('Playwright JSON report was not emitted');
  const counts = reportCounts(JSON.parse(readFileSync(reportPath, 'utf8')));
  if (testRun.status !== 0 || counts.unexpected || counts.skipped || counts.expected < 1) {
    throw new Error(
      `release browser suite failed: exit=${testRun.status}, `
      + `expected=${counts.expected}, unexpected=${counts.unexpected}, skipped=${counts.skipped}`,
    );
  }
  provenance.status = 'passed';
  provenance.playwright = counts;
} catch (error) {
  provenance.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await terminate(gateway);
  await terminate(provider);
  if (gatewayLogFd !== undefined) closeSync(gatewayLogFd);
  if (providerLogFd !== undefined) closeSync(providerLogFd);
  provenance.finished_at = new Date().toISOString();
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
