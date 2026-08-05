import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { gatewayRequestedCapabilities } from './e2e-release-contract.js';

const realGateway = Boolean(process.env.COWD_E2E_GATEWAY_URL);
const gatewayObserverId = process.env.COWD_E2E_OBSERVER_ID || 'webui:playwright-release';
const useReleaseEntry = process.env.COWD_E2E_RELEASE_ENTRY === '1';
const sourceEntry = fileURLToPath(new URL('./index.dev.html', import.meta.url));
const requiredNavigationLabels = [
  'Chat',
  'Mission',
  'Runtime',
  'Context',
  'Reality',
  'Memory',
  'Skills',
  'Agents',
  'Tools',
  'Surfaces',
  'Gateway',
  'Manufacturing operations workspace',
  'Audit',
  'Settings',
];

async function expectOk(response, label) {
  if (response.ok()) return;
  throw new Error(`${label} failed with HTTP ${response.status()}: ${await response.text()}`);
}

async function installOfflineGatewayContract(page) {
  const responses = new Map([
    ['/api/auth/verify', { valid: true, auth_required: false }],
    ['/api/webui/manifest', {
      health: { status: 'healthy' },
      version: '0.0.0-test',
      enabled_app_ids: ['mfg'],
    }],
    ['/api/config', { model: 'offline-browser-test', version: '0.0.0-test' }],
    ['/api/runtime/control-plane', { configured_model: 'offline-browser-test' }],
    ['/api/config/providers', { providers: [], models: [] }],
    ['/api/profiles', { profiles: [], active_profile: 'default' }],
    ['/api/slash', { commands: [] }],
    ['/api/sessions', { sessions: [] }],
    ['/api/workspace', {
      workspace_root: '/workspace',
      workspace_canonical: '/workspace',
    }],
    ['/api/workspace/files', { dir: '', files: [] }],
    ['/api/gateway/capability-contract', { schema_version: 1, capabilities: [] }],
  ]);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/stream') || url.pathname.endsWith('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': deterministic offline browser contract\n\n',
      });
      return;
    }
    const body = responses.get(url.pathname);
    await route.fulfill({
      status: body ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(body || {
        error: 'offline browser test requires an explicit API fixture',
        path: url.pathname,
      }),
    });
  });
}

async function expectSemanticNavigation(locator) {
  await expect.poll(async () => {
    const labels = (await locator.evaluateAll((items) => items.map((item) => (
      item.getAttribute('aria-label') || item.textContent || ''
    )).map((label) => label.trim()))).filter(Boolean);
    return requiredNavigationLabels.every((label) => labels.includes(label));
  }).toBe(true);
  const labels = (await locator.evaluateAll((items) => items.map((item) => (
    item.getAttribute('aria-label') || item.textContent || ''
  )).map((label) => label.trim()))).filter(Boolean);
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels).toEqual(expect.arrayContaining(requiredNavigationLabels));
}

test.beforeEach(async ({ page }) => {
  // Vite serves the checked-in release entry as a static file.  Browser tests
  // must exercise current source; the release entry is covered explicitly
  // after `npm run build` with COWD_E2E_RELEASE_ENTRY=1.
  if (!useReleaseEntry) {
    await page.context().route('**/index.html', (route) => route.fulfill({ path: sourceEntry }));
  }
  await page.addInitScript((observerId) => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
    sessionStorage.setItem('cowd.webui.observer_id', observerId);
  }, gatewayObserverId);
  if (!realGateway) {
    await installOfflineGatewayContract(page);
  }
  if (realGateway) {
    const health = await page.request.get('/healthz');
    expect(health.status()).toBe(200);
    const capabilities = await page.request.get('/api/cowd/capabilities');
    expect(capabilities.status()).toBe(200);
    expect((await capabilities.json()).capabilities).toBeTruthy();
  }
});

test('new shell uses icon rail and right Activity/Workspace companion tabs', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await expectSemanticNavigation(page.locator('.rail-button:not(.mobile-more)'));
  await expect(page.locator('.session-sidebar')).toBeVisible();
  await expect(page.locator('.companion-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.locator('.companion-tabs')).toContainText('Activity');
  await expect(page.locator('.companion-tabs')).toContainText('Workspace');
  await expect(page.locator('.companion-tabs')).toContainText('Inspector');
  await expect(page.locator('.rail')).not.toContainText('Workspace');
  await expect(page.locator('.run-panorama')).toHaveCount(0);
  await expect(page.locator('.transcript')).toBeVisible();
  await expect(page.locator('.composer textarea')).toBeVisible();
  await expect(page.locator('.turn-role')).toHaveCount(0);
  await expect(page.locator('.composer-runtime-summary')).toBeVisible();
  await expect(page.locator('.composer-runtime-chip.model')).not.toHaveText('');
  await page.getByRole('button', { name: 'Collapse inspector' }).click();
  await expect(page.locator('.run-panorama')).toHaveCount(0);
  await expect(page.locator('.companion-panel')).toHaveCount(0);
});

test('duplicated tabs claim unique observers and cannot demote the active writer', async ({ page, context }) => {
  const sessionId = 'duplicate-tab-session';
  const title = 'Duplicate tab regression';
  const attachments = new Map();
  let messageSequence = 0;
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const installSessionContract = async (target) => {
    await target.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const observerId = request.headers()['x-cowd-observer-id'] || '';
      if (path === '/api/sessions' && request.method() === 'GET') {
        return json(route, {
          sessions: [{
            id: sessionId,
            title,
            status: 'idle',
            model: 'browser-test',
            message_count: 0,
            updated_at: '2026-08-05T00:00:00Z',
          }],
        });
      }
      if (path === `/api/sessions/${sessionId}/attach` && request.method() === 'POST') {
        const role = JSON.parse(request.postData() || '{}').role;
        attachments.set(observerId, role);
        return json(route, { ok: true, session_id: sessionId, role });
      }
      if (path === `/api/sessions/${sessionId}/detach` && request.method() === 'POST') {
        attachments.delete(observerId);
        return json(route, { ok: true });
      }
      if (path === `/api/sessions/${sessionId}/messages` && request.method() === 'GET') {
        return json(route, { session_id: sessionId, messages: [], total: 0, offset: 0 });
      }
      if (path === `/api/sessions/${sessionId}/messages` && request.method() === 'POST') {
        if (attachments.get(observerId) !== 'writer') {
          return json(route, { error: 'reader session attachment cannot execute mutations' }, 403);
        }
        messageSequence += 1;
        return json(route, {
          message: {
            message_id: `message-${messageSequence}`,
            sequence: messageSequence,
            turn_id: 'turn-1',
          },
          execution: {
            graph_id: 'execution-1',
            turn_id: 'turn-1',
            status: 'queued',
            materialization: { state: 'accepted' },
          },
          input: {
            input_id: `input-${messageSequence}`,
            decision: messageSequence === 1 ? 'start_new_turn' : 'supplement_current',
          },
        });
      }
      if (path === '/api/runtime/session-leases/acquire') return json(route, { ok: true });
      if (path === '/api/runtime/session-leases/release') return json(route, { ok: true });
      if (path === `/api/sessions/${sessionId}/execution`) {
        return json(route, { session_id: sessionId, active_execution_ids: [] });
      }
      if (path === `/api/sessions/${sessionId}/history-index`) {
        return json(route, {
          schema_version: 1,
          session_id: sessionId,
          total_messages: 0,
          recent_metadata: [],
          cards: [],
        });
      }
      if (path === `/api/sessions/${sessionId}/turns`) {
        return json(route, {
          kind: 'session.turn_projection',
          session_id: sessionId,
          turn_count: 0,
          turns: [],
        });
      }
      if ([
        `/api/sessions/${sessionId}/attachments`,
        `/api/sessions/${sessionId}/inputs`,
        `/api/sessions/${sessionId}/turn-inbox`,
      ].includes(path)) return json(route, {});
      return route.fallback();
    });
  };
  await installSessionContract(page);
  await page.goto('/index.html#/chat');
  await page.locator('.composer textarea').waitFor();
  const firstObserver = await page.evaluate(() => sessionStorage.getItem('cowd.webui.observer_id'));

  const firstSend = page.waitForResponse((response) => (
    response.url().endsWith(`/api/sessions/${sessionId}/messages`)
    && response.request().method() === 'POST'
  ));
  await page.locator('.composer textarea').fill('first');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('');
  expect((await firstSend).status()).toBe(200);

  const second = await context.newPage();
  await second.addInitScript((observerId) => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
    sessionStorage.setItem('cowd.webui.observer_id', observerId);
  }, gatewayObserverId);
  await installOfflineGatewayContract(second);
  await installSessionContract(second);
  await second.goto('/index.html#/chat');
  await second.locator('.composer textarea').waitFor();
  const secondObserver = await second.evaluate(() => sessionStorage.getItem('cowd.webui.observer_id'));
  expect(secondObserver).not.toBe(firstObserver);

  const supplement = page.waitForResponse((response) => (
    response.url().endsWith(`/api/sessions/${sessionId}/messages`)
    && response.request().method() === 'POST'
  ));
  await page.locator('.composer textarea').fill('supplement');
  await page.getByRole('button', { name: 'Supplement current execution' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('');
  expect((await supplement).status()).toBe(200);
  await expect(page.getByText('Restricted session')).toHaveCount(0);
  await second.close();
});

