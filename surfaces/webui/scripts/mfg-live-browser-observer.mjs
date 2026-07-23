#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const gatewayUrl = (process.env.COWD_MFG_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const webuiUrl = (process.env.COWD_MFG_WEBUI_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const token = process.env.COWD_MFG_API_TOKEN || '';
const artifactPath = process.env.COWD_MFG_BROWSER_ARTIFACT || path.resolve('mfg-live-browser.json');
const screenshotPath = process.env.COWD_MFG_BROWSER_SCREENSHOT || artifactPath.replace(/\.json$/, '.png');
const interactionProbeRequestPath = process.env.COWD_MFG_BROWSER_PROBE_REQUEST || '';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium';

if (!token) throw new Error('COWD_MFG_API_TOKEN is required');

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext();
async function loginWebui() {
  const login = await context.request.post(`${gatewayUrl}/api/auth/login`, {
    data: {
      token,
      surface_id: 'webui',
      requested_capabilities: [
        'mfg.read',
        'mfg.alert.respond',
        'mfg.assignment.manage',
        'mfg.assignment.lifecycle',
        'mfg.report.generate',
        'mfg.report.deliver',
        'mfg.report.review',
        'mfg.skill.run',
        'mfg.cockpit.manage',
        'approval.respond',
      ],
    },
  });
  if (!login.ok()) throw new Error(`WebUI login failed: ${login.status()} ${await login.text()}`);
}
await loginWebui();

