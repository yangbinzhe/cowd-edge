import { test, expect } from '@playwright/test';
import { EXECUTION_PROJECTION_SCHEMA_VERSION } from './src/generated/projection-contract-meta.ts';

const prompt = process.env.COWD_AGENTIC_E2E_PROMPT;
const expectedTeams = Number(process.env.COWD_AGENTIC_E2E_EXPECT_TEAMS || 0);
const expectedAgents = Number(process.env.COWD_AGENTIC_E2E_EXPECT_AGENTS || 0);
const resumeSessionId = process.env.COWD_AGENTIC_E2E_SESSION_ID || '';
const observer = `webui:agentic-live:${Date.now()}:${Math.random().toString(16).slice(2)}`;

test.beforeEach(async ({ page }) => {
  if (!prompt) throw new Error('COWD_AGENTIC_E2E_PROMPT is required');
  await page.addInitScript((observerId) => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
    sessionStorage.setItem('cowd.webui.observer_id', observerId);
  }, observer);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  // Keep the attached browser's writer identity for cancellation; an API
  // observer without the Surface lease cannot cancel this admitted turn.
  const stop = page.locator('.composer-stop-action');
  if (await stop.isVisible().catch(() => false)) {
    const receipt = page.waitForResponse((response) => (
      response.request().method() === 'POST'
        && /\/api\/sessions\/[^/]+\/cancel$/.test(new URL(response.url()).pathname)
    ), { timeout: 15_000 });
    await stop.click();
    const response = await receipt;
    await testInfo.attach('failure-cancellation.json', {
      body: await response.body(), contentType: 'application/json',
    });
    expect(response.ok(), 'failed test must not orphan its paid execution').toBe(true);
  }
});

test('natural-language UI ingress reaches a truthful terminal collaboration projection', async ({ page }, testInfo) => {
  const health = await page.request.get('/healthz');
  expect(health.status()).toBe(200);
  await page.goto(resumeSessionId
    ? `/index.html#/chat?session_id=${encodeURIComponent(resumeSessionId)}`
    : '/index.html#/chat');
  if (!resumeSessionId) await page.getByRole('button', { name: 'New session' }).click();
  const composer = page.locator('.composer textarea');
  await expect(composer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  const admission = page.waitForResponse((response) => (
    response.request().method() === 'POST'
      && /\/api\/sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname)
  ));
  await composer.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  const response = await admission;
  expect(response.ok(), await response.text()).toBe(true);
  const receipt = await response.json();
  const executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
  const sessionId = new URL(response.url()).pathname.split('/')[3] || '';
  expect(executionId).not.toBe('');
  expect(sessionId).not.toBe('');
  if (resumeSessionId) expect(sessionId).toBe(resumeSessionId);
  console.log(JSON.stringify({ sessionId, executionId }));
  await testInfo.attach('admission.json', {
    body: JSON.stringify({ sessionId, executionId, receipt }), contentType: 'application/json',
  });

  let projection;
  await expect.poll(async () => {
    const current = await page.request.get(
      `/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=full`,
    );
    if (!current.ok()) return `http:${current.status()}`;
    projection = await current.json();
    return String(projection?.live?.status || '').toLowerCase();
  }, {
    timeout: Number(process.env.COWD_AGENTIC_E2E_TIMEOUT_MS || 600_000) - 30_000,
    intervals: [2_000, 5_000, 10_000],
  }).toMatch(
    /^(complete|completed|failed|error|cancelled|blocked)$/,
  );
  await testInfo.attach('terminal-projection.json', {
    body: JSON.stringify(projection), contentType: 'application/json',
  });
  expect(String(projection?.live?.status || '').toLowerCase()).toMatch(/^(complete|completed)$/);

  expect(projection?.schema_version).toBe(EXECUTION_PROJECTION_SCHEMA_VERSION);
  if (projection?.agentic_collaboration) {
    expect(projection.agentic_collaboration.schema_version).toBe(5);
  }
  expect(projection?.execution_id).toBe(executionId);
  const programs = Array.isArray(projection?.agentic_collaboration?.programs)
    ? projection.agentic_collaboration.programs
    : [];
  const programTeams = programs.flatMap((program) => (
    Array.isArray(program?.teams) ? program.teams : []
  ));
  const programAgents = programs.flatMap((program) => (
    Array.isArray(program?.agents) ? program.agents : []
  ));
  // Program entities are the semantic collaboration authority. The flat
  // execution arrays may temporarily contain physical worker instances while
  // a Program is active, so they are only a fallback for non-Program graphs.
  const teams = programTeams.length > 0
    ? programTeams
    : (Array.isArray(projection?.teams) ? projection.teams : []);
  const agents = programAgents.length > 0
    ? programAgents
    : (Array.isArray(projection?.agents) ? projection.agents : []);
  expect(teams.length).toBe(expectedTeams);
  expect(agents.length).toBe(expectedAgents);
  for (const program of programs) {
    expect(String(program.status).toLowerCase()).toBe('verified');
  }
  for (const team of teams) expect(String(team?.name || '').trim()).not.toBe('');
  for (const agent of agents) {
    expect(String(agent?.name || agent?.display_name || agent?.role || '').trim()).not.toBe('');
    expect(String(agent?.role || '').trim()).not.toBe('');
  }

  await page.goto(`/index.html#/mission?section=teams&execution_id=${encodeURIComponent(executionId)}&session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.locator('body')).toContainText(/Mission|Team|Agent/i);
  await expect(page.locator('.vue-flow__node')).not.toHaveCount(0);
  await page.goto(`/index.html#/chat?session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.locator('.transcript')).toBeVisible();
  await expect(page.locator('.transcript article[data-role="user"]')).not.toHaveCount(0);
  await expect(page.locator('.transcript')).toContainText(prompt);
  await expect(page.locator('.transcript article[data-role="assistant"]')).not.toHaveCount(0);
});