test('historical turns hydrate their own execution trees after messages render', async ({ page }) => {
  const sessionId = 'historical-turn-session';
  let projectionRequestedFromStart = false;
  const messages = [1, 2, 3].flatMap((number) => ([
    {
      id: `user-${number}`,
      session_id: sessionId,
      sequence: number * 2 - 2,
      role: 'user',
      blocks: [{
        type: 'text',
        text: `question ${number}`,
        cowd_turn_id: `turn-${number}`,
        cowd_turn_ingress_message_id: `user-${number}`,
      }],
    },
    {
      id: `assistant-${number}`,
      session_id: sessionId,
      sequence: number * 2 - 1,
      role: 'assistant',
      blocks: [{
        type: 'text',
        text: `answer ${number}`,
        cowd_turn_id: `turn-${number}`,
        cowd_turn_ingress_message_id: `user-${number}`,
      }],
    },
  ]));
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/sessions' && request.method() === 'GET') {
      return json(route, {
        sessions: [{
          id: sessionId,
          title: 'Historical turns',
          status: 'complete',
          model: 'browser-test',
          message_count: messages.length,
          updated_at: '2026-08-05T00:00:00Z',
        }],
      });
    }
    if (path === `/api/sessions/${sessionId}/messages`) {
      return json(route, {
        session_id: sessionId,
        messages,
        total: messages.length,
        offset: 0,
      });
    }
    if (path === `/api/sessions/${sessionId}/turns`) {
      projectionRequestedFromStart = url.searchParams.has('from_seq');
      return json(route, {
        kind: 'session.turn_projection',
        session_id: sessionId,
        turn_count: 3,
        turns: [1, 2, 3].map((number) => ({
          turn_id: `turn-${number}`,
          status: 'completed',
          user_preview: `question ${number}`,
          tool_calls: [],
          approvals: [],
          context_events: [],
          usage: [],
          evidence_refs: [],
          event_sequences: [],
          activity_events: [{
            id: `agent-${number}`,
            kind: 'agent',
            title: `researcher ${number}`,
            status: 'completed',
            turn_id: `turn-${number}`,
            execution_id: `execution-${number}`,
            agent_id: `researcher-${number}`,
            output: `result ${number}`,
          }, {
            id: `tool-${number}`,
            kind: 'tool',
            title: 'read_file',
            status: 'completed',
            turn_id: `turn-${number}`,
            execution_id: `execution-${number}`,
            tool_call_id: `tool-${number}`,
          }],
        })),
      });
    }
    if (path === `/api/sessions/${sessionId}/execution`) {
      return json(route, {
        session_id: sessionId,
        latest_execution_id: 'execution-3',
        latest_graph_id: 'execution-3',
        latest_status: 'complete',
        active_execution_ids: [],
        executions: [1, 2, 3].map((number) => ({
          execution_id: `execution-${number}`,
          graph_id: `execution-${number}`,
          turn_id: `turn-${number}`,
          status: 'complete',
          updated_at_ms: number,
        })),
      });
    }
    const executionMatch = path.match(/^\/api\/runtime\/executions\/(execution-\d+)$/);
    if (executionMatch) {
      const executionId = executionMatch[1];
      const number = Number(executionId.split('-').at(-1));
      const rootActivityId = `activity:${executionId}:root`;
      const toolActivityId = `activity:${executionId}:tool`;
      return json(route, {
        schema_version: 2,
        kind: 'runtime.execution_projection',
        execution_id: executionId,
        revision: 3,
        cursor: 3,
        detail_scope: url.searchParams.get('detail_scope') || 'summary',
        authorization_revision: 1,
        redaction_revision: 'e2e',
        live: { status: 'complete' },
        graph: {
          graph_id: executionId,
          revision: 3,
          objective: `Historical objective ${number}`,
          nodes: [],
          edges: [],
          commit_cursor: 3,
        },
        child_executions: [],
        goals: [],
        agents: [],
        teams: [],
        relations: [],
        approvals: [],
        admissions: [],
        outcomes: [],
        interventions: [],
        usage: [],
        context: [],
        evidence: [],
        health: [],
        recovery: [],
        available_commands: [],
        activities: [{
          schema_version: 1,
          activity_id: rootActivityId,
          scope: {
            workspace_id: 'workspace',
            session_id: sessionId,
            turn_id: `turn-${number}`,
            execution_id: executionId,
          },
          kind: 'execution',
          visibility: ['narrative', 'operational', 'audit'],
          causal_parent_ids: [],
          dependency_ids: [],
          status: 'completed',
          started_at_ms: number,
          completed_at_ms: number + 2,
          duration_ms: 2,
          sequence: 1,
          commit_cursor: 1,
          public_summary: `Historical objective ${number}`,
          artifact_refs: [],
          evidence_refs: [],
        }, {
          schema_version: 1,
          activity_id: toolActivityId,
          scope: {
            workspace_id: 'workspace',
            session_id: sessionId,
            turn_id: `turn-${number}`,
            execution_id: executionId,
          },
          kind: 'tool',
          visibility: ['narrative', 'operational', 'audit'],
          parent_activity_id: rootActivityId,
          initiator_activity_id: rootActivityId,
          causal_parent_ids: [],
          dependency_ids: [],
          tool_call_id: `history-tool-${number}`,
          status: 'completed',
          started_at_ms: number + 1,
          completed_at_ms: number + 2,
          duration_ms: 1,
          sequence: 2,
          commit_cursor: 2,
          public_summary: `history_tool_${number}`,
          artifact_refs: [`artifact://history-${number}`],
          evidence_refs: [`evidence://history-${number}`],
        }],
        activity_relations: [{
          relation_id: `relation:${executionId}:tool`,
          kind: 'invoked',
          from_activity_id: rootActivityId,
          to_activity_id: toolActivityId,
        }],
      });
    }
    if (path === `/api/sessions/${sessionId}/attach`) {
      return json(route, { ok: true, session_id: sessionId, role: 'reader' });
    }
    if (path === `/api/sessions/${sessionId}/history-index`) {
      return json(route, {
        schema_version: 1,
        session_id: sessionId,
        total_messages: messages.length,
        recent_metadata: [],
        cards: [],
      });
    }
    if ([
      `/api/sessions/${sessionId}/attachments`,
      `/api/sessions/${sessionId}/inputs`,
      `/api/sessions/${sessionId}/turn-inbox`,
    ].includes(path)) return json(route, {});
    return route.fallback();
  });

  await page.goto('/index.html#/chat');
  await expect(page.locator('.turn[data-role="user"]')).toHaveCount(3);
  await expect(page.locator('.turn[data-role="assistant"] .conversation-execution > .execution-activity-tree')).toHaveCount(3);
  expect(projectionRequestedFromStart).toBe(false);

  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.locator('.execution-turn-group')).toHaveCount(3);
  await expect(page.locator('.execution-turn-head').first()).toContainText('Turn 3');

  const historicalTurn = page.locator('.execution-turn-group').filter({ hasText: 'Turn 1' });
  await expect(historicalTurn).toContainText('researcher 1');
  await historicalTurn.getByRole('button', { name: 'Execution graph' }).click();
  const historicalGraph = page.locator('.chat-execution-overlay');
  await expect(historicalGraph).toBeVisible();
  await expect(historicalGraph.locator('.vue-flow__node')).toHaveCount(2);
  await expect(historicalGraph).toContainText('Tool call · 1');
  await historicalGraph.locator('.vue-flow__node').filter({ hasText: 'Tool call · 1' }).click();
  await expect(historicalGraph.locator('.execution-node-detail')).toBeVisible();
  await expect(historicalGraph.locator('.execution-node-detail')).toContainText('Tool call');
  await expect.poll(async () => historicalGraph.locator('.vue-flow__node').evaluateAll((nodes) => {
    const surface = document.querySelector('.chat-execution-overlay .vue-flow');
    if (!surface) return 0;
    const bounds = surface.getBoundingClientRect();
    return nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0
        && rect.height > 0
        && rect.right > bounds.left
        && rect.left < bounds.right
        && rect.bottom > bounds.top
        && rect.top < bounds.bottom
      );
    }).length;
  })).toBe(2);
});