const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const httpFailures = [];
const expectedHttpFailureWindows = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('response', (response) => {
  if (response.status() < 400) return;
  const request = response.request();
  httpFailures.push({
    url: response.url(),
    method: request.method(),
    status: response.status(),
    resource_type: request.resourceType(),
    observer_id: request.headers()['x-cowd-observer-id'] || '',
    at: new Date().toISOString(),
  });
});
await page.addInitScript(() => {
  const originalFetch = window.fetch.bind(window);
  const evidence = {
    frames: [],
    stream_errors: [],
    requests: [],
    installed_at: new Date().toISOString(),
  };
  Object.defineProperty(window, '__cowdMfgLiveEvidence', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: evidence,
  });
  window.fetch = async (...args) => {
    const requestUrl = String(args[0] instanceof Request ? args[0].url : args[0]);
    const response = await originalFetch(...args);
    if (!requestUrl.includes('/api/apps/mfg/live')) return response;
    evidence.requests.push({
      url: requestUrl,
      status: response.status,
      content_type: response.headers.get('content-type') || '',
      at: new Date().toISOString(),
    });
    if (requestUrl.endsWith('/api/apps/mfg/live/snapshot') && response.ok) {
      void response.clone().json().then((parsed) => {
        evidence.frames.push({
          kind: parsed.kind,
          cursor: parsed.cursor || '',
          view_epoch: parsed.view_epoch || '',
          reports: (parsed.state?.reports?.items || []).map((report) => ({
            id: report.report_id,
            revision: report.revision,
            status: report.status,
            delivery_receipt_ids: (report.delivery_receipts || [])
              .map((receipt) => receipt.delivery_id)
              .filter(Boolean),
          })),
          reviews: (parsed.state?.reviews?.items || []).map((review) => ({
            id: review.review_id,
            report_id: review.report_id,
            revision: review.revision,
            status: review.status,
          })),
          receipt_ids: [
            ...(parsed.state?.receipts?.commands || []),
            ...(parsed.state?.receipts?.mutations || []),
          ].map((receipt) => receipt.receipt_id).filter(Boolean),
          assignment_ids: (parsed.state?.assignments?.items || [])
            .map((assignment) => assignment.assignment_id)
            .filter(Boolean),
          observed_at: new Date().toISOString(),
        });
      }).catch((error) => {
        evidence.stream_errors.push({
          code: 'browser_snapshot_evidence_parse_error',
          message: error instanceof Error ? error.message : String(error),
          observed_at: new Date().toISOString(),
        });
      });
      return response;
    }
    if (!requestUrl.endsWith('/api/apps/mfg/live') || !response.body) return response;
    const [applicationBody, evidenceBody] = response.body.tee();
    void (async () => {
      const reader = evidenceBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            const event = raw.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() || '';
            const data = raw.split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (event === 'mfg_live_error') {
                evidence.stream_errors.push({ ...parsed, observed_at: new Date().toISOString() });
              } else if (event === 'mfg_live') {
                const events = (parsed.events || []).map((item) => ({
                  event_type: item.event_type,
                  subject_ref: item.subject_ref,
                  revision: item.revision,
                  receipt_id: item.payload?.receipt?.receipt_id || null,
                  report: item.payload?.report ? {
                    id: item.payload.report.report_id,
                    revision: item.payload.report.revision,
                    status: item.payload.report.status,
                    delivery_receipt_ids: (item.payload.report.delivery_receipts || [])
                      .map((receipt) => receipt.delivery_id)
                      .filter(Boolean),
                  } : null,
                  review: item.payload?.review ? {
                    id: item.payload.review.review_id,
                    report_id: item.payload.review.report_id,
                    revision: item.payload.review.revision,
                    status: item.payload.review.status,
                  } : null,
                }));
                evidence.frames.push({
                  kind: parsed.kind,
                  cursor: parsed.cursor || parsed.target_cursor || parsed.latest_cursor || '',
                  view_epoch: parsed.view_epoch || parsed.previous_view_epoch || '',
                  events,
                  event_types: events.map((item) => item.event_type),
                  subject_refs: events.map((item) => item.subject_ref),
                  revisions: events.map((item) => item.revision),
                  receipt_ids: events.map((item) => item.receipt_id).filter(Boolean),
                  observed_at: new Date().toISOString(),
                });
                if (evidence.frames.length > 2_000) evidence.frames.splice(0, 1_000);
              }
            } catch (error) {
              evidence.stream_errors.push({
                code: 'browser_evidence_parse_error',
                message: error instanceof Error ? error.message : String(error),
                observed_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch (error) {
        evidence.stream_errors.push({
          code: 'browser_evidence_reader_error',
          message: error instanceof Error ? error.message : String(error),
          observed_at: new Date().toISOString(),
        });
      }
    })();
    return new Response(applicationBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
});

await page.goto(`${webuiUrl}/index.dev.html#/apps/mfg`, { waitUntil: 'domcontentloaded' });
await page.locator('.mfg-page').waitFor({ state: 'visible', timeout: 30_000 });
await page.waitForFunction(
  () => window.__cowdMfgLiveEvidence?.frames.some((frame) => frame.kind === 'snapshot'),
  undefined,
  { timeout: 30_000 },
);

let stopping = false;
let reauthenticating = false;
let reauthenticationCount = 0;
let profileReauthenticationCount = 0;
let forbiddenRecoveryCount = 0;
let sameDocumentRecoveryCount = 0;
let reauthenticationMethod = '';
let authorizationClearObserved = false;
const interactionProbes = [];
const completedInteractionProbes = new Set();
const consumerGenerationDeltas = [];
let artifactSequence = 0;

// The browser can legitimately receive a burst of transactional snapshots
// while the Gateway coalesces a large write fan-out.  The observer is an
// evidence consumer, not a second unbounded replica: serialising every full
// historical snapshot made the observer itself fall behind the product it was
// measuring.  Keep a compact, queryable aggregate for convergence assertions
// and a bounded tail for ordering/revision evidence.
const ARTIFACT_FRAME_TAIL_LIMIT = 64;

function inExpectedFailureWindow(failure, reason) {
  const timestamp = Date.parse(failure.at);
  return expectedHttpFailureWindows.some((window) => (
    window.reason === reason
      && timestamp >= window.started_at_ms
      && timestamp <= (window.finished_at_ms || Date.now())
  ));
}

function isExpectedHttpFailure(failure) {
  const pathname = new URL(failure.url).pathname;
  if (failure.status === 401 && pathname === '/api/auth/verify') return true;
  // The valid-session entitlement probe intentionally replaces the browser
  // cookie with a capability-restricted session. Only failures observed in
  // that short, recorded interval are acceptable; any 403 outside it remains
  // a regression.
  if (
    failure.status === 403
      && pathname.startsWith('/api/apps/mfg/')
      && inExpectedFailureWindow(failure, 'forbidden_entitlement_probe')
  ) return true;
  // Gateway restart is a deliberate availability fault in this acceptance
  // lane. These two read paths may return one transient 500 before the live
  // transport retries; the succeeding live/recovery assertions below prove
  // that the user-visible surface did not remain degraded.
  return failure.status === 500 && (
    pathname === '/api/apps/mfg/live/snapshot'
      || pathname === '/api/runtime/config/reload/status'
  );
}

async function writeArtifact(status) {
  // Do the reduction in the browser execution context. Returning every
  // historical snapshot over the Playwright protocol before truncating it in
  // Node made the evidence observer contend with a high-throughput page.
  const currentEvidence = await page.evaluate((tailLimit) => {
    const evidence = window.__cowdMfgLiveEvidence || { frames: [], stream_errors: [], requests: [] };
    const frames = evidence.frames || [];
    const uniqueStrings = (values) => [...new Set(values.filter(
      (value) => typeof value === 'string' && value.length > 0,
    ))];
    const compactFrames = frames.slice(-tailLimit).map((frame) => {
      const assignmentIds = frame.assignment_ids || [];
      const receiptIds = frame.receipt_ids || [];
      return {
        ...frame,
        // Identity is retained once in `frame_summary`; duplicating every
        // snapshot's full arrays defeats the bounded artifact contract.
        assignment_count: assignmentIds.length,
        receipt_count: receiptIds.length,
        assignment_ids: undefined,
        receipt_ids: undefined,
      };
    });
    return {
      frames: compactFrames,
      frame_summary: {
        total: frames.length,
        assignment_ids: uniqueStrings(frames.flatMap((frame) => frame.assignment_ids || [])),
        receipt_ids: uniqueStrings(frames.flatMap((frame) => frame.receipt_ids || [])),
        subject_refs: uniqueStrings(frames.flatMap((frame) => frame.subject_refs || [])),
      },
      stream_errors: evidence.stream_errors || [],
      requests: evidence.requests || [],
    };
  }, ARTIFACT_FRAME_TAIL_LIMIT);
  const liveFrames = currentEvidence.frames.filter((frame) => (
    (frame.kind === 'snapshot' || frame.kind === 'delta' || frame.kind === 'heartbeat')
      && typeof frame.view_epoch === 'string'
      && frame.view_epoch.length > 0
  ));
  const currentViewEpoch = liveFrames.length > 0
    ? liveFrames[liveFrames.length - 1].view_epoch
    : '';
  const browserEvidence = {
    frames: currentEvidence.frames,
    frame_summary: currentEvidence.frame_summary,
    stream_errors: currentEvidence.stream_errors,
    requests: currentEvidence.requests,
    reauthentication_count: reauthenticationCount,
    reauthentication_method: reauthenticationMethod,
    authorization_clear_observed: authorizationClearObserved,
    profile_reauthentication_count: profileReauthenticationCount,
    forbidden_recovery_count: forbiddenRecoveryCount,
    same_document_recovery_count: sameDocumentRecoveryCount,
    consumer_generation_deltas: consumerGenerationDeltas,
    http_failures: httpFailures,
    expected_http_failures: httpFailures.filter(isExpectedHttpFailure),
    unexpected_http_failures: httpFailures.filter((failure) => !isExpectedHttpFailure(failure)),
  };
  // A direct query intentionally avoids Locator's auto-retry while Vue is
  // applying an otherwise healthy burst of state changes.  Receipt identity
  // remains in the compact stream summary; the UI snapshot needs only its
  // visible count and domain summaries.
  const ui = await page.evaluate((viewEpoch) => {
    const element = document.querySelector('.mfg-page');
    const diagnostics = element?.querySelector('[data-mfg-live-diagnostics]');
    return {
      diagnostics: element?.querySelector('.mfg-page__diagnostics')?.textContent?.trim() || '',
      degraded: Boolean(element?.querySelector('.api-state-banner[data-status="degraded"]')),
      live: {
        status: diagnostics?.getAttribute('data-live-status') || '',
        view_epoch: viewEpoch,
        assignment_count: Number(diagnostics?.getAttribute('data-assignment-count') || 0),
        report_count: Number(diagnostics?.getAttribute('data-report-count') || 0),
        review_count: Number(diagnostics?.getAttribute('data-review-count') || 0),
        receipt_count: Number(diagnostics?.getAttribute('data-receipt-count') || 0),
        delivery_receipt_count: Number(diagnostics?.getAttribute('data-delivery-receipt-count') || 0),
        consumer_generation: Number(diagnostics?.getAttribute('data-live-consumer-generation') || 0),
        reports: JSON.parse(diagnostics?.getAttribute('data-report-state') || '[]'),
        reviews: JSON.parse(diagnostics?.getAttribute('data-review-state') || '[]'),
      },
    };
  }, currentViewEpoch);
  const artifact = {
    surface: 'webui',
    status,
    recorded_at: new Date().toISOString(),
    gateway_url: gatewayUrl,
    webui_url: webuiUrl,
    ui,
    browser: browserEvidence,
    interaction_probes: interactionProbes,
    console_errors: consoleErrors,
    unexpected_console_errors: consoleErrors.filter((message) => !/^Failed to load resource: the server responded with a status of (401|403|500) \(/.test(message)),
    page_errors: pageErrors,
    expected_http_failure_windows: expectedHttpFailureWindows,
  };
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const temporary = `${artifactPath}.tmp-${process.pid}-${++artifactSequence}`;
  fs.writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.renameSync(temporary, artifactPath);
}

await writeArtifact('live');
await page.screenshot({ path: screenshotPath, fullPage: true });
async function recoverThroughProductUi(expectedReason) {
  const diagnostics = page.locator('[data-mfg-live-diagnostics]');
  const beforeGeneration = Number(await diagnostics.getAttribute('data-live-consumer-generation') || 0);
  const recoveryButton = page.locator('[data-mfg-auth-recovery]');
  await recoveryButton.waitFor({ state: 'visible', timeout: 30_000 });
  if (await recoveryButton.getAttribute('data-recovery-reason') !== expectedReason) {
    throw new Error(`MFG recovery reason did not match ${expectedReason}`);
  }
  authorizationClearObserved = await diagnostics.evaluate((element) => (
    Number(element.getAttribute('data-assignment-count') || 0) === 0
    && Number(element.getAttribute('data-report-count') || 0) === 0
    && Number(element.getAttribute('data-review-count') || 0) === 0
    && Number(element.getAttribute('data-receipt-count') || 0) === 0
  ));
  if (!authorizationClearObserved) {
    throw new Error('MFG authorization recovery retained a projection from the old view');
  }
  const beforeSnapshotCount = await page.evaluate(() => (
    window.__cowdMfgLiveEvidence?.requests.filter(
      (request) => request.url.endsWith('/api/apps/mfg/live/snapshot') && request.status === 200,
    ).length || 0
  ));
  await recoveryButton.click();
  await page.waitForURL(/#\/settings\?section=gateway/, { timeout: 30_000 });
  if (expectedReason === 'forbidden') {
    await page.locator('[data-gateway-forbidden-recovery]').waitFor({ state: 'visible', timeout: 30_000 });
  }
  const loginForm = page.locator('.gateway-auth-form');
  await loginForm.waitFor({ state: 'visible', timeout: 30_000 });
  await loginForm.locator('input[type="password"]').fill(token);
  await loginForm.locator('button[type="submit"]').click();
  await loginForm.waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForFunction(
    ({ count }) => (
      window.__cowdMfgLiveEvidence?.requests.filter(
        (request) => request.url.endsWith('/api/apps/mfg/live/snapshot') && request.status === 200,
      ).length || 0
    ) > count,
    { count: beforeSnapshotCount },
    { timeout: 30_000 },
  );
  // App navigation is localized and intentionally owned by the external APP
  // catalog, so recovery must not couple to a display label.  Use the normal
  // in-document route transition the shell exposes to a user who returns to
  // the app after replacing a credential.
  await page.evaluate(() => { window.location.hash = '#/apps/mfg'; });
  await page.waitForURL(/#\/apps\/mfg/, { timeout: 30_000 });
  await page.locator('.mfg-page').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(
    ({ generation }) => {
      const element = document.querySelector('[data-mfg-live-diagnostics]');
      return Number(element?.getAttribute('data-live-consumer-generation') || 0) === generation + 1
        && element?.getAttribute('data-live-status') === 'live';
    },
    { generation: beforeGeneration },
    { timeout: 30_000 },
  );
  const afterGeneration = Number(
    await page.locator('[data-mfg-live-diagnostics]').getAttribute('data-live-consumer-generation') || 0,
  );
  consumerGenerationDeltas.push({
    reason: expectedReason,
    before: beforeGeneration,
    after: afterGeneration,
    delta: afterGeneration - beforeGeneration,
  });
  sameDocumentRecoveryCount += 1;
  reauthenticationCount += 1;
  reauthenticationMethod = 'mfg_recovery_button_settings_form_same_document';
}

async function processInteractionProbe() {
  if (!interactionProbeRequestPath || !fs.existsSync(interactionProbeRequestPath)) return;
  const request = JSON.parse(fs.readFileSync(interactionProbeRequestPath, 'utf8'));
  const id = String(request.id || '');
  if (!id || completedInteractionProbes.has(id)) return;
  completedInteractionProbes.add(id);
  const startedAtMs = Date.now();
  const probe = {
    id,
    started_at_ms: startedAtMs,
    finished_at_ms: 0,
    latency_ms: 0,
    status: 'running',
  };
  interactionProbes.push(probe);
  try {
    if (request.kind === 'forbidden_recovery') {
      const entitlementWindow = {
        reason: 'forbidden_entitlement_probe',
        started_at_ms: Date.now(),
        finished_at_ms: 0,
      };
      expectedHttpFailureWindows.push(entitlementWindow);
      const response = await page.evaluate(async ({ credential }) => {
        const login = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: credential,
            surface_id: 'webui',
            requested_capabilities: ['mfg.alert.respond'],
          }),
        });
        if (!login.ok) return { login_status: login.status, status: 0, error: await login.text() };
        const forbidden = await fetch('/api/apps/mfg/live/snapshot', {
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'x-cowd-observer-id': 'webui:forbidden-probe' },
        });
        let body = null;
        try {
          body = await forbidden.json();
        } catch {
          body = null;
        }
        window.dispatchEvent(new CustomEvent('cowd:mfg-entitlement-stale'));
        return { login_status: login.status, status: forbidden.status, body };
      }, { credential: token });
      if (
        response.login_status !== 200
        || response.status !== 403
        || response.body?.code !== 'capability_denied'
        || response.body?.http_status !== 403
      ) {
        throw new Error(`valid-session forbidden probe did not return typed 403: ${JSON.stringify(response)}`);
      }
      probe.authorization_error = response.body;
      await recoverThroughProductUi('forbidden');
      entitlementWindow.finished_at_ms = Date.now();
      forbiddenRecoveryCount += 1;
      probe.status = 'passed';
      return;
    }
    const refreshButton = page.locator('[data-mfg-workspace-refresh]');
    await refreshButton.click({ timeout: 10_000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-mfg-workspace-refresh]');
      const live = document.querySelector('[data-mfg-live-diagnostics]');
      return button instanceof HTMLButtonElement
        && !button.disabled
        && live?.getAttribute('data-live-status') === 'live';
    }, undefined, { timeout: 30_000 });
    probe.status = 'passed';
  } catch (error) {
    probe.status = 'failed';
    probe.error = error instanceof Error ? error.message : String(error);
  } finally {
    probe.finished_at_ms = Date.now();
    probe.latency_ms = probe.finished_at_ms - startedAtMs;
  }
}

