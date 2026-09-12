import { test, expect } from '@playwright/test';
for (const count of [100, 1000, 10000]) {
  test(`${count} canonical nodes: search, outline, keyboard and bounded rendering`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const started = Date.now();
    await page.goto(`/e2e/graph-workbench.html?count=${count}`);
    await expect(page.getByRole('button', { name: '列表视图', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(30);
    await rows.first().focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(page.locator('#selection')).not.toHaveText('');
    await page.getByRole('button', { name: '搜索图', exact: true }).click();
    const input = page.locator('.graph-search-row input');
    const searchStart = Date.now(); await input.fill(`Task ${count - 1} 中文证据`);
    await expect(rows).toHaveCount(3);
    await expect(rows.last()).toContainText(`Task ${count - 1}`);
    await rows.last().click(); await expect(page.locator('#selection')).toHaveText(`task-${count - 1}`);
    const searchMs = Date.now() - searchStart;
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    await expect(page.locator('.graph-title')).toContainText('已展开 3');
    await expect(page.locator('.vue-flow__node').filter({ hasText: `Task ${count - 1} 中文证据` })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.graph-surface')).toHaveAttribute('data-layout-engine', 'elk');
    const domCount = await page.locator('*').count();
    await page.screenshot({ path: `/tmp/cowd-v2-u-browser-artifacts/graph-${count}-search.png` });
    await info.attach('measurements', { body: JSON.stringify({ count, searchMs, elapsedMs: Date.now() - started, domCount, errors }), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}

test('drag pins survive reload and can be released', async ({ page }) => {
  await page.goto('/e2e/graph-workbench.html?count=100');
  await page.getByRole('button', { name: '搜索图', exact: true }).click();
  await page.locator('.graph-search-row input').fill('Task 99 中文证据');
  await expect(page.locator('.graph-title')).toContainText('已展开 3');
    await expect(page.locator('.vue-flow__node').filter({ hasText: 'Task 99 中文证据' })).toBeVisible({ timeout: 20000 });
  const node = page.locator('.vue-flow__node').filter({ hasText: 'Task 99 中文证据' });
  const box = await node.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 8 }); await page.mouse.up();
  await expect(node.getByRole('button', { name: '解除 Task 99 中文证据 的固定位置' })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('cowd.graph.positions.v1'));
  await page.reload();
  await page.getByRole('button', { name: '搜索图', exact: true }).click();
  await page.locator('.graph-search-row input').fill('Task 99 中文证据');
  await expect(node.getByRole('button', { name: '解除 Task 99 中文证据 的固定位置' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cowd.graph.positions.v1'))).toBe(stored);
  await node.getByRole('button', { name: '解除 Task 99 中文证据 的固定位置' }).click();
  await expect(node.getByRole('button', { name: '解除 Task 99 中文证据 的固定位置' })).toHaveCount(0);
});

for (const theme of ['dark', 'light']) {
  test(`narrow ${theme} outline at 200% with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/e2e/graph-workbench.html?count=1000&theme=${theme}&locale=en`);
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect(page.getByRole('tree')).toBeVisible();
    await page.getByRole('treeitem').first().focus(); await page.keyboard.press('End');
    await page.keyboard.press('Enter'); await expect(page.locator('#selection')).not.toHaveText('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/cowd-v2-u-browser-artifacts/graph-${theme}-narrow.png` });
  });
}

test('full 10000-node canvas has bounded overview DOM and preserves manual pan on status updates', async ({ page }, info) => {
  await page.goto('/e2e/graph-workbench.html?count=10000');
  await expect(page.locator('.graph-surface')).toHaveAttribute('data-layout-engine', 'elk', { timeout: 30000 });
  await expect(page.locator('.graph-title')).toContainText('总量 10000');
  expect(await page.locator('.graph-minimap-node').count()).toBeLessThanOrEqual(640);
  const domCount = await page.locator('*').count();
  expect(domCount).toBeLessThan(5000);
  const pane = await page.locator('.vue-flow__pane').boundingBox();
  await page.mouse.move(pane.x + 20, pane.y + 20); await page.mouse.down();
  await page.mouse.move(pane.x + 130, pane.y + 90, { steps: 8 }); await page.mouse.up();
  const transform = await page.locator('.vue-flow__transformationpane').getAttribute('style');
  await page.locator('#update-status').click();
  await page.waitForTimeout(350);
  expect(await page.locator('.vue-flow__transformationpane').getAttribute('style')).toBe(transform);
  await info.attach('full-canvas', { body: JSON.stringify({ count: 10000, domCount, minimapCount: await page.locator('.graph-minimap-node').count() }), contentType: 'application/json' });
  await page.screenshot({ path: '/tmp/cowd-v2-u-browser-artifacts/graph-10000-overview.png' });
});
