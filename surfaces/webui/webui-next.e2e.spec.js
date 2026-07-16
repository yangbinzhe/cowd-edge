import { test, expect } from '@playwright/test';

const realGateway = Boolean(process.env.COWD_E2E_GATEWAY_URL);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cowd.webui.locale', 'en-US');
  });
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
  await expect(page.locator('.rail-button')).toHaveCount(14);
  await expect(page.locator('.session-sidebar')).toBeVisible();
  await expect(page.locator('.companion-tabs')).toContainText('Activity');
  await expect(page.locator('.companion-tabs')).toContainText('Workspace');
  await expect(page.locator('.companion-tabs')).toContainText('Evidence');
  await expect(page.locator('.rail')).not.toContainText('Workspace');
  await expect(page.locator('.chat-workbench-links')).toBeVisible();
  await expect(page.locator('.run-panorama')).toHaveCount(0);
  await expect(page.locator('.transcript')).toBeVisible();
  await expect(page.locator('.composer textarea')).toBeVisible();
  await expect(page.locator('.turn-role')).toHaveCount(0);
  await expect(page.locator('.status-strip')).toContainText(
    realGateway ? /healthy|ready/ : /unknown|local|offline|healthy|ready/,
  );
  await expect(page.locator('.status-strip button')).not.toHaveText('');
  await page.locator('.mode-switch button').nth(1).click();
  await expect(page.locator('.composer-stats')).toBeVisible();
  await expect(page.locator('.run-panorama')).toHaveCount(0);
  await expect(page.locator('.companion-panel')).toHaveCount(0);
});

test('workspace tab supports folder browsing and editable preview surface', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await page.getByRole('button', { name: 'Workspace' }).click();
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
  await expect(page.locator('.section-row')).toHaveCount(7);
  await expect(page.locator('.capability-sidebar')).not.toContainText('Memory Graph');
  await expect(page.locator('.capability-sidebar')).not.toContainText('Settings');
  await expect(page.locator('.metric-card')).toHaveCount(4);
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
  await expect(page.getByRole('heading', { name: 'Context builder', exact: true })).toBeVisible();
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
  await expect(page.locator('.memory-sections')).toBeVisible();
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
  await expect(page.locator('.filter-row select')).toHaveCount(6);
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
  await expect(page.getByRole('button', { name: 'Assign task' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=data');
  await expect(page.locator('[data-section="data"]')).toContainText('Data configuration');
  await expect(page.getByRole('button', { name: 'Save source pack' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ingest facts' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=reality');
  await expect(page.locator('[data-section="reality"]')).toContainText('Reality and metrics');
  await page.goto('/index.html#/apps/mfg?section=evidence');
  await expect(page.locator('[data-section="evidence"]')).toContainText('Evidence center');
  await expect(page.getByRole('button', { name: 'Build evidence packet' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=operations');
  await expect(page.locator('[data-section="operations"]')).toContainText('Incidents and execution');
  await expect(page.getByRole('button', { name: 'Create incident' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=skills');
  await expect(page.locator('[data-section="skills"]')).toContainText('Skill execution');
  await expect(page.getByRole('button', { name: 'Plan skills' })).toBeVisible();
  await page.goto('/index.html#/apps/mfg?section=reports');
  await expect(page.locator('[data-section="reports"]')).toContainText('Reports and delivery');
  await expect(page.getByRole('button', { name: 'Generate report' })).toBeVisible();
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
  await expect(page.locator('.metric-row').first().locator('.metric-card')).toHaveCount(4);
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

test('composer model workspace and command controls are clickable', async ({ page }) => {
  await page.goto('/index.html#/chat');
  await page.locator('.status-strip button').click();
  await expect(page.getByRole('heading', { name: 'Model and profile' })).toBeVisible();
  await expect(page.locator('.command-modal')).toContainText(/Model|后端未报告可切换模型/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /root/ }).click();
  await expect(page.getByRole('heading', { name: 'Workspace picker' })).toBeVisible();
  await page.locator('.command-modal .choice-row').first().click();
  await expect(page.locator('.companion-tabs button.active')).toContainText('Workspace');

  await page.getByRole('button', { name: /Commands/ }).click();
  await expect(page.getByRole('heading', { name: 'Commands' })).toBeVisible();
  await expect(page.locator('.command-row, .modal-note').first()).toBeVisible();
});