test('chat DOM keeps newest history, errors, drafts, scroll and effective telemetry isolated per session', async ({ page }) => {
  const browserErrors = [];
  const browserRequestFailures = [];
  const browserHttpFailures = [];
  page.on('pageerror', (error) => browserErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => {
    browserRequestFailures.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      browserHttpFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  const messages = (sessionId, count) => Array.from({ length: count }, (_, sequence) => ({
    id: `${sessionId}-message-${sequence}`,
    session_id: sessionId,
    sequence,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    blocks: [{ type: 'text', text: `${sessionId}-durable-${sequence}` }],
  }));
  const historyA = messages('session-A', 205);
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  // Match only the Gateway root namespace. A broad `**/api/**` glob also
  // captures Vite source modules such as `/src/api/client.ts` and silently
  // replaces executable JavaScript with fixture JSON.
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/stream') || path.endsWith('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': deterministic browser acceptance\n\n',
      });
      return;
    }
    if (path === '/api/auth/verify') return json(route, { valid: true, auth_required: false });
    if (path === '/api/webui/manifest') return json(route, { health: { status: 'healthy' }, version: '0.0.0-test' });
    if (path === '/api/sessions' && request.method() === 'GET') {
      return json(route, {
        sessions: [
          { id: 'session-A', title: 'Session A', status: 'idle', model: 'requested-A', message_count: 205, updated_at: '2026-07-24T05:00:00Z' },
          { id: 'session-B', title: 'Session B', status: 'idle', model: 'requested-B', message_count: 3, updated_at: '2026-07-24T04:00:00Z' },
        ],
      });
    }
    const historyMatch = path.match(/^\/api\/sessions\/(session-[AB])\/messages$/);
    if (historyMatch && request.method() === 'GET') {
      const sessionId = historyMatch[1];
      if (sessionId === 'session-B') {
        return json(route, { error: 'browser acceptance history unavailable' }, 500);
      }
      const limit = Number(url.searchParams.get('limit') || 100);
      const offset = url.searchParams.get('tail') === 'true'
        ? Math.max(0, historyA.length - limit)
        : Number(url.searchParams.get('offset') || 0);
      return json(route, {
        session_id: sessionId,
        messages: historyA.slice(offset, offset + limit),
        total: historyA.length,
        offset,
        limit,
        has_more: offset + limit < historyA.length,
      });
    }
    const turnProjectionMatch = path.match(/^\/api\/sessions\/(session-[AB])\/turns$/);
    if (turnProjectionMatch && request.method() === 'GET') {
      return json(route, {
        kind: 'session.turn_projection',
        session_id: turnProjectionMatch[1],
        turn_count: 0,
        turns: [],
      });
    }
    const sessionMatch = path.match(/^\/api\/sessions\/(session-[AB])\/(attach|detach|evidence|execution|attachments|inputs|turn-inbox)$/);
    if (sessionMatch) {
      const [, sessionId, resource] = sessionMatch;
      if (resource === 'attach') return json(route, { ok: true, session_id: sessionId, role: 'writer' });
      if (resource === 'detach') return json(route, { ok: true });
      if (resource === 'evidence') return json(route, { session_id: sessionId, evidence_refs: [], turns: [], freshness: 'ready' });
      if (resource === 'execution') return json(route, { session_id: sessionId, latest_execution_id: `execution-${sessionId}` });
      if (resource === 'attachments') return json(route, { attachments: [] });
      return json(route, {});
    }
    if (path === '/api/runtime/session-leases/acquire') return json(route, { ok: true });
    const executionMatch = path.match(/^\/api\/runtime\/executions\/(execution-session-[AB])$/);
    if (executionMatch) {
      const sessionId = executionMatch[1].replace('execution-', '');
      const metrics = sessionId === 'session-A' ? { tool_calls: 0, memory_recalls: 0, memory_evidence: 0 } : {};
      return json(route, {
        schema_version: 2,
        execution_id: executionMatch[1],
        revision: 1,
        cursor: 1,
        detail_scope: 'summary',
        authorization_revision: 1,
        redaction_revision: 'browser-acceptance',
        session_id: sessionId,
        graph: {
          execution_id: executionMatch[1],
          revision: 1,
          commit_cursor: 1,
          objective: 'browser acceptance',
          service_class: 'foreground',
          parent_execution: null,
          nodes: [],
          edges: [],
          terminal_result_ref: `terminal-${sessionId}`,
        },
        child_executions: [],
        goals: [],
        agents: [],
        teams: [],
        relations: [],
        approvals: [],
        admissions: [],
        outcomes: [],
        interventions: [],
        usage: [],
        context: [],
        evidence: [],
        health: [],
        recovery: [],
        available_commands: [],
        live: {
          status: 'complete',
          status_detail: 'durable terminal',
          metrics,
          context_usage: {
            model: `effective-${sessionId.at(-1)}`,
            input_tokens: 512,
            window_tokens: 4096,
            usage_percent_bp: 1250,
          },
        },
      });
    }
    if (path === '/api/config') return json(route, { model: 'requested-A', version: '0.0.0-test' });
    if (path === '/api/runtime/control-plane') return json(route, { configured_model: 'requested-A' });
    if (path === '/api/config/providers') return json(route, { providers: [], models: [{ id: 'requested-A' }, { id: 'requested-B' }] });
    if (path === '/api/profiles') return json(route, { profiles: [], active_profile: 'default' });
    if (path === '/api/slash') return json(route, { commands: [] });
    if (path === '/api/workspace') return json(route, { workspace_root: '/workspace', workspace_canonical: '/workspace' });
    if (path === '/api/workspace/files') return json(route, { dir: '', files: [] });
    if (path === '/api/gateway/capability-contract') return json(route, { schema_version: 1, capabilities: [] });
    if (path === '/api/gateway/openapi.json') return json(route, { openapi: '3.1.0', info: { version: '0.0.0-test' }, paths: {} });
    if (path === '/api/gateway/openai-tools') return json(route, { schema_version: 1, source: 'browser-acceptance', tool_count: 0, tools: [] });
    return json(route, {});
  });

  await page.goto('/index.html#/chat');
  const transcript = page.locator('.transcript');
  await expect(transcript).toBeVisible();
  expect(browserErrors).toEqual([]);
  expect(browserRequestFailures).toEqual([]);
  expect(browserHttpFailures).toEqual([]);
  await expect(transcript).toContainText('session-A-durable-155');
  await expect(transcript).toContainText('session-A-durable-204');
  await expect(transcript).not.toContainText('session-A-durable-0');
  await expect(page.locator('.history-controls')).toContainText('156–205 / 205');
  await expect(page.locator('.composer-runtime-chip.model')).toContainText('requested-A');
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.locator('.composer-runtime-chip.model')).toContainText('effective-A');
  await expect(page.locator('.composer-runtime-summary')).toContainText('0');

  await page.locator('.composer textarea').fill('draft belongs only to A');
  await transcript.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.locator('.session-row').filter({ hasText: 'Session B' }).click();
  await expect(page.locator('.chat-execution-status'))
    .toHaveAttribute('title', /500|server|history unavailable/i);
  await page.locator('.composer textarea').fill('draft belongs only to B');
  await expect(page.locator('.composer-runtime-chip.model')).toContainText('effective-B');
  await expect(page.locator('.composer-runtime-summary')).not.toContainText('effective-A');

  await page.locator('.session-row').filter({ hasText: 'Session A' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('draft belongs only to A');
  await expect(transcript).toContainText('session-A-durable-204');
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(transcript).toContainText('session-A-durable-105');
  await expect(page.locator('.history-controls')).toContainText('106–205 / 205');

  await page.locator('.session-row').filter({ hasText: 'Session B' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('draft belongs only to B');
  await expect(page.locator('.chat-execution-status'))
    .toHaveAttribute('title', /500|server|history unavailable/i);
});

test('session authorization revocation clears that view, fences reconnects, and leaves another session interactive', async ({ page }) => {
  const revokedSession = 'revoked-session-A';
  const healthySession = 'healthy-session-B';
  const liveSubscriptionId = 'revocation-live-subscription';
  let liveSubscriptionRevision = 0;
  let revokedStreamRequests = 0;
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/verify') return json(route, { valid: true, auth_required: false });
    if (path === '/api/webui/manifest') return json(route, { health: { status: 'healthy' }, version: '0.0.0-test' });
    if (path === '/api/sessions' && request.method() === 'GET') {
      return json(route, {
        sessions: [
          { id: revokedSession, title: 'Revoked A', status: 'active', model: 'private-model-A', updated_at: '2026-07-24T06:00:00Z' },
          { id: healthySession, title: 'Healthy B', status: 'idle', model: 'healthy-model-B', updated_at: '2026-07-24T05:00:00Z' },
        ],
      });
    }
    if (path === '/api/runtime/live-subscriptions' && request.method() === 'POST') {
      const body = request.postDataJSON();
      liveSubscriptionRevision += 1;
      return json(route, {
        schema_version: 1,
        id: liveSubscriptionId,
        surface_instance: body.surface_instance,
        revision: liveSubscriptionRevision,
        selector: body.selector,
        selector_hash: `revocation-selector-${liveSubscriptionRevision}`,
        expires_at_ms: Date.now() + 60_000,
        stream_url: `/api/runtime/live/${liveSubscriptionId}`,
      });
    }
    if (
      path === `/api/runtime/live-subscriptions/${liveSubscriptionId}`
      && request.method() === 'PATCH'
    ) {
      const body = request.postDataJSON();
      liveSubscriptionRevision += 1;
      return json(route, {
        schema_version: 1,
        id: liveSubscriptionId,
        surface_instance: 'webui:revocation-e2e',
        revision: liveSubscriptionRevision,
        selector: body.selector,
        selector_hash: `revocation-selector-${liveSubscriptionRevision}`,
        expires_at_ms: Date.now() + 60_000,
        stream_url: `/api/runtime/live/${liveSubscriptionId}`,
      });
    }
    if (
      path === `/api/runtime/live-subscriptions/${liveSubscriptionId}`
      && request.method() === 'DELETE'
    ) {
      return route.fulfill({ status: 204 });
    }
    if (path === `/api/runtime/live/${liveSubscriptionId}`) {
      revokedStreamRequests += 1;
      const envelope = (event, sourceKind, sourceId, sourceHealth, payload) => [
        'event: live',
        `data: ${JSON.stringify({
          schema_version: 1,
          subscription_id: liveSubscriptionId,
          subscription_revision: liveSubscriptionRevision,
          source_kind: sourceKind,
          source_id: sourceId,
          detail_scope: 'summary',
          source_cursor: 1,
          delivery_class: 'durable',
          source_health: sourceHealth,
          event,
          payload,
          session_id: sourceKind === 'session' ? sourceId : undefined,
        })}`,
        '',
      ].join('\n');
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: [
          envelope(
            'subscription.ready',
            'subscription',
            liveSubscriptionId,
            'live',
            {},
          ),
          envelope(
            'source.authorization_revoked',
            'session',
            revokedSession,
            'revoked',
            { reason: 'credential epoch revoked' },
          ),
          '',
        ].join('\n'),
      });
    }
    const sessionMatch = path.match(/^\/api\/sessions\/(revoked-session-A|healthy-session-B)\/(messages|attach|detach|evidence|execution|attachments|inputs|turn-inbox|stream)$/);
    if (sessionMatch) {
      const [, sessionId, resource] = sessionMatch;
      if (resource === 'stream') return route.fulfill({ status: 410 });
      if (resource === 'messages') {
        const text = sessionId === revokedSession
          ? 'SECRET-A-MUST-BE-CLEARED'
          : 'HEALTHY-B-REMAINS-VISIBLE';
        return json(route, {
          session_id: sessionId,
          total: 1,
          offset: 0,
          limit: 100,
          has_more: false,
          messages: [{
            id: `${sessionId}-message-0`,
            session_id: sessionId,
            sequence: 0,
            role: 'assistant',
            blocks: [{ type: 'text', text }],
          }],
        });
      }
      if (resource === 'attach') return json(route, { ok: true, session_id: sessionId, role: 'writer' });
      if (resource === 'detach') return json(route, { ok: true });
      if (resource === 'evidence') {
        return json(route, {
          session_id: sessionId,
          evidence_refs: sessionId === revokedSession ? ['private-evidence-A'] : [],
          turns: [],
          freshness: 'ready',
        });
      }
      if (resource === 'execution') {
        return json(route, { session_id: sessionId, latest_execution_id: `execution-${sessionId}` });
      }
      if (resource === 'attachments') return json(route, { attachments: [] });
      return json(route, {});
    }
    if (path === '/api/runtime/session-leases/acquire' || path === '/api/runtime/session-leases/release') {
      return json(route, { ok: true });
    }
    const executionMatch = path.match(/^\/api\/runtime\/executions\/execution-(revoked-session-A|healthy-session-B)$/);
    if (executionMatch) {
      const sessionId = executionMatch[1];
      return json(route, {
        schema_version: 2,
        execution_id: `execution-${sessionId}`,
        revision: 1,
        cursor: 1,
        detail_scope: 'summary',
        authorization_revision: 1,
        redaction_revision: 'revocation-e2e',
        session_id: sessionId,
        graph: {
          execution_id: `execution-${sessionId}`,
          revision: 1,
          commit_cursor: 1,
          objective: 'revocation acceptance',
          service_class: 'foreground',
          parent_execution: null,
          nodes: [],
          edges: [],
          terminal_result_ref: null,
        },
        child_executions: [],
        goals: [],
        agents: [],
        teams: [],
        relations: [],
        approvals: [],
        admissions: [],
        outcomes: [],
        interventions: [],
        usage: [],
        context: [],
        evidence: sessionId === revokedSession ? [{ evidence_ref: 'private-evidence-A' }] : [],
        health: [],
        recovery: [],
        available_commands: [],
        live: {
          status: 'complete',
          status_detail: 'terminal',
          metrics: { tool_calls: 0, memory_recalls: 0, memory_evidence: 0 },
          context_usage: {
            model: sessionId === revokedSession ? 'private-effective-A' : 'healthy-effective-B',
            input_tokens: 10,
            window_tokens: 100,
            usage_percent_bp: 1000,
          },
        },
      });
    }
    if (path === '/api/config') return json(route, { model: 'private-model-A', version: '0.0.0-test' });
    if (path === '/api/runtime/control-plane') return json(route, { configured_model: 'private-model-A' });
    if (path === '/api/config/providers') return json(route, { providers: [], models: [] });
    if (path === '/api/profiles') return json(route, { profiles: [], active_profile: 'default' });
    if (path === '/api/slash') return json(route, { commands: [] });
    if (path === '/api/workspace') return json(route, { workspace_root: '/workspace', workspace_canonical: '/workspace' });
    if (path === '/api/workspace/files') return json(route, { dir: '', files: [] });
    if (path === '/api/gateway/capability-contract') return json(route, { schema_version: 1, capabilities: [] });
    if (path === '/api/gateway/openapi.json') return json(route, { openapi: '3.1.0', info: { version: '0.0.0-test' }, paths: {} });
    if (path === '/api/gateway/openai-tools') return json(route, { schema_version: 1, source: 'revocation-e2e', tool_count: 0, tools: [] });
    return json(route, {});
  });

  await page.goto('/index.html#/chat');
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.locator('.session-row').filter({ hasText: 'Restricted session' }))
    .toContainText(/revoked|authorization|credential epoch/i);
  await expect(page.locator('.transcript')).not.toContainText('SECRET-A-MUST-BE-CLEARED');
  await expect(page.locator('.composer-runtime-summary')).not.toContainText('private-effective-A');
  await page.waitForTimeout(600);
  expect(revokedStreamRequests).toBe(1);

  await page.locator('.session-row').filter({ hasText: 'Healthy B' }).click();
  await expect(page.locator('.transcript')).toContainText('HEALTHY-B-REMAINS-VISIBLE');
  await page.locator('.composer textarea').fill('healthy session remains editable');
  await expect(page.locator('.composer textarea')).toHaveValue('healthy session remains editable');
  await page.locator('.composer-runtime-chip.model').click();
  await expect(page.getByRole('heading', { name: 'Model and profile' })).toBeVisible();
});

