import { expect, test } from '@playwright/test';

const appId = process.env.COWD_E2E_REFERENCE_APP_ID || 'reference-app';

async function catalog(request) {
  const response = await request.get('/api/apps');
  expect(response.ok()).toBeTruthy();
  const value = await response.json();
  expect(value.schema_version).toBe(1);
  return value.apps.find((entry) => entry.app_id === appId);
}

test('real signed reference Bundle stays static until its first host-mediated request', async ({ page, request }) => {
  const before = await catalog(request);
  expect(before).toBeTruthy();
  expect(before.activation).toBe('lazy');
  expect(before.lifecycle.state).toBe('mounted');

  let detailRequests = 0;
  page.on('request', (event) => {
    if (new URL(event.url()).pathname === `/api/apps/${encodeURIComponent(appId)}`) detailRequests += 1;
  });
  await page.goto(`/#/apps/${encodeURIComponent(appId)}`);
  const frame = page.frameLocator(`iframe[title="${before.display_name} application"]`);
  await expect(frame.getByRole('heading', { name: 'Reference APP' })).toBeVisible();
  await expect(frame.locator('#status')).toHaveText('Verified MessageChannel connected.');
  expect((await catalog(request)).lifecycle.state).toBe('mounted');
  expect(detailRequests).toBe(0);

  await frame.getByRole('button', { name: 'Run echo' }).click();
  await expect(frame.locator('#output')).not.toBeEmpty();
  await expect(frame.locator('#output')).not.toContainText('APP_UNAVAILABLE');
  expect(detailRequests).toBe(1);
  expect((await catalog(request)).lifecycle.state).toBe('ready');
});