let intervalBusy = false;
const interval = setInterval(() => {
  if (reauthenticating || intervalBusy) return;
  intervalBusy = true;
  void (async () => {
    if (profileReauthenticationCount === 0) {
      const evidence = await page.evaluate(() => window.__cowdMfgLiveEvidence);
      // A Gateway/Broker hand-over can emit a 401-shaped stream frame while
      // the local authority socket is absent. The product transport retries
      // that specific `authority_unavailable` reason; driving the login UI
      // here would turn a recoverable restart into a false session reset.
      const requiresReauthentication = evidence.stream_errors.some(
        (error) => error.code === 'authentication_required'
          && error.http_status === 401
          && error.details?.reason !== 'authority_unavailable',
      );
      if (requiresReauthentication) {
        reauthenticating = true;
        await recoverThroughProductUi('authentication');
        profileReauthenticationCount += 1;
        reauthenticating = false;
      }
    }
    await processInteractionProbe();
    await writeArtifact('live');
  })().catch((error) => {
    reauthenticating = false;
    consoleErrors.push(error instanceof Error ? error.message : String(error));
  }).finally(() => {
    intervalBusy = false;
  });
}, 1_000);

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  await writeArtifact(`stopped:${signal}`).catch(() => undefined);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await browser.close();
  process.exit(0);
}

process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
await new Promise(() => {});
