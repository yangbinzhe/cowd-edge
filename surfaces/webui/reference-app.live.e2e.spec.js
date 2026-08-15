import { expect, test } from '@playwright/test';

const appId = process.env.COWD_E2E_REFERENCE_APP_ID || 'reference-app';

async function catalog(request) {
  const response = await request.get('/api/apps');
  expect(response.ok()).toBeTruthy();
  const value = await response.json();
  expect(value.schema_version).toBe(1);
  return value.apps.find((entry) => entry.app_id === appId);
}

function decodeResponseChunks(value) {
  return JSON.parse(value.split('\n').map((chunk) => Buffer.from(chunk, 'base64url')).join(''));
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

  const invokeResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/apps/${encodeURIComponent(appId)}/operations/reference-app.echo/invoke`);
  await frame.getByRole('button', { name: 'Run echo' }).click();
  await expect(frame.locator('#output')).not.toBeEmpty();
  await expect(frame.locator('#output')).not.toContainText('APP_UNAVAILABLE');
  const response = await invokeResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/vnd.cowd.app+json;version=1');
  const output = decodeResponseChunks(await frame.locator('#output').textContent());
  expect(output.payload.echo).toEqual({ message: 'hello from the reference APP' });
  expect(detailRequests).toBe(1);
  expect((await catalog(request)).lifecycle.state).toBe('idle');

  const stream = await request.post(
    `/api/apps/${encodeURIComponent(appId)}/operations/reference-app.events/stream`,
    { headers: { 'x-cowd-surface-id': 'webui' }, data: { payload: {} } },
  );
  expect(stream.status()).toBe(200);
  expect(stream.headers()['content-type']).toBe('application/vnd.cowd.app.ndjson;version=1');
  const frames = (await stream.body()).toString('utf8').trim().split('\n').map(JSON.parse);
  expect(frames.map((frame) => frame.kind)).toEqual(['open', 'data', 'data', 'data', 'checkpoint', 'end']);
  const subscriptionId = frames[0].subscription_id;
  expect(frames.every((frame) => frame.subscription_id === subscriptionId)).toBeTruthy();
  const ack = await request.post(
    `/api/apps/${encodeURIComponent(appId)}/subscriptions/${encodeURIComponent(subscriptionId)}/ack`,
    { headers: { 'x-cowd-surface-id': 'webui' }, data: {
      schema_version: 1, subscription_id: subscriptionId,
      maximum_contiguous_sequence: frames.at(-1).sequence, cursor: 'cursor-3',
    } },
  );
  expect(ack.status()).toBe(204);
  const cancel = await request.delete(
    `/api/apps/${encodeURIComponent(appId)}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { 'x-cowd-surface-id': 'webui' } },
  );
  expect(cancel.status()).toBe(204);
  expect((await catalog(request)).lifecycle.state).toBe('idle');
});
