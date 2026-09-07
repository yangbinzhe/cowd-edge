import { test, expect } from '@playwright/test';

const prompt = process.env.COWD_AGENTIC_E2E_PROMPT;
const expectedTeams = Number(process.env.COWD_AGENTIC_E2E_EXPECT_TEAMS || 0);
const expectedAgents = Number(process.env.COWD_AGENTIC_E2E_EXPECT_AGENTS || 0);
const observer = `webui:agentic-live:${Date.now()}:${Math.random().toString(16).slice(2)}`;

test.beforeEach(async ({ page }) => {
  if (!prompt) throw new Error('COWD_AGENTIC_E2E_PROMPT is required');
  await page.addInitScript((observerId) => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
    sessionStorage.setItem('cowd.webui.observer_id', observerId);
  }, observer);
});

test('natural-language UI ingress reaches a truthful terminal collaboration projection', async ({ page }) => {
  const health = await page.request.get('/healthz');
  expect(health.status()).toBe(200);
  await page.goto('/index.html#/chat');
  const composer = page.locator('.composer textarea');
  await expect(composer).toBeVisible();

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

  let projection;
  await expect.poll(async () => {
    const current = await page.request.get(
      `/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=full`,
    );
    if (!current.ok()) return `http:${current.status()}`;
    projection = await current.json();
    return String(projection?.live?.status || '').toLowerCase();
  }, { timeout: Number(process.env.COWD_AGENTIC_E2E_TIMEOUT_MS || 600_000) }).toMatch(
    /^(complete|completed|terminal|partial|blocked|failed|cancelled|error|unavailable)$/,
  );

  expect(projection?.schema_version).toBe(5);
  expect(projection?.execution_id).toBe(executionId);
  const teams = Array.isArray(projection?.teams) ? projection.teams : [];
  const agents = Array.isArray(projection?.agents) ? projection.agents : [];
  expect(teams.length).toBeGreaterThanOrEqual(expectedTeams);
  expect(agents.length).toBeGreaterThanOrEqual(expectedAgents);
  for (const team of teams) expect(String(team?.name || '').trim()).not.toBe('');
  for (const agent of agents) {
    expect(String(agent?.name || agent?.display_name || '').trim()).not.toBe('');
    expect(String(agent?.role || '').trim()).not.toBe('');
  }

  await page.goto(`/index.html#/mission?section=teams&execution_id=${encodeURIComponent(executionId)}&session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.locator('body')).toContainText(/Mission|Team|Agent/i);
  await expect(page.locator('.vue-flow__node')).not.toHaveCount(0);
  await page.goto(`/index.html#/chat?session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.locator('.transcript')).toBeVisible();
  await expect(page.locator('.turn-role')).not.toHaveCount(0);
});