test('workspace tab supports folder browsing and editable preview surface', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.workspace-root')).toBeVisible();
  await expect(page.locator('.upload-drop')).toContainText('Drop workspace files here');
  await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();
  await expect(page.locator('.workspace-tree')).toBeVisible();
  await expect(page.locator('.workspace-tree-node, .empty-state').first()).toBeVisible();
  await expect(page.locator('.workspace-preview-modal')).toHaveCount(0);
});

test('tools page exposes current-page management without duplicated primary navigation', async ({ page }) => {
  await page.goto('/index.html#/tools');
  await expect(page.locator('.session-sidebar')).toHaveCount(0);
  await expect(page.locator('.capability-sidebar')).toBeVisible();
  await expect(page.locator('.capability-sidebar')).not.toContainText('Memory Graph');
  await expect(page.locator('.capability-sidebar')).not.toContainText('Settings');
  await expect(page.getByRole('heading', { name: 'Tool registry' })).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'Operations' }).click();
  await expect(page.locator('h2').filter({ hasText: 'Execution planner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run readonly batch' })).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'Mutations' }).click();
  await expect(page.getByRole('heading', { name: 'Mutation transactions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview mutation' })).toBeVisible();
  await expect(page.locator('.object-inspector').first()).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'Risk' }).click();
  await expect(page.locator('.section-row.active')).toContainText('Risk');
  await expect(page).toHaveURL(/section=risk/);
  await expect(page.getByRole('heading', { name: 'Risk preflight' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run preflight' })).toBeVisible();
});

test('runtime and context pages expose real workbench controls', async ({ page }) => {
  await page.goto('/index.html#/runtime');
  await expect(page.getByRole('heading', { name: 'Runtime Control', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Control plane' })).toBeVisible();
  await expect(page.locator('[data-section="overview"]').first()).toContainText('Control plane');
  await page.goto('/index.html#/runtime?section=runs');
  await expect(page.getByRole('heading', { name: 'Session lease' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acquire' })).toBeVisible();
  await page.goto('/index.html#/runtime?section=timeline');
  await expect(page.getByRole('heading', { name: 'Runtime timeline' })).toBeVisible();

  await page.goto('/index.html#/context');
  await expect(page.getByRole('heading', { name: 'Context Builder', exact: true })).toBeVisible();
  await expect(page.locator('[data-section="packet"] > header h2', { hasText: 'Context builder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build packet' })).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'Evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Evidence resolve' })).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History and raw envelope' })).toBeVisible();
});

test('memory page exposes memory and structured-data kernel controls', async ({ page }) => {
  await page.goto('/index.html#/memory');
  await expect(page.getByRole('heading', { name: 'Memory Graph', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Layer entries' })).toBeVisible();
  await expect(page.locator('.capability-sidebar')).toBeVisible();
  await page.goto('/index.html#/memory?section=recall');
  await expect(page.getByRole('heading', { name: 'Search, recall, packet' })).toBeVisible();
  await page.goto('/index.html#/memory?section=layers');
  await expect(page.getByRole('button', { name: 'Register memory fact' })).toBeVisible();
  await page.goto('/index.html#/memory?section=graph');
  await expect(page.locator('h2').filter({ hasText: 'Structured memory graph' })).toBeVisible();
  await page.goto('/index.html#/memory?section=maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan candidates' })).toBeVisible();
  await page.goto('/index.html#/memory?section=structured-core');
  await expect(page.getByRole('heading', { name: 'Structured data core' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan manufacturing ingest' })).toBeVisible();
});

test('skills agents and tools pages expose lifecycle workbenches', async ({ page }) => {
  await page.goto('/index.html#/skills');
  await expect(page.getByRole('heading', { name: 'Skills Console' })).toBeVisible();
  await expect(page.locator('.skills-catalog')).toBeVisible();
  await expect(page.locator('.skills-detail')).toBeVisible();
  await expect(page.locator('.governed-action-panel').first()).toContainText('Validate');
  await page.goto('/index.html#/skills?section=runs');
  await expect(page.locator('[data-section="runs"]').first()).toBeVisible();

  await page.goto('/index.html#/agents');
  await expect(page.getByRole('heading', { name: 'Agents Workbench' })).toBeVisible();
  await page.goto('/index.html#/agents?section=catalog');
  await expect(page.getByRole('heading', { name: 'Agent directory' })).toBeVisible();
  await page.goto('/index.html#/agents?section=discovery');
  await expect(page.getByRole('heading', { name: 'Discover team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assemble team' })).toBeVisible();
  await page.goto('/index.html#/agents?section=tasks');
  await expect(page.getByRole('heading', { name: 'Task control' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start task' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phase gate' })).toBeVisible();
  await page.goto('/index.html#/agents?section=graph');
  await expect(page.getByRole('heading', { name: 'Agent execution graph' })).toBeVisible();
  await page.goto('/index.html#/agents?section=managed-agents');
  await expect(page.getByRole('heading', { name: 'Managed Agents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register managed Agent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dispatch pending' })).toBeVisible();

  await page.goto('/index.html#/tools');
  await expect(page.getByRole('heading', { name: 'Tool registry' })).toBeVisible();
  await page.locator('.section-row').filter({ hasText: 'Ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Tool ledger' })).toBeVisible();
});

test('gateway page exposes connector and cross-plane controls', async ({ page }) => {
  await page.goto('/index.html#/gateway');
  await expect(page.getByRole('heading', { name: 'Gateway Capability Contract' })).toBeVisible();
  await page.locator('.section-row[data-section-id="connectors"]').click();
  await expect(page.getByRole('heading', { name: 'Platforms and connectors' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connector capabilities' })).toBeVisible();
  await page.locator('.section-row[data-section-id="resources"]').click();
  await expect(page.getByRole('heading', { name: 'Resources and memory promotion' })).toBeVisible();
  await page.locator('.section-row[data-section-id="identities"]').click();
  await expect(page.getByRole('heading', { name: 'Identities and grants' })).toBeVisible();
  await page.locator('.section-row[data-section-id="executions"]').click();
  await expect(page.locator('h2').filter({ hasText: 'Cross-plane governance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action execution' })).toBeVisible();
  await expect(page.locator('.governed-action-panel').filter({ hasText: 'Execute cross-plane action' })).toContainText('Run plan');
});

test('mfg page exposes manufacturing application workbench controls', async ({ page }) => {
  await page.goto('/index.html#/apps/mfg');
  await expect(page.getByRole('heading', { name: 'Manufacturing operations workspace' })).toBeVisible();
  await expect(page.locator('[data-section="dashboard"] .mfg-cockpit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=focus');
  await expect(page.locator('[data-section="focus"] .mfg-focus')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create rule' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=collaboration');
  await expect(page.locator('[data-section="collaboration"] .mfg-collaboration')).toBeVisible();
  await expect(page.locator('[data-section="collaboration"]').getByRole('button', { name: 'Assign task' }).first()).toBeVisible();
  await expect(page.getByText('SLA minutes', { exact: true })).toBeVisible();
  await expect(page.getByText('Assignee type', { exact: true })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=data');
  await expect(page.locator('[data-section="data"]')).toContainText('Data configuration');
  await expect(page.getByRole('button', { name: 'Save source pack' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ingest facts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate source pack' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan connector' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=reality');
  await expect(page.locator('[data-section="reality"]')).toContainText('Reality and metrics');
  await expect(page.getByRole('button', { name: 'Materialize snapshot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run compute' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=evidence');
  await expect(page.locator('[data-section="evidence"]')).toContainText('Evidence center');
  await expect(page.getByRole('button', { name: 'Build evidence packet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluate quality' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=operations');
  await expect(page.locator('[data-section="operations"]')).toContainText('Incidents and execution');
  await expect(page.getByRole('button', { name: 'Create incident' })).toBeVisible();
  await expect(page.locator('[data-section="operations"]').getByRole('heading', { name: 'Decision trace', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record feedback' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=skills');
  await expect(page.locator('[data-section="skills"]')).toContainText('Skill execution');
  await expect(page.getByRole('button', { name: 'Plan skills' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect skill run' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=reports');
  await expect(page.locator('[data-section="reports"]')).toContainText('Reports and delivery');
  await expect(page.getByRole('button', { name: 'Generate report' })).toBeVisible();
  await expect(page.locator('[data-section="reports"]').getByRole('heading', { name: 'Decision trace' })).toBeVisible();
});

test('explicit Team cost warning renders through real Gateway on all strategy surfaces', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!realGateway, 'requires a real cowd gateway');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // The direct API writer is a separate Surface instance from the browser
  // page that later observes the execution. Reusing the page observer would
  // let the page's reader attachment legitimately replace this writer role.
  const writerObserverId = `webui:e2e-team-writer:${suffix}`;
  const writerHeaders = {
    'x-cowd-observer-id': writerObserverId,
  };
  const create = await page.request.post('/api/sessions', { data: {} });
  await expectOk(create, 'real Gateway session creation');
  const session = await create.json();
  expect(session.id).toBeTruthy();
  const attached = await page.request.post(
    `/api/sessions/${encodeURIComponent(session.id)}/attach`,
    { headers: writerHeaders, data: { surface: 'webui', role: 'writer' } },
  );
  await expectOk(attached, 'explicit Team writer attachment');
  const lease = await page.request.post('/api/runtime/session-leases/acquire', {
    headers: writerHeaders,
    data: { session_id: session.id, mode: 'collaborative' },
  });
  await expectOk(lease, 'explicit Team writer lease');

  // A Team must derive its authority from existing bounded workspace scopes;
  // seed the three independently reviewed domains through the public gateway
  // API instead of weakening that runtime guard for browser acceptance.
  for (const path of [
    `crates/runtime/e2e-team-${suffix}.md`,
    `crates/gateway/e2e-team-${suffix}.md`,
    `surfaces/webui/e2e-team-${suffix}.md`,
  ]) {
    const scopedFile = await page.request.post('/api/workspace/files', {
      data: { path, content: 'bounded Team acceptance scope' },
    });
    expect(scopedFile.status()).toBe(201);
  }

  const admitted = await page.request.post(`/api/sessions/${encodeURIComponent(session.id)}/messages`, {
    headers: writerHeaders,
    data: {
      content: `I must actually start a Team to separately audit runtime, gateway, and frontend, then synthesize the result. This explicit Team request must keep its negative estimated lift cost warning visible. [cowd-e2e:explicit-team-negative] ${suffix}`,
      resource_ids: [],
      idempotency_key: `e2e-strategy-${suffix}`,
    },
  });
  await expectOk(admitted, 'explicit Team message admission');
  const receipt = await admitted.json();
  const executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
  expect(executionId).toBeTruthy();
  const effectiveDurationMs = (estimate) => (
    Number(estimate?.estimated_critical_path_ms || 0)
    + Number(estimate?.startup_overhead_ms || 0)
    + Number(estimate?.merge_cost_ms || 0)
  );

  let projection = null;
  let projectionStatus = 0;
  let projectionError = '';
  let topologyReady = false;
  const projectionDeadline = Date.now() + 30_000;
  while (Date.now() < projectionDeadline && !topologyReady) {
    const response = await page.request.get(`/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=full`);
    projectionStatus = response.status();
    if (response.ok()) {
      projection = await response.json();
      const strategy = projection?.strategy;
      const projectedTeams = Array.isArray(projection?.teams) ? projection.teams : [];
      const linkedTeam = projectedTeams.find((team) => {
        const graphId = String(team?.detail?.graph_id || '');
        return graphId && (projection?.child_executions || [])
          .some((child) => String(child?.execution_id || '') === graphId);
      });
      const teamId = String(strategy?.team_id || linkedTeam?.id || '');
      const teamExecutionId = String(
        strategy?.team_execution_id || linkedTeam?.detail?.graph_id || '',
      );
      const teamEstimate = strategy?.candidate_estimates
        ?.find((estimate) => estimate?.candidate === 'team');
      const fastestAlternativeMs = Math.min(
        ...(strategy?.candidate_estimates || [])
          .filter((estimate) => estimate?.candidate !== 'team' && estimate?.eligible)
          .map(effectiveDurationMs),
      );
      const materializedTopology = [
        ...projectedTeams,
        ...(Array.isArray(projection?.child_executions) ? projection.child_executions : []),
        ...(Array.isArray(projection?.agents) ? projection.agents : []),
      ].some((entity) => {
        const id = String(entity?.id || entity?.execution_id || '');
        const graphId = String(entity?.detail?.graph_id || '');
        return id === teamId || id === teamExecutionId || graphId === teamExecutionId;
      });
      topologyReady = Boolean(
        projection?.schema_version === 2
        && projection?.execution_id === executionId
        && strategy?.schema_version === 1
        && effectiveDurationMs(teamEstimate) > fastestAlternativeMs
        && Array.isArray(strategy?.cost_reason)
        && strategy.cost_reason.length > 0
        && teamId
        && teamExecutionId
        && materializedTopology,
      );
    } else {
      projectionError = await response.text();
    }
    if (!topologyReady) await page.waitForTimeout(250);
  }
  if (!topologyReady) {
    throw new Error(`real Team topology did not materialize: ${JSON.stringify({
      http_status: projectionStatus,
      http_error: projectionError,
      projection: projection ? {
        schema_version: projection.schema_version,
        execution_id: projection.execution_id,
        live: projection.live,
        strategy: projection.strategy,
        teams: projection.teams,
        child_executions: projection.child_executions,
        agents: projection.agents,
      } : null,
    })}`);
  }
  const teamEstimate = projection?.strategy?.candidate_estimates
    ?.find((estimate) => estimate?.candidate === 'team');
  const fastestAlternativeMs = Math.min(
    ...projection.strategy.candidate_estimates
      .filter((estimate) => estimate?.candidate !== 'team' && estimate?.eligible)
      .map(effectiveDurationMs),
  );
  expect(effectiveDurationMs(teamEstimate)).toBeGreaterThan(fastestAlternativeMs);
  expect(teamEstimate?.quality_provenance).not.toBe('calibrated');
  expect(teamEstimate).not.toHaveProperty('net_benefit_score');
  expect(teamEstimate).not.toHaveProperty('assumed');

  const executionRoute = `execution_id=${encodeURIComponent(executionId)}&session_id=${encodeURIComponent(session.id)}`;
  await page.goto(`/index.html#/runtime?section=runs&${executionRoute}`);
  await expect(page.locator('.strategy-summary[data-surface="runtime"]')).toContainText(/no measured duration advantage/i);
  await page.goto(`/index.html#/mission?section=teams&${executionRoute}`);
  await expect(page.locator('.strategy-summary[data-surface="mission"]')).toContainText(/no measured duration advantage/i);
  await page.goto(`/index.html#/apps/mfg?section=operations&${executionRoute}`);
  await expect(page.locator('.strategy-summary[data-surface="mfg"]')).toContainText(/no measured duration advantage/i);

  // Preserve both valid races: a fast deterministic Team can finish while the
  // three surfaces render, while a slower execution still requires explicit
  // cancellation before releasing its writer lease.
  const terminalStatuses = new Set(['complete', 'cancelled', 'error']);
  const latestProjectionResponse = await page.request.get(
    `/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=full`,
  );
  await expectOk(latestProjectionResponse, 'explicit Team cleanup projection');
  const latestProjection = await latestProjectionResponse.json();
  if (!terminalStatuses.has(String(latestProjection?.live?.status || '').toLowerCase())) {
    // This endpoint requires a JSON body. A bare POST is rejected before the
    // cancellation handler and leaves the real Team execution running.
    const cancelled = await page.request.post(`/api/sessions/${encodeURIComponent(session.id)}/cancel`, {
      headers: writerHeaders,
      data: { reason: 'e2e Team strategy cleanup' },
    });
    await expectOk(cancelled, 'explicit Team cancellation');
    const cancellation = await cancelled.json();
    expect(cancellation).toMatchObject({ status: 'cancel_requested' });
    if (cancellation.execution_ids?.length > 0) {
      expect(cancellation.execution_ids).toEqual(expect.arrayContaining([executionId]));
    }
  }
  await expect.poll(async () => {
    const response = await page.request.get(`/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=full`);
    if (!response.ok()) return false;
    const value = await response.json();
    return value?.health?.some((item) => item?.id === `execution-health:${executionId}` && item?.status === 'terminal') || false;
  }, { timeout: 30_000, intervals: [250, 500, 1_000] }).toBe(true);
  const released = await page.request.post('/api/runtime/session-leases/release', {
    headers: writerHeaders,
    data: { session_id: session.id },
  });
  await expectOk(released, 'explicit Team writer lease release');
  const detached = await page.request.post(
    `/api/sessions/${encodeURIComponent(session.id)}/detach`,
    { headers: writerHeaders, data: { surface: 'webui' } },
  );
  await expectOk(detached, 'explicit Team writer detach');
});

test('real gateway closes MFG profile, filter, alert, assignment and report contracts', async ({ page }) => {
  test.skip(!realGateway, 'requires a real cowd gateway');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const profileId = `e2e-cockpit-${suffix}`;
  const profileResponse = await page.request.post('/api/apps/mfg/cockpit/profiles/upsert', {
    headers: { 'Idempotency-Key': `e2e-profile-${suffix}` },
    data: {
      profile: {
        profile_id: profileId,
        owner_ref: 'client-value-is-ignored',
        display_name: 'E2E terminal cockpit',
        focus_refs: ['entity:e2e-line'],
        focus_metric_ids: ['metric:e2e-output'],
        thresholds: { 'metric:e2e-output': { critical: 0.8 } },
        template_id: 'mfg.default_ops',
        cadence: 'daily',
        scope: { kind: 'personal' },
        layout: { columns: 12, row_height: 72, gap: 12 },
        global_filters: {},
        widget_instances: [],
        sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
      },
    },
  });
  await expectOk(profileResponse, 'MFG cockpit profile upsert');
  const savedProfile = (await profileResponse.json()).profile;
  expect(savedProfile.owner_ref).not.toBe('client-value-is-ignored');
  expect(savedProfile.widget_instances).toHaveLength(4);

  await page.goto(`/index.html#/apps/mfg?profile=${encodeURIComponent(profileId)}&entity=${encodeURIComponent('entity:e2e-line')}&metric=${encodeURIComponent('metric:e2e-output')}&from=${encodeURIComponent('2026-07-01T00:00:00Z')}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('entity_refs')).toHaveValue('entity:e2e-line');
  await expect(page.getByLabel('metric_ids')).toHaveValue('metric:e2e-output');
  await expect(page.getByLabel('from')).toHaveValue('2026-07-01T00:00:00Z');

  const alertResponse = await page.request.post('/api/apps/mfg/focus/alert-rules', {
    headers: { 'Idempotency-Key': `e2e-alert-${suffix}` },
    data: {
      rule: { owner_ref: 'ignored', name: 'E2E output risk', metric_refs: ['metric:e2e-output'], entity_refs: ['entity:e2e-line'], condition: { field: 'priority_score', operator: 'gte', threshold: 0.8 }, severity: 'critical', enabled: true },
    },
  });
  expect(alertResponse.ok()).toBeTruthy();
  expect((await alertResponse.json()).rule.condition).toMatchObject({ operator: 'gte', threshold: 0.8 });

  const sourcePackId = `e2e-source-pack-${suffix}`;
  await page.goto('/index.html#/apps/mfg?section=data');
  await page.getByLabel('Source pack ID').fill(sourcePackId);
  const sourcePackResponsePromise = page.waitForResponse((response) => response.url().includes('/api/apps/mfg/reality/source-packs/upsert') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save source pack' }).click();
  const sourcePackUiResponse = await sourcePackResponsePromise;
  expect(sourcePackUiResponse.ok()).toBeTruthy();
  const sourcePackUiJson = await sourcePackUiResponse.json();
  expect(sourcePackUiJson.source_pack).toMatchObject({ source_pack_id: sourcePackId, source_name: sourcePackId, owner: 'manufacturing-ops' });

  const ingestPlanResponsePromise = page.waitForResponse((response) => response.url().includes('/api/apps/mfg/reality/data-plane/ingest-plan') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Plan ingest' }).click();
  const ingestPlanResponse = await ingestPlanResponsePromise;
  expect(ingestPlanResponse.ok()).toBeTruthy();
  const ingestPlan = (await ingestPlanResponse.json()).plan;
  expect(ingestPlan.source_ref).toBe(`source-pack://${sourcePackId}`);
  expect(ingestPlan.affected_metric_ids).toEqual(expect.arrayContaining(['manufacturing_event_count']));

  await page.getByLabel('Connector resource reference').fill(`file:///tmp/${sourcePackId}.json`);
  const connectorPlanResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/apps/mfg/reality/source-packs/${sourcePackId}/connector-runs/plan`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Plan connector' }).click();
  const connectorPlanResponse = await connectorPlanResponsePromise;
  expect(connectorPlanResponse.ok()).toBeTruthy();
  expect((await connectorPlanResponse.json()).run).toMatchObject({ source_pack_id: sourcePackId, status: 'planned' });

  const taskSessionResponse = await page.request.post('/api/sessions', { data: {} });
  await expectOk(taskSessionResponse, 'MFG assignment source session creation');
  const taskSession = await taskSessionResponse.json();
  const missionResponse = await page.request.get('/api/mission/control');
  await expectOk(missionResponse, 'MFG assignment mission control snapshot');
  const missionControl = await missionResponse.json();
  const missionId = missionControl?.snapshot?.projection?.mission?.mission_id;
  expect(missionId).toBeTruthy();
  const taskResponse = await page.request.post('/api/tasks/start', {
    data: {
      task_id: `e2e-mfg-task-${suffix}`,
      mission_id: missionId,
      source_session_id: taskSession.id,
      source_turn_id: `e2e-mfg-turn-${suffix}`,
      objective: `E2E MFG assignment ${suffix}`,
      yolo_mode: false,
    },
  });
  await expectOk(taskResponse, 'MFG canonical task creation');
  const task = await taskResponse.json();

  const assignmentResponse = await page.request.post('/api/apps/mfg/assignments', {
    headers: { 'Idempotency-Key': `e2e-assignment-${suffix}` },
    data: {
      assignment: { task_ref: `task:${task.task_id}`, assignee_ref: 'user:e2e-owner', assignee_kind: 'user', watcher_refs: ['role:operations'], priority: 'high', sla_minutes: 30, visibility: 'team' },
    },
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  expect((await assignmentResponse.json()).assignment).toMatchObject({ priority: 'high', sla_minutes: 30 });

  const reportResponse = await page.request.post(`/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/reports/generate`, {
    headers: { 'idempotency-key': `e2e-report-${suffix}` },
    data: { report: { cadence: 'daily' } },
  });
  expect(reportResponse.ok()).toBeTruthy();
  const report = (await reportResponse.json()).report;
  const reportsResponse = await page.request.get(`/api/apps/mfg/cockpit/reports?profile_id=${encodeURIComponent(profileId)}`);
  expect(reportsResponse.ok()).toBeTruthy();
  expect((await reportsResponse.json()).items.map((item) => item.report_id)).toContain(report.report_id);

  await page.goto('/index.html#/apps/mfg?section=reports');
  await page.getByLabel('Report ID').fill(report.report_id);
  await page.getByRole('button', { name: 'Inspect report' }).click();
  await expect(page.locator('.object-inspector').filter({ hasText: 'Delivery state' })).toContainText('not_delivered');
  await expect(page.locator('[data-section="reports"] .graph-surface')).toBeVisible();
  const deliveryResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/apps/mfg/cockpit/reports/${report.report_id}/deliver`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Deliver report' }).click();
  const deliveryResponse = await deliveryResponsePromise;
  const deliveryText = await deliveryResponse.text();
  expect(deliveryResponse.ok(), deliveryText).toBeTruthy();
  const deliveryResult = JSON.parse(deliveryText);
  expect(deliveryResult).toMatchObject({ status: 'blocked', dispatch_status: 'policy_blocked' });
  await expect(page.locator('.request-receipt')).toContainText('blocked by policy');
  await expect(page.locator('.object-inspector').filter({ hasText: 'Delivery state' })).toContainText('not_delivered');
  await expect(page.getByRole('button', { name: 'Retry delivery' })).toBeEnabled();

  const deleteResponse = await page.request.delete(
    `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}?expected_revision=${savedProfile.revision}&idempotency_key=e2e-delete-${suffix}`,
    { headers: { 'Idempotency-Key': `e2e-delete-${suffix}` } },
  );
  expect(deleteResponse.ok()).toBeTruthy();
  const cancelTaskResponse = await page.request.post(
    `/api/tasks/${encodeURIComponent(task.task_id)}/cancel`,
    {
      data: {
        expected_revision: task.revision,
        note: 'MFG assignment contract acceptance cleanup',
        evidence_refs: [{
          ref_type: 'acceptance_cleanup',
          id: `mfg-assignment:${task.task_id}`,
          source: 'webui.e2e',
          boundary: 'observed',
          confidence_bp: 10_000,
        }],
      },
    },
  );
  await expectOk(cancelTaskResponse, 'MFG canonical task cancellation');
});

test('report delivery exposes exhausted retry state and disables automatic retry', async ({ page }) => {
  const reportId = 'controlled-dead-letter-report';
  await page.route('**/api/apps/mfg/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === `/api/apps/mfg/cockpit/reports/${reportId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ report: { report_id: reportId, profile_id: 'controlled-profile', cadence: 'daily', status: 'delivery_blocked', created_at: '2026-07-16T00:00:00Z' } }),
      });
      return;
    }
    if (path === `/api/apps/mfg/cockpit/reports/${reportId}/delivery-state`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          delivery_state: {
            report_id: reportId,
            report_status: 'delivery_blocked',
            attempt_count: 4,
            retry_attempt_count: 3,
            max_attempts: 3,
            dead_lettered: true,
            classification: 'delivery_dead_lettered',
            retryable: false,
            recommended_mode: 'manual_review',
            reasons: ['delivery:dead_lettered', 'delivery:retry_attempts_exhausted:3'],
          },
        }),
      });
      return;
    }
    if (path === '/api/apps/mfg/decision-trace') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', rows: [], objects: {} }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.route('**/api/surfaces/*/outbox', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outbox: [], dead_letters: [] }) });
  });

  await page.goto('/index.html#/apps/mfg?section=reports');
  await page.getByLabel('Report ID').fill(reportId);
  await page.getByRole('button', { name: 'Inspect report' }).click();
  const deliveryState = page.locator('.object-inspector').filter({ hasText: 'Delivery state' });
  await expect(deliveryState).toContainText('delivery_dead_lettered');
  await expect(deliveryState).toContainText('4');
  await expect(deliveryState).toContainText('3 / 3');
  await expect(deliveryState).toContainText('yes');
  await expect(page.getByRole('button', { name: 'Retry delivery' })).toBeDisabled();
});

test('real gateway cockpit editing and concurrent observers close without silent overwrite', async ({ page, browser }) => {
  test.skip(!realGateway, 'requires a real cowd gateway');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const profileId = `e2e-cockpit-conflict-${suffix}`;
  const createResponse = await page.request.post('/api/apps/mfg/cockpit/profiles/upsert', {
    headers: { 'Idempotency-Key': `e2e-cockpit-create-${suffix}` },
    data: {
      profile: {
        profile_id: profileId,
        owner_ref: 'client-value-is-ignored',
        display_name: 'E2E editable cockpit',
        focus_refs: ['entity:e2e-line'],
        focus_metric_ids: ['manufacturing_event_count'],
        thresholds: {},
        template_id: 'mfg.default_ops',
        cadence: 'daily',
        scope: { kind: 'personal' },
        layout: { columns: 12, row_height: 72, gap: 12 },
        global_filters: {},
        widget_instances: [],
        sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
      },
    },
  });
  await expectOk(createResponse, 'MFG concurrent cockpit profile creation');

  await page.goto(`/index.html#/apps/mfg?section=dashboard&profile=${encodeURIComponent(profileId)}`);
  await expect(page.locator('.mfg-widget')).toHaveCount(4);
  await page.getByRole('button', { name: 'Edit layout' }).click();
  const firstWidget = page.locator('.mfg-widget').first();
  await firstWidget.getByRole('button', { name: 'Reduce widget width' }).click();
  await firstWidget.getByRole('button', { name: 'Move widget right' }).click();
  await firstWidget.getByRole('button', { name: 'Configure widget' }).click();
  await expect(firstWidget.locator('.mfg-widget__settings')).toBeVisible();
  await firstWidget.getByRole('button', { name: 'Hide widget' }).click();
  await expect(firstWidget).toHaveClass(/is-hidden-widget/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(firstWidget).not.toHaveClass(/is-hidden-widget/);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(firstWidget).toHaveClass(/is-hidden-widget/);
  await page.getByRole('button', { name: 'Undo' }).click();

  const widgetSelect = page.locator('.mfg-cockpit__add-widget select');
  await widgetSelect.selectOption({ index: 1 });
  await page.locator('.mfg-cockpit__add-widget').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.mfg-widget')).toHaveCount(5);
  await page.locator('.mfg-widget').last().getByRole('button', { name: 'Remove widget' }).click();
  await expect(page.locator('.mfg-widget')).toHaveCount(4);

  const nameInput = page.locator('.mfg-cockpit__editor > label input').first();
  await nameInput.fill('E2E saved cockpit');
  const saveResponsePromise = page.waitForResponse((response) => response.url().includes('/api/apps/mfg/cockpit/profiles/upsert') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save cockpit' }).click();
  expect((await saveResponsePromise).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await nameInput.fill('Unsaved local title');
  await page.getByRole('button', { name: 'Revert saved version' }).click();
  await expect(nameInput).toHaveValue('E2E saved cockpit');
  await page.getByRole('button', { name: 'Finish editing' }).click();
  const profileOptions = page.locator('.mfg-cockpit__toolbar select option');
  const profileCountBeforeClone = await profileOptions.count();
  const cloneResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/apps/mfg/cockpit/profiles/${profileId}/clone`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Clone' }).click();
  expect((await cloneResponsePromise).ok()).toBeTruthy();
  // The clone action refreshes the shared cockpit store after its mutation
  // response.  Wait for that refresh to settle before opening two independent
  // editor views; otherwise an in-flight pre-clone refresh can win the route
  // restoration race and make this a timing test rather than a revision test.
  await expect(profileOptions).toHaveCount(profileCountBeforeClone + 1);
  await expect(page.locator('.mfg-revision')).toHaveText('Revision 2');

  const observerId = `webui:e2e-cockpit-observer:${suffix}`;
  const observerContext = await browser.newContext({
    baseURL: process.env.COWD_E2E_WEB_URL || process.env.COWD_E2E_GATEWAY_URL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${process.env.COWD_E2E_GATEWAY_TOKEN}`,
      'x-cowd-surface-id': 'webui',
      'x-cowd-observer-id': observerId,
      'x-cowd-requested-capabilities': gatewayRequestedCapabilities,
    },
    serviceWorkers: 'block',
  });
  const observer = await observerContext.newPage();
  await observer.addInitScript((id) => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
    sessionStorage.setItem('cowd.webui.observer_id', id);
  }, observerId);
  try {
    await Promise.all([
      page.goto(`/index.html#/apps/mfg?section=dashboard&profile=${encodeURIComponent(profileId)}`),
      observer.goto(`/index.html#/apps/mfg?section=dashboard&profile=${encodeURIComponent(profileId)}`),
    ]);
    const primaryEdit = page.getByRole('button', { name: 'Edit layout' });
    const observerEdit = observer.getByRole('button', { name: 'Edit layout' });
    await Promise.all([
      expect(primaryEdit).toBeEnabled(),
      expect(observerEdit).toBeEnabled(),
    ]);
    await Promise.all([
      primaryEdit.click(),
      observerEdit.click(),
    ]);
    await expect(page.locator('.mfg-revision')).toHaveText('Revision 2');
    await expect(observer.locator('.mfg-revision')).toHaveText('Revision 2');
    const firstName = page.locator('.mfg-cockpit__editor > label input').first();
    const secondName = observer.locator('.mfg-cockpit__editor > label input').first();
    await firstName.fill('Observer one committed');
    await secondName.fill('Observer two stale draft');
    const firstSave = page.waitForResponse((response) => response.url().includes('/api/apps/mfg/cockpit/profiles/upsert') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save cockpit' }).click();
    expect((await firstSave).ok()).toBeTruthy();
    const staleSave = observer.waitForResponse((response) => response.url().includes('/api/apps/mfg/cockpit/profiles/upsert') && response.request().method() === 'POST');
    await observer.getByRole('button', { name: 'Save cockpit' }).click();
    expect((await staleSave).status()).toBe(409);
    await expect(observer.locator('.mfg-cockpit__conflict')).toBeVisible();
    await expect(observer.locator('.mfg-cockpit__conflict-compare')).toContainText('display_name');
    const saveAsResponse = observer.waitForResponse((response) => response.url().includes('/api/apps/mfg/cockpit/profiles/upsert') && response.request().method() === 'POST');
    await observer.getByRole('button', { name: 'Save as new cockpit' }).click();
    expect((await saveAsResponse).ok()).toBeTruthy();
  } finally {
    await observerContext.close();
  }
});

test('audit page exposes usage and release gate governance controls', async ({ page }) => {
  await page.goto('/index.html#/audit?section=logs');
  await expect(page.locator('[data-section="logs"]')).toContainText('Audit export');
  await page.goto('/index.html#/audit?section=usage');
  await expect(page.locator('[data-section="usage"]')).toContainText('Usage summary');
  await page.goto('/index.html#/audit?section=release');
  await expect(page.locator('[data-section="release"]')).toContainText('Release gate');
  await page.goto('/index.html#/audit?section=approvals');
  await expect(page.locator('[data-section="approvals"]')).toContainText('Approval history');
  await page.goto('/index.html#/audit?section=cross-plane');
  await expect(page.locator('[data-section="cross-plane"]').first()).toContainText('Governance evidence');
  await page.goto('/index.html#/audit?section=evolution');
  await expect(page.locator('h2').filter({ hasText: 'Self evolution' })).toBeVisible();
  await page.goto('/index.html#/audit?section=evaluation-policy');
  await expect(page.locator('h2').filter({ hasText: 'Evaluation policy floor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh audit' })).toBeVisible();
});

test('settings page is reachable and theme control is usable', async ({ page }) => {
  await page.goto('/index.html#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('.capability-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('.settings-action-rail')).toContainText('pending changes');
  await page.getByRole('button', { name: 'Save current section' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('global locale switch and settings locale stay synchronized and persistent', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await page.getByRole('button', { name: 'Switch to Chinese' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: 'Cowd 对话' })).toBeVisible();

  await page.goto('/index.html#/settings?section=ui');
  const localeSelect = page.locator('[data-section="ui"] select');
  await expect(localeSelect).toHaveValue('zh-CN');
  await localeSelect.selectOption('en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(localeSelect).toHaveValue('en-US');
});

test('mobile shell exposes all routes through a stable more menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#/chat');
  await expect(page.getByRole('button', { name: 'More features' })).toBeVisible();
  await page.getByRole('button', { name: 'More features' }).click();
  await expect(page.locator('.mobile-nav-menu')).toBeVisible();
  await expectSemanticNavigation(page.locator('.mobile-nav-menu button'));
  await page.locator('.mobile-nav-menu button').filter({ hasText: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('composer model workspace and command controls are clickable', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await page.locator('.composer-runtime-chip.model').click();
  await expect(page.getByRole('heading', { name: 'Model and profile' })).toBeVisible();
  await expect(page.locator('.command-modal')).toContainText(/Model|后端未报告可切换模型/);
  await page.locator('.command-modal .modal-close').click();

  await page.getByRole('button', { name: /root/ }).click();
  await expect(page.getByRole('heading', { name: 'Workspace picker' })).toBeVisible();
  await page.locator('.command-modal .choice-row').first().click();
  await expect(page.locator('.companion-tabs button.active')).toContainText('Workspace');

  await page.locator('.composer textarea').fill('/');
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
  await expect(page.locator('.command-row, .modal-note').first()).toBeVisible();
});

test('all shell controls remain interactive while a conversation is running', async ({ page }) => {
  const sessionId = 'interaction-running-session';
  let releaseLiveStream;
  const keepLiveStreamOpen = new Promise((resolve) => {
    releaseLiveStream = resolve;
  });
  let liveRevision = 0;
  await page.route(`**/api/sessions/${sessionId}/attach`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session_id: sessionId, role: 'writer' }),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/detach`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/runtime/session-leases/acquire', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/runtime/session-leases/release', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route(/\/api\/sessions\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ id: sessionId, title: 'Running interaction audit', status: 'idle', model: 'test/model' }] }),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/messages?*`, async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 100);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: sessionId,
        messages: [],
        total: 0,
        offset,
        limit,
        has_more: false,
      }),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/history-index?*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        session_id: sessionId,
        projection_generation: 1,
        durable_cursor: 0,
        event_cursor: 0,
        history_revision: 0,
        total_messages: 0,
        total_bytes: 0,
        index_generation: 0,
        index_card_count: 0,
        index_complete: true,
        recovery_state: 'ready',
        recent_metadata: [],
        cards: [],
      }),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/evidence`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session_id: sessionId, evidence_refs: [], turns: [], freshness: 'live' }) });
  });
  await page.route(`**/api/sessions/${sessionId}/execution`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session_id: sessionId, active_execution_ids: [] }) });
  });
  await page.route('**/api/runtime/live-subscriptions', async (route) => {
    liveRevision = 1;
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        id: 'interaction-live',
        surface_instance: body.surface_instance,
        revision: liveRevision,
        selector: body.selector,
        selector_hash: `interaction-${liveRevision}`,
        expires_at_ms: Date.now() + 60_000,
        stream_url: '/api/runtime/live/interaction-live',
      }),
    });
  });
  await page.route('**/api/runtime/live-subscriptions/interaction-live', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204 });
      return;
    }
    liveRevision += 1;
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        id: 'interaction-live',
        surface_instance: 'webui:interaction',
        revision: liveRevision,
        selector: body.selector,
        selector_hash: `interaction-${liveRevision}`,
        expires_at_ms: Date.now() + 60_000,
        stream_url: '/api/runtime/live/interaction-live',
      }),
    });
  });
  await page.route('**/api/runtime/live/interaction-live', async (route) => {
    await keepLiveStreamOpen;
    await route.fulfill({ status: 204 });
  });
  await page.route(`**/api/sessions/${sessionId}/messages`, async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ execution: { graph_id: 'interaction-execution' } }) });
  });
  await page.route(`**/api/sessions/${sessionId}/cancel`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'cancelled' }) });
  });
  await page.route(/\/api\/runtime\/executions\/interaction-execution(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 2,
        execution_id: 'interaction-execution',
        revision: 1,
        cursor: 0,
        detail_scope: 'summary',
        authorization_revision: 1,
        redaction_revision: 'interaction-e2e',
        session_id: sessionId,
        live: { status: 'queued', status_detail: 'message accepted by runtime' },
        graph: {
          execution_id: 'interaction-execution',
          revision: 1,
          commit_cursor: 0,
          objective: 'interaction acceptance',
          service_class: 'foreground',
          parent_execution: null,
          nodes: [],
          edges: [],
          terminal_result_ref: null,
        },
        child_executions: [],
        goals: [],
        agents: [],
        teams: [],
        relations: [],
        approvals: [],
        admissions: [],
        outcomes: [],
        interventions: [],
        usage: [],
        context: [],
        evidence: [],
        health: [],
        recovery: [],
        available_commands: [],
      }),
    });
  });
  await page.goto('/index.html#/chat');
  await expect(page.locator('.session-row.active')).toContainText('Running interaction audit');
  await expect(page.locator('.composer textarea')).toBeVisible();
  await page.locator('.composer textarea').fill('Keep the interface interactive while this task runs');
  await expect(page.locator('.composer textarea')).toHaveValue('Keep the interface interactive while this task runs');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-execution-status')).toContainText(/queued|calling|preparing|排队|调用|准备/i);
  await expect(page.getByRole('button', { name: /Stop|停止/ })).toBeVisible();

  await page.locator('.composer-runtime-chip.model').click();
  await expect(page.getByRole('heading', { name: 'Model and profile' })).toBeVisible();
  await page.locator('.command-modal .modal-close').click();
  await page.getByRole('button', { name: /root/ }).click();
  await expect(page.getByRole('heading', { name: 'Workspace picker' })).toBeVisible();
  await page.locator('.command-modal .modal-close').click();
  await page.locator('.composer textarea').fill('/');
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
  await page.locator('.command-modal .modal-close').click();
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await page.locator('.companion-tabs').getByRole('button', { name: 'Workspace' }).click();
  await page.locator('.companion-toggle').click();
  await page.locator('.companion-toggle').click();

  await page.locator('.rail-button[title="Tools"]').click();
  await expect(page).toHaveURL(/tools/);
  await page.locator('.rail-button[title="Chat"]').click();
  await expect(page.locator('.chat-execution-status')).toBeVisible();
  releaseLiveStream();
  await page.getByRole('button', { name: /Stop|停止/ }).click();
  await expect(page.locator('.modal-scrim')).toHaveCount(0);
});
