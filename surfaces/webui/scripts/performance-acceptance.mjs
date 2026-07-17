#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { evidenceContext } from './evidence-context.mjs';

const context = evidenceContext('performance-acceptance');
const baseUrl = (process.env.COWD_PERFORMANCE_BASE_URL || 'http://127.0.0.1:8642/index.html').replace(/#.*$/, '');
const token = process.env.COWD_PERFORMANCE_GATEWAY_TOKEN || process.env.COWD_E2E_GATEWAY_TOKEN || '';
const reportDir = path.join(context.plan_root, 'reports', context.version);
const reportPath = path.join(reportDir, `${context.version}-browser-performance-acceptance.json`);
const results = [];

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function passed(acceptanceId, summary, metrics, artifacts = []) {
  results.push({ acceptance_id: acceptanceId, status: 'passed', summary, metrics, artifacts });
}

function failed(acceptanceId, summary, error, metrics = {}) {
  results.push({ acceptance_id: acceptanceId, status: 'failed', summary, error: error instanceof Error ? error.message : String(error), metrics });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function routeJson(route, value, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installControlledEventSource(page) {
  await page.addInitScript(() => {
    class ControlledEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      constructor(url) {
        this.url = String(url);
        this.readyState = ControlledEventSource.CONNECTING;
        this.listeners = new Map();
        this.closed = false;
        window.__cowdEventSources = window.__cowdEventSources || [];
        window.__cowdEventSources.push(this);
        queueMicrotask(() => {
          if (this.closed) return;
          this.readyState = ControlledEventSource.OPEN;
          this.onopen?.({ type: 'open' });
        });
      }
      addEventListener(type, listener) {
        const rows = this.listeners.get(type) || [];
        rows.push(listener);
        this.listeners.set(type, rows);
      }
      removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((row) => row !== listener));
      }
      emit(type, payload) {
        if (this.closed) return;
        const event = { type, data: JSON.stringify(payload) };
        if (type === 'message') this.onmessage?.(event);
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
      close() {
        this.closed = true;
        this.readyState = ControlledEventSource.CLOSED;
      }
    }
    window.EventSource = ControlledEventSource;
    window.__cowdEventSources = [];
    window.__cowdEmit = (urlPart, type, payload) => {
      const source = window.__cowdEventSources.find((item) => !item.closed && item.url.includes(urlPart));
      if (!source) return false;
      source.emit(type, payload);
      return true;
    };
  });
}

function pageOptions(viewport = { width: 1440, height: 960 }) {
  return {
    viewport,
    ...(token ? { extraHTTPHeaders: { Authorization: `Bearer ${token}` } } : {}),
  };
}

async function graphScenario(browser) {
  const page = await browser.newPage(pageOptions());
  await installControlledEventSource(page);
  let graphSize = 50;
  let revision = 0;
  let evidenceBatchCalls = 0;
  let evidenceBatchRefs = 0;

  await page.route('**/api/context/current?**', (route) => {
    revision += 1;
    const selected = Array.from({ length: graphSize - 1 }, (_, index) => ({
      id: `node-${index}`,
      role: `Item ${index}`,
      source_kind: 'performance-fixture',
      authority: 'controlled-browser',
      status: index % 7 === 0 ? 'attention' : 'selected',
      score: 1 - index / Math.max(graphSize, 1_000),
      text: `Controlled graph node ${index}`,
      evidence_refs: index === 0 ? Array.from({ length: 100 }, (_unused, refIndex) => `workspace://performance/evidence-${refIndex}`) : [],
    }));
    return routeJson(route, {
      envelope_id: 'performance-context',
      revision,
      selected,
      omitted: [],
      budget: { used_tokens: 4_000, token_budget: 8_000 },
    });
  });
  await page.route('**/api/sessions/*/context?**', (route) => routeJson(route, { envelopes: [], summaries: [] }));
  await page.route('**/api/sessions/*/context/recommendations?**', (route) => routeJson(route, { items: [] }));
  await page.route('**/api/runtime/timeline?**', (route) => routeJson(route, { events: [] }));
  await page.route('**/api/evidence/resolve/batch', async (route) => {
    const body = route.request().postDataJSON();
    const refs = Array.isArray(body?.refs) ? body.refs : [];
    evidenceBatchCalls += 1;
    evidenceBatchRefs = refs.length;
    return routeJson(route, {
      items: refs.map((reference, index) => ({
        ref: reference,
        status: index % 17 === 0 ? 'forbidden' : index % 19 === 0 ? 'expired' : index % 23 === 0 ? 'unavailable' : 'resolved',
        evidence: index % 17 === 0
          ? { kind: 'workspace', redacted: true, summary: 'Metadata only', source: reference }
          : index % 19 === 0
            ? { kind: 'workspace', expires_at: '2020-01-01T00:00:00Z', summary: 'Expired', source: reference }
            : index % 23 === 0
              ? { kind: 'workspace', available: false, reason: 'not found', source: reference }
              : { kind: 'workspace', available: true, verified: true, summary: `Evidence ${index}`, source: reference, session_id: 'performance-session' },
      })),
    });
  });

  const graphMetrics = [];
  try {
    for (const size of [50, 200, 500]) {
      graphSize = size;
      const started = Date.now();
      await page.goto('about:blank');
      await page.goto(`${baseUrl}#/context?section=packet&performance_nodes=${size}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.graph-surface').waitFor({ state: 'visible', timeout: 20_000 });
      if (size <= 200) {
        await page.waitForFunction((expected) => document.querySelectorAll('.graph-flow .vue-flow__node').length === expected, size, { timeout: 20_000 });
      } else {
        await page.waitForFunction(() => document.querySelector('.graph-surface .data-table-toolbar small')?.textContent?.includes('500 / 500'), undefined, { timeout: 20_000 });
      }
      graphMetrics.push({ size, render_ms: Date.now() - started });
      if (size === 500) {
        const rows = await page.locator('.graph-surface .data-table tbody tr').count();
        assert(rows === 25, `500-node fallback rendered ${rows} rows instead of one 25-row page`);
        const pagination = page.locator('.graph-surface .data-table-pagination');
        await pagination.waitFor({ state: 'visible' });
        await pagination.getByRole('button').last().click();
        assert((await page.locator('.graph-surface .data-table tbody').textContent()).includes('node-25'), '500-node fallback did not advance with stable pagination');
      }
    }

    graphSize = 200;
    await page.goto('about:blank');
    await page.goto(`${baseUrl}#/context?section=packet&performance_nodes=200`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.graph-flow .vue-flow__node').length === 200, undefined, { timeout: 20_000 });
    const fps = await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('.execution-graph-controls button'));
      const timestamps = [];
      const started = performance.now();
      let stop = false;
      const frame = (now) => {
        timestamps.push(now);
        if (!stop) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const timer = setInterval(() => buttons[Math.floor((performance.now() - started) / 40) % 2]?.click(), 40);
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      clearInterval(timer);
      stop = true;
      const elapsed = Math.max(1, timestamps.at(-1) - timestamps[0]);
      return ((timestamps.length - 1) * 1_000) / elapsed;
    });
    const clickLatencies = [];
    for (let index = 1; index <= 20; index += 1) {
      clickLatencies.push(await page.evaluate(async (label) => {
        const nodes = Array.from(document.querySelectorAll('.graph-flow .vue-flow__node'));
        const node = nodes.find((element) => element.textContent?.includes(label));
        if (!node) return 10_000;
        const started = performance.now();
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - started;
      }, `Item ${index}`));
    }
    const clickP95 = percentile(clickLatencies, 0.95);
    await page.locator('.execution-graph-controls button').first().click();
    await page.locator('.execution-graph-controls button').first().click();
    await page.waitForTimeout(100);
    const transformBefore = await page.locator('.graph-flow .vue-flow__viewport').getAttribute('style');
    await page.locator('.context-page .page-header .primary-action').click();
    await page.waitForTimeout(300);
    const transformAfter = await page.locator('.graph-flow .vue-flow__viewport').getAttribute('style');
    assert(fps >= 50, `200-node graph measured ${fps.toFixed(1)} FPS`);
    assert(clickP95 < 100, `200-node graph click p95 measured ${clickP95.toFixed(1)}ms`);
    assert(transformBefore === transformAfter, 'graph refresh reset the existing viewport');
    assert(graphMetrics.every((row) => row.render_ms < 20_000), 'one graph size exceeded the 20s controlled render ceiling');
    passed('P-01', '50/200 canvas and 500-node paginated fallback remained responsive', { graph_metrics: graphMetrics, fps, click_p95_ms: clickP95 });
    passed('P-02', 'cached relayout preserved viewport while interaction remained frame-batched', { viewport_preserved: true, fps });
    passed('P-06', '500-node fallback paginated at 25 rows and advanced deterministically', { rows_per_page: 25, total_rows: 500 });

    const evidenceNodeDispatched = await page.evaluate(() => {
      const node = Array.from(document.querySelectorAll('.graph-flow .vue-flow__node')).find((element) => element.textContent?.includes('Item 0'));
      if (!node) return false;
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
    assert(evidenceNodeDispatched, 'evidence-bearing graph node was not available');
    await page.waitForFunction(() => document.querySelectorAll('.evidence-inspector-list > article').length === 100, undefined, { timeout: 10_000 });
    assert(evidenceBatchCalls === 1, `100 evidence refs used ${evidenceBatchCalls} batch calls`);
    assert(evidenceBatchRefs === 100, `evidence batch contained ${evidenceBatchRefs} refs`);
    const evidenceArticles = await page.locator('.evidence-inspector-list > article').count();
    assert(evidenceArticles === 100, `evidence inspector rendered ${evidenceArticles} rows`);
    passed('P-04', '100 evidence refs resolved in one deduplicated request', { batch_calls: evidenceBatchCalls, refs: evidenceBatchRefs, rendered: evidenceArticles });
  } catch (error) {
    for (const id of ['P-01', 'P-02', 'P-04', 'P-06']) {
      if (!results.some((row) => row.acceptance_id === id)) failed(id, 'controlled graph and evidence performance', error, { graph_metrics: graphMetrics });
    }
  } finally {
    await page.close();
  }
}

async function widgetScenario(browser) {
  const page = await browser.newPage(pageOptions());
  await installControlledEventSource(page);
  const profileId = 'performance-20-widgets';
  const instances = Array.from({ length: 20 }, (_, index) => ({
    instance_id: `widget-${index}`,
    definition_id: 'attention.queue',
    placement: { x: (index % 2) * 6, y: Math.floor(index / 2) * 4, width: 6, height: 4 },
    config: {},
    query: {},
    visible: true,
  }));
  const profile = {
    profile_id: profileId,
    owner_ref: 'principal:local-human',
    display_name: '20 widget performance cockpit',
    focus_refs: [],
    focus_metric_ids: ['manufacturing_event_count'],
    thresholds: {},
    cadence: 'daily',
    revision: 1,
    scope: { kind: 'personal' },
    layout: { columns: 12, row_height: 72, gap: 12 },
    global_filters: {},
    widget_instances: instances,
    sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
  };
  const widget = (instance, status = 'ready') => ({
    widget_id: instance.instance_id,
    instance_id: instance.instance_id,
    definition_id: instance.definition_id,
    title: `Widget ${instance.instance_id}`,
    status,
    priority_score: 1,
    data: { count: Number(instance.instance_id.split('-').at(-1)) + 1 },
    source_refs: [`matrix:attention:${instance.instance_id}`],
    freshness: { status: 'current', generated_at: new Date().toISOString() },
  });
  let slowRequest = true;
  await page.route('**/api/apps/mfg/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/apps/mfg/cockpit/profiles') return routeJson(route, { items: [profile] });
    if (pathname === '/api/apps/mfg/cockpit/widget-catalog') return routeJson(route, {
      items: [{ definition_id: 'attention.queue', title: 'Attention queue', renderer: 'attention', renderer_version: 1, min_width: 3, min_height: 2, max_width: 12, max_height: 12, required_capability: 'mfg.read', default_placement: { x: 0, y: 0, width: 6, height: 4 }, config_schema: { type: 'object', properties: {}, additionalProperties: false }, query_schema: { type: 'object', properties: {}, additionalProperties: false } }],
      global_filter_schema: { type: 'object', properties: {}, additionalProperties: false },
      filter_merge_policy: { semantics: 'controlled performance fixture' },
    });
    if (pathname === `/api/apps/mfg/cockpit/profiles/${profileId}`) return routeJson(route, { profile });
    if (pathname === `/api/apps/mfg/cockpit/profiles/${profileId}/projection`) return routeJson(route, { projection: { projection_id: 'performance-projection', profile, widgets: instances.map((item) => widget(item)), summary: '20 widgets ready', generated_at: new Date().toISOString() } });
    const widgetMatch = pathname.match(new RegExp(`/api/apps/mfg/cockpit/profiles/${profileId}/widgets/([^/]+)/projection`));
    if (widgetMatch) {
      const instance = instances.find((item) => item.instance_id === decodeURIComponent(widgetMatch[1]));
      if (!instance) return routeJson(route, { error: 'missing widget' }, 404);
      if (instance.instance_id === 'widget-0' && slowRequest) {
        slowRequest = false;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (instance.instance_id === 'widget-2') return routeJson(route, { error: 'controlled widget timeout' }, 504);
      return routeJson(route, { projection: { profile_id: profileId, profile_revision: 1, generated_at: new Date().toISOString(), widget: widget(instance) } });
    }
    if (pathname.includes('/focus/alert-rules') || pathname.includes('/focus/alerts') || pathname.includes('/focus/alert-subscriptions') || pathname === '/api/apps/mfg/assignments' || pathname.includes('/focus/forecasts')) return routeJson(route, { items: [] });
    if (pathname === '/api/apps/mfg/live/snapshot') return routeJson(route, {
      kind: 'snapshot',
      view_epoch: 'performance-view',
      cursor: 'performance-cursor',
      generated_at: new Date().toISOString(),
      contract_version: 'mfg.frontend.v1',
      state: {
        cockpit: { profiles: [profile] },
        alerts: { rules: [], subscriptions: [], occurrences: [] },
        assignments: { items: [] },
        incidents: { items: [], workflows: [], analyses: [], memory_cases: [], playbooks: [] },
        executions: { actions: [], skills: [] },
        reports: { items: [] },
        reviews: { items: [] },
        receipts: { commands: [], mutations: [] },
        data_compute: {},
      },
    });
    if (pathname === '/api/apps/mfg/live') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: mfg_live\ndata: ${JSON.stringify({
          kind: 'heartbeat',
          view_epoch: 'performance-view',
          cursor: 'performance-cursor',
          generated_at: new Date().toISOString(),
        })}\n\n`,
      });
    }
    return routeJson(route, { items: [] });
  });

  try {
    const started = Date.now();
    await page.goto(`${baseUrl}#/apps/mfg?section=dashboard&profile=${profileId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.mfg-widget').length === 20, undefined, { timeout: 15_000 });
    const renderMs = Date.now() - started;
    const editStarted = Date.now();
    await page.locator('.mfg-cockpit__actions .primary-action').click();
    await page.waitForFunction(() => document.querySelectorAll('.mfg-widget__controls').length === 20);
    const editMs = Date.now() - editStarted;
    const first = page.locator('.mfg-widget').filter({ hasText: 'Widget widget-0' });
    await first.locator('.mfg-widget__retry').click();
    await first.getByRole('button', { name: /取消刷新|Cancel refresh/ }).waitFor();
    const cancelStarted = Date.now();
    await first.getByRole('button', { name: /取消刷新|Cancel refresh/ }).click();
    await page.waitForFunction(() => document.querySelector('.mfg-widget')?.getAttribute('data-status') !== 'loading');
    const cancelMs = Date.now() - cancelStarted;
    assert(await page.locator('.mfg-widget').count() === 20, 'widget cancellation changed dashboard cardinality');
    assert(cancelMs < 100, `widget cancellation took ${cancelMs}ms`);
    assert(editMs < 1_500, `20-widget edit controls took ${editMs}ms`);
    passed('P-03', '20-widget cockpit remained editable and exposed real request cancellation', { render_ms: renderMs, edit_ms: editMs, cancel_ms: cancelMs, widget_count: 20 });

    const timedOut = page.locator('.mfg-widget').filter({ hasText: 'Widget widget-2' });
    await timedOut.locator('.mfg-widget__retry').click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.mfg-widget')).some((element) => element.textContent?.includes('Widget widget-2') && element.getAttribute('data-status') === 'error'));
    const siblingStatus = await page.locator('.mfg-widget').filter({ hasText: 'Widget widget-3' }).getAttribute('data-status');
    const menuStarted = Date.now();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.settings-page').waitFor({ state: 'visible' });
    const menuMs = Date.now() - menuStarted;
    assert(siblingStatus === 'ready', `sibling widget degraded to ${siblingStatus}`);
    assert(menuMs < 500, `menu navigation under local timeout took ${menuMs}ms`);
    passed('P-07', 'one widget timeout degraded locally while sibling data and shell navigation stayed responsive', { sibling_status: siblingStatus, menu_navigation_ms: menuMs });
  } catch (error) {
    for (const id of ['P-03', 'P-07']) if (!results.some((row) => row.acceptance_id === id)) failed(id, 'controlled 20-widget performance', error);
  } finally {
    await page.close();
  }
}

async function chatScenario(browser) {
  const page = await browser.newPage(pageOptions());
  await installControlledEventSource(page);
  const sessions = Array.from({ length: 14 }, (_, index) => ({
    id: `performance-session-${index + 1}`,
    title: `Performance session ${index + 1}`,
    model: 'cowd-v9-performance-fixture',
    status: 'idle',
    message_count: 0,
    updated_at: new Date(Date.now() - index * 1_000).toISOString(),
  }));
  const executionBySession = new Map();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/sessions' && request.method() === 'GET') return routeJson(route, { sessions });
    const messageMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messageMatch && request.method() === 'GET') return routeJson(route, { messages: [] });
    if (messageMatch && request.method() === 'POST') {
      const sessionId = decodeURIComponent(messageMatch[1]);
      const executionId = `execution-${sessionId}`;
      executionBySession.set(sessionId, executionId);
      return routeJson(route, { execution_id: executionId, execution: { graph_id: executionId } });
    }
    const evidenceMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/evidence$/);
    if (evidenceMatch) return routeJson(route, { session_id: decodeURIComponent(evidenceMatch[1]), evidence_refs: [`workspace://${decodeURIComponent(evidenceMatch[1])}`], turns: [], freshness: 'ready' });
    const executionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/execution$/);
    if (executionMatch) {
      const sessionId = decodeURIComponent(executionMatch[1]);
      return routeJson(route, { session_id: sessionId, active_execution_ids: executionBySession.has(sessionId) ? [executionBySession.get(sessionId)] : [], latest_execution_id: executionBySession.get(sessionId) || '' });
    }
    if (/^\/api\/sessions\/[^/]+\/(attachments|inputs|turn-inbox)$/.test(pathname)) return routeJson(route, pathname.endsWith('attachments') ? { attachments: [] } : pathname.endsWith('inputs') ? { inputs: [] } : { items: [] });
    if (pathname === '/api/runtime/timeline') return routeJson(route, { events: [] });
    if (pathname === '/api/reality/flow') return routeJson(route, { events: [] });
    if (pathname === '/api/context/current') return routeJson(route, { envelope_id: `context-${url.searchParams.get('session_id')}`, selected: [], budget: { used_tokens: 0, token_budget: 8_000 } });
    const projectionMatch = pathname.match(/^\/api\/runtime\/executions\/([^/]+)\/projection$/);
    if (projectionMatch) {
      const executionId = decodeURIComponent(projectionMatch[1]);
      return routeJson(route, { execution_id: executionId, revision: 1, cursor: 0, live: { status: 'calling_model', status_detail: `waiting ${executionId}` }, graph: { nodes: [{ node_id: executionId, kind: 'session', status: 'running' }], edges: [] }, context: [], evidence: [], usage: [] });
    }
    return route.continue();
  });

  try {
    await page.goto(`${baseUrl}#/chat`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.session-row').length >= 14, undefined, { timeout: 15_000 });
    for (let index = 0; index < 14; index += 1) {
      await page.locator('.session-row').nth(index).click();
      await page.waitForFunction((sessionId) => document.querySelector('.session-row.active')?.textContent?.includes(sessionId.replace('performance-session-', 'Performance session ')), sessions[index].id);
    }
    const sourceCount = await page.evaluate(() => window.__cowdEventSources.filter((item) => !item.closed && item.url.includes('/api/sessions/')).length);
    assert(sourceCount === 12, `session stream budget opened ${sourceCount} streams`);
    assert((await page.locator('.session-row.active').textContent()).includes('budget reached (12)'), 'overflow session did not expose its degraded reason');

    const isolated = [];
    for (let index = 0; index < 3; index += 1) {
      await page.locator('.session-row').nth(index).click();
      await page.locator('.composer textarea').fill(`prompt-${index}`);
      await page.locator('.composer .primary-action').click();
      await page.evaluate(({ sessionId, index }) => {
        window.__cowdEmit(`/api/sessions/${sessionId}/stream`, 'message', { type: 'TextDelta', text: `reply-${index}` });
        window.__cowdEmit(`/api/sessions/${sessionId}/stream`, 'message', { type: 'ExecutionPhase', status: 'calling_model', detail: `waiting-provider-${index}` });
      }, { sessionId: sessions[index].id, index });
      await page.waitForTimeout(40);
      isolated.push({
        session_id: sessions[index].id,
        transcript: await page.locator('.transcript').textContent(),
        run_status: await page.locator('.run-status').textContent(),
      });
    }
    isolated.forEach((row, index) => {
      assert(row.transcript.includes(`prompt-${index}`) && row.transcript.includes(`reply-${index}`), `${row.session_id} lost its own turn`);
      assert(!row.transcript.includes(`reply-${(index + 1) % 3}`), `${row.session_id} leaked another session reply`);
      assert(row.run_status.includes(`waiting-provider-${index}`), `${row.session_id} lost its own progress status`);
    });

    const activeSession = sessions[2].id;
    const burstStarted = Date.now();
    await page.evaluate((sessionId) => {
      for (let index = 0; index < 1_000; index += 1) window.__cowdEmit(`/api/sessions/${sessionId}/stream`, 'message', { type: 'TextDelta', text: 'x' });
    }, activeSession);
    await page.waitForFunction(() => (document.querySelector('.transcript')?.textContent?.match(/x/g) || []).length >= 1_000, undefined, { timeout: 2_000 });
    const burstMs = Date.now() - burstStarted;
    const menuStarted = Date.now();
    await page.locator('.composer-actions .ghost-action').click();
    await page.locator('.command-modal').waitFor({ state: 'visible' });
    const menuMs = Date.now() - menuStarted;
    assert(burstMs < 500, `1,000 deltas took ${burstMs}ms to coalesce`);
    assert(menuMs < 300, `command menu took ${menuMs}ms while task waited`);
    passed('P-05', '14 sessions respected the 12-stream budget and overflow stayed explicitly degraded', { active_streams: sourceCount, requested_sessions: 14, isolated_sessions: isolated.length });
    passed('P-08', 'long task without content exposed wait reason while 1,000 deltas batched and menus stayed responsive', { delta_burst_ms: burstMs, menu_ms: menuMs, wait_reason: isolated[2].run_status });
    passed('LIVE-01', 'three simultaneous browser sessions kept prompts, replies, evidence and progress isolated', { sessions: isolated });
  } catch (error) {
    for (const id of ['P-05', 'P-08', 'LIVE-01']) if (!results.some((row) => row.acceptance_id === id)) failed(id, 'controlled multi-session and stream performance', error);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  await graphScenario(browser);
  await widgetScenario(browser);
  await chatScenario(browser);
} finally {
  await browser.close();
}

const failedResults = results.filter((row) => row.status === 'failed');
const report = {
  provenance: context,
  status: failedResults.length ? 'failed' : 'passed',
  base_url: baseUrl,
  thresholds: { graph_fps_min: 50, click_p95_ms_max: 100, widget_cancel_ms_max: 100, menu_ms_max: 500 },
  results,
};
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failedResults.length) {
  console.error(`Browser performance acceptance failed: ${reportPath}`);
  for (const row of failedResults) console.error(`- ${row.acceptance_id}: ${row.error}`);
  process.exit(1);
}
console.log(`Browser performance acceptance passed: ${reportPath}`);
