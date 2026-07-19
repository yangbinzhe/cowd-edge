#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const provenance = evidenceContext('visual-audit');
const planRoot = provenance.plan_root;
const version = provenance.version;
const full = process.argv.includes('--full');
const baseUrl = process.env.COWD_VISUAL_BASE_URL || 'http://127.0.0.1:5195';
const gatewayToken = process.env.COWD_VISUAL_GATEWAY_TOKEN || process.env.COWD_E2E_GATEWAY_TOKEN || '';
const layoutViewport = (viewport) => viewport.scenario === 'zoom-200'
  ? { width: Math.max(1, Math.floor(viewport.width / 2)), height: Math.max(1, Math.floor(viewport.height / 2)) }
  : { width: viewport.width, height: viewport.height };
const pageOptions = (viewport) => ({
  viewport: layoutViewport(viewport),
  ...(viewport.scenario === 'zoom-200' ? { deviceScaleFactor: 2 } : {}),
  ...(gatewayToken ? { extraHTTPHeaders: { Authorization: `Bearer ${gatewayToken}` } } : {}),
});
const screenshotDir = path.join(planRoot, 'artifacts', version, 'visual-audit');
const reportPath = path.join(planRoot, 'reports', version, `${version}-visual-audit.md`);

const baseRoutes = [
  { id: 'chat', path: '/#/chat' },
  { id: 'runtime', path: '/#/runtime' },
  { id: 'mission', path: '/#/mission' },
  { id: 'context', path: '/#/context' },
  { id: 'memory', path: '/#/memory' },
  { id: 'reality', path: '/#/reality' },
  { id: 'skills', path: '/#/skills' },
  { id: 'agents', path: '/#/agents' },
  { id: 'tools', path: '/#/tools' },
  { id: 'surfaces', path: '/#/surfaces' },
  { id: 'gateway', path: '/#/gateway' },
  { id: 'mfg', path: '/#/apps/mfg' },
  { id: 'audit', path: '/#/audit' },
  { id: 'settings', path: '/#/settings' },
];

const baseViewports = full ? [
  { id: 'mobile-360', width: 360, height: 800 },
  { id: 'mobile-390', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'breakpoint-before', width: 1179, height: 900 },
  { id: 'breakpoint-at', width: 1180, height: 900 },
  { id: 'desktop', width: 1440, height: 960 },
  { id: 'wide', width: 1920, height: 1080 },
] : [
  { id: 'mobile-390', width: 390, height: 844 },
  { id: 'breakpoint-at', width: 1180, height: 900 },
  { id: 'desktop', width: 1440, height: 960 },
];
const scenarios = full ? ['normal', 'zoom-200', 'long-content'] : ['normal'];
const viewports = baseViewports.flatMap((viewport) => scenarios.map((scenario) => ({
  ...viewport,
  id: `${viewport.id}-${scenario}`,
  scenario,
})));
let routes = [...baseRoutes];

fs.mkdirSync(screenshotDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

function addFinding(findings, severity, message) {
  findings.push({ severity, message });
}

function statusFrom(findings) {
  if (findings.some((finding) => finding.severity === 'fail')) return 'fail';
  if (findings.some((finding) => finding.severity === 'review')) return 'review';
  return 'pass';
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '/').replace(/\n/g, ' ');
}

function routeUrl(route) {
  if (/\.html($|[?#])/.test(baseUrl)) {
    return `${baseUrl}${route.path.replace(/^\/#/, '#')}`;
  }
  return `${baseUrl}${route.path}`;
}

function evaluateLayout(metrics, route, viewport) {
  const findings = [];
  if (!metrics.shellVisible || !metrics.mainVisible) addFinding(findings, 'fail', 'app shell or main surface is not visible');
  if (!metrics.expectedSectionVisible) addFinding(findings, 'fail', 'deep-linked section is not visible');
  if (metrics.visibleSectionCount > 1) addFinding(findings, 'fail', `${metrics.visibleSectionCount} page sections are simultaneously visible`);
  if (metrics.horizontalOverflow > 2) addFinding(findings, 'fail', `page has ${metrics.horizontalOverflow}px horizontal overflow`);
  if (metrics.wrappedDataHeaderCount > 0) addFinding(findings, 'fail', `${metrics.wrappedDataHeaderCount} data table headers wrap across lines`);
  if (metrics.croppedCriticalControls > 0) {
    const details = (metrics.croppedCriticalControlDetails || []).slice(0, 3).map((item) => item.label).join(', ');
    addFinding(findings, 'fail', `${metrics.croppedCriticalControls} critical controls are clipped outside the viewport${details ? `: ${details}` : ''}`);
  }
  if (metrics.fixedControlOverlapCount > 0) {
    const details = (metrics.fixedControlOverlapDetails || []).slice(0, 3).join(', ');
    addFinding(findings, 'fail', `${metrics.fixedControlOverlapCount} controls overlap the global page controls${details ? `: ${details}` : ''}`);
  }
  if (metrics.bodyTextLength < 80) addFinding(findings, 'review', 'rendered text density is low');

  if (route.id === 'chat') {
    if (!metrics.composer.visible) {
      addFinding(findings, 'fail', 'chat composer is missing');
    } else if (metrics.composer.bottom > viewport.height + 1 || metrics.composer.top < 0) {
      addFinding(findings, 'fail', `chat composer is outside first viewport: top=${metrics.composer.top}, bottom=${metrics.composer.bottom}`);
    }
    if (viewport.width < 820 && metrics.companion.visible) {
      addFinding(findings, 'fail', 'mobile chat should start with companion collapsed');
    }
    if (metrics.rawToolEvidenceCount > 0) {
      addFinding(findings, 'fail', `${metrics.rawToolEvidenceCount} raw tool evidence markers are visible in chat body`);
    }
  }

  if (route.id === 'settings') {
    const minWidth = viewport.width >= 1180
      ? Math.min(900, Math.floor(viewport.width * 0.6))
      : Math.min(320, Math.max(120, viewport.width - (viewport.width < 820 ? 44 : 48)));
    if (metrics.settingsContent.width < minWidth) {
      addFinding(findings, 'fail', `settings content width too narrow: ${metrics.settingsContent.width}px < ${minWidth}px`);
    }
    if (metrics.companion.visible) addFinding(findings, 'fail', 'settings route should not render companion panel');
  }

  if (route.id !== 'chat' && route.id !== 'settings' && metrics.companion.visible) {
    addFinding(findings, 'review', 'workbench companion is open by default; expected collapsed until requested');
  }

  if (metrics.firstViewportChromeShare > (viewport.width < 820 ? 0.42 : 0.38)) {
    const severity = metrics.firstViewportChromeShare > (viewport.width < 820 ? 0.58 : 0.5) ? 'fail' : 'review';
    addFinding(findings, severity, `top chrome consumes ${Math.round(metrics.firstViewportChromeShare * 100)}% of viewport`);
  }

  if (route.id !== 'chat' && route.id !== 'settings' && !metrics.mainDataVisible) {
    addFinding(findings, 'review', 'first viewport has no visible primary data structure');
  }

  if (metrics.workspaceTabVisible && !metrics.workspaceTreeVisible) {
    addFinding(findings, 'fail', 'workspace tab is visible without the file tree');
  }

  if (viewport.width < 820 && metrics.smallTouchTargetCount > 0) {
    addFinding(findings, 'review', `${metrics.smallTouchTargetCount} visible controls are below 44px touch target`);
  }
  if (viewport.width < 820 && !metrics.mobileMoreNavigationVisible) {
    addFinding(findings, 'fail', 'mobile navigation has no visible all-features entry');
  }

  if (viewport.width < 820 && metrics.bodyScrollRatio > 10) {
    addFinding(findings, 'review', `mobile body scroll ratio remains high: ${metrics.bodyScrollRatio.toFixed(1)}x`);
  }

  if (metrics.unlabeledIconButtons > 0) {
    addFinding(findings, 'review', `${metrics.unlabeledIconButtons} visible icon buttons have no aria-label or title`);
  }

  if (metrics.visibleWorkflowCount > 0 && metrics.minWorkflowHeight < 40) {
    addFinding(findings, 'fail', `visible workflow strip is collapsed: min height ${metrics.minWorkflowHeight}px`);
  }

  if (metrics.rawI18nKeyCount > 0) {
    addFinding(findings, 'fail', `${metrics.rawI18nKeyCount} raw i18n keys are visible`);
  }

  return findings;
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});

const rows = [];
const failures = [];
const reviews = [];
let completedChecks = 0;

try {
  if (full) {
    const discoveryPage = await browser.newPage(pageOptions({ width: 1440, height: 960 }));
    const discovered = [];
    for (const route of baseRoutes) {
      try {
        await discoveryPage.goto(routeUrl(route), { waitUntil: 'domcontentloaded' });
        await discoveryPage.locator('.app-shell').waitFor({ state: 'visible' });
        await discoveryPage.waitForFunction((pageId) => document.querySelector('.main-surface')?.getAttribute('data-page') === pageId, route.id);
        await discoveryPage.waitForTimeout(100);
        let sections = await discoveryPage.locator('.capability-section-nav select option').evaluateAll((options) => options
          .map((option) => option.getAttribute('value'))
          .filter(Boolean));
        if (!sections.length && route.id === 'settings') {
          const settingsButtons = discoveryPage.locator('.settings-nav button');
          const count = await settingsButtons.count();
          sections = [];
          for (let index = 0; index < count; index += 1) {
            await settingsButtons.nth(index).click();
            const active = await discoveryPage.locator('.settings-content').getAttribute('data-active-section');
            if (active) sections.push(active);
          }
        }
        if (!sections.length) {
          sections = await discoveryPage.evaluate(() => Array.from(document.querySelectorAll('[data-section]'))
            .map((element) => element.getAttribute('data-section'))
            .filter(Boolean));
        }
        for (const section of new Set(sections)) {
          discovered.push({
            id: `${route.id}--${section}`,
            pageId: route.id,
            section,
            path: `${route.path}${route.path.includes('?') ? '&' : '?'}section=${encodeURIComponent(section)}`,
          });
        }
        if (!sections.length) discovered.push(route);
      } catch (error) {
        failures.push(`${route.id}/section-discovery: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await discoveryPage.close();
    routes = discovered.length ? discovered : baseRoutes;
  }
  for (const viewport of viewports) {
    const page = await browser.newPage(pageOptions(viewport));
    page.setDefaultTimeout(15_000);
    for (const route of routes) {
      const url = routeUrl(route);
      const fileName = `${route.id}-${viewport.id}-${viewport.width}.png`;
      const filePath = path.join(screenshotDir, fileName);
      let status = 'pass';
      let note = 'layout gates passed';
      let metrics = {};
      try {
        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.locator('.app-shell').waitFor({ state: 'visible' });
        await page.waitForFunction(({ pageId, section }) => {
          const main = document.querySelector('.main-surface');
          if (main?.getAttribute('data-page') !== pageId) return false;
          if (!section) return true;
          return Array.from(document.querySelectorAll('[data-section]')).some((element) => {
            if (element.getAttribute('data-section') !== section) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
        }, { pageId: route.pageId || route.id, section: route.section || '' });
        await page.waitForFunction(() => !document.querySelector('.page-header .primary-action:disabled, [data-mfg-workspace-refresh]:disabled'), undefined, { timeout: 3_000 }).catch(() => {});
        await page.waitForTimeout(120);
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          for (const element of document.querySelectorAll('*')) {
            if (element.scrollTop) element.scrollTop = 0;
            if (element.scrollLeft) element.scrollLeft = 0;
          }
        });
        if (viewport.scenario === 'long-content') {
          await page.evaluate(() => {
            const visibleTarget = (selector) => Array.from(document.querySelectorAll(selector)).find((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            });
            const target = [
              '.transcript',
              '[data-section].management-panel',
              '[data-section].mission-panel',
              '[data-section].settings-section',
              '[data-section].mfg-page__workspace',
              '[data-section].skills-catalog',
              '.capability-page [data-section]',
              '.settings-content',
              '.capability-page',
              '.settings-page',
              '.chat-page',
            ].map(visibleTarget).find(Boolean);
            const probe = document.createElement('p');
            probe.className = 'visual-audit-long-content';
            probe.textContent = '超长制造运营上下文 Long manufacturing operational context '.repeat(35);
            probe.style.overflowWrap = 'anywhere';
            probe.style.maxWidth = '100%';
            target?.appendChild(probe);
            window.scrollTo(0, 0);
            for (const element of document.querySelectorAll('*')) {
              if (element.scrollTop) element.scrollTop = 0;
              if (element.scrollLeft) element.scrollLeft = 0;
            }
          });
        }
        metrics = await page.evaluate((expectedSection) => {
          const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const rectOf = (selector) => {
            const element = document.querySelector(selector);
            if (!visible(element)) return { visible: false, width: 0, height: 0, top: 0, bottom: 0 };
            const rect = element.getBoundingClientRect();
            return {
              visible: true,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
            };
          };
          const bodyText = document.body.innerText.trim();
          const sectionElements = Array.from(document.querySelectorAll('[data-section]'));
          const visibleSections = new Set(sectionElements.filter((element) => visible(element)).map((element) => element.getAttribute('data-section')));
          const firstViewportChrome = [
            '.page-header',
            '.primary-context-bar',
            '.workflow-strip',
            '.metric-row',
            '.chat-workbench-links',
            '.run-panorama',
            '.clean-counts',
          ].map((selector) => rectOf(selector)).filter((rect) => rect.visible && rect.top < window.innerHeight);
          const visibleControls = Array.from(document.querySelectorAll('button, a, input, select, textarea'))
            .filter((element) => visible(element) && element.getBoundingClientRect().top < window.innerHeight);
          const touchTargetRect = (element) => {
            if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
              const label = element.closest('label') || document.querySelector(`label[for="${element.id}"]`);
              if (label && visible(label)) return label.getBoundingClientRect();
            }
            return element.getBoundingClientRect();
          };
          const smallTouchTargetCount = visibleControls.filter((element) => {
            const rect = touchTargetRect(element);
            return rect.width < 44 || rect.height < 44;
          }).length;
          const croppedCriticalControlElements = visibleControls.filter((element) => {
            const rect = element.getBoundingClientRect();
            const critical = element.matches('.primary-action, [type="submit"], .section-nav button, .rail-button');
            if (!critical) return false;
            const scrollReachable = (axis) => {
              for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const overflow = axis === 'x' ? style.overflowX : style.overflowY;
                const scrollable = axis === 'x'
                  ? parent.scrollWidth > parent.clientWidth + 1
                  : parent.scrollHeight > parent.clientHeight + 1;
                if (scrollable && (overflow === 'auto' || overflow === 'scroll')) return true;
              }
              return false;
            };
            const horizontallyReachable = scrollReachable('x');
            const verticallyReachable = scrollReachable('y');
            const clippedByAncestor = (() => {
              for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const parentRect = parent.getBoundingClientRect();
                if (!horizontallyReachable && (style.overflowX === 'hidden' || style.overflowX === 'clip')
                  && (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1)) return true;
                if (!verticallyReachable && (style.overflowY === 'hidden' || style.overflowY === 'clip')
                  && (rect.top < parentRect.top - 1 || rect.bottom > parentRect.bottom + 1)) return true;
              }
              return false;
            })();
            const inaccessibleHorizontally = (rect.left < -1 || rect.right > window.innerWidth + 1) && !horizontallyReachable;
            const inaccessibleVertically = rect.top < -1 && !verticallyReachable;
            return clippedByAncestor || inaccessibleHorizontally || inaccessibleVertically;
          });
          const croppedCriticalControlDetails = croppedCriticalControlElements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || element.tagName.toLowerCase(),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
            };
          });
          const croppedCriticalControls = croppedCriticalControlElements.length;
          const fixedControls = Array.from(document.querySelectorAll('.global-locale-switch, .companion-toggle')).filter(visible);
          const fixedControlOverlapDetails = [];
          const overlaps = (left, right) => {
            const a = left.getBoundingClientRect();
            const b = right.getBoundingClientRect();
            return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
              && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
          };
          for (const fixed of fixedControls) {
            for (const control of visibleControls) {
              if (control === fixed || fixedControls.includes(control) || fixed.contains(control) || control.contains(fixed)) continue;
              if (!overlaps(fixed, control)) continue;
              const fixedLabel = fixed.getAttribute('aria-label') || fixed.className;
              const controlLabel = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim().replace(/\s+/g, ' ').slice(0, 48) || control.tagName.toLowerCase();
              fixedControlOverlapDetails.push(`${fixedLabel} ↔ ${controlLabel}`);
            }
          }
          const fixedControlOverlapCount = fixedControlOverlapDetails.length;
          const unlabeledIconButtons = Array.from(document.querySelectorAll('button.icon-action'))
            .filter((element) => visible(element))
            .filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('title') && !element.textContent?.trim()).length;
          const workflowHeights = Array.from(document.querySelectorAll('.workflow-strip'))
            .filter((element) => visible(element))
            .map((element) => Math.round(element.getBoundingClientRect().height));
          const wrappedDataHeaderCount = Array.from(document.querySelectorAll('.data-table th button'))
            .filter((element) => visible(element))
            .filter((element) => {
              const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 16;
              return element.getBoundingClientRect().height > lineHeight * 1.55;
            }).length;
          const mainDataVisible = [
            '.data-table',
            'table',
            '.workspace-tree',
            '.activity-list',
            '.evidence-list',
            '.agents-workbench-grid',
            '.agents-task-layout',
            '.agent-graph-lanes',
            '.mission-grid',
            '.management-grid',
            '.runtime-grid',
            '.context-grid',
            '.memory-workbench',
            '.reality-grid',
            '.gateway-grid',
            '.settings-workbench',
            '.skills-console',
            '.surface-grid',
            '.mfg-workbench',
            '.mfg-lanes',
            '.mfg-layout',
            '.mfg-page',
            '.mfg-cockpit',
            '.mfg-focus',
            '.mfg-collaboration',
            '.mfg-domain',
            '.audit-grid',
            '.transcript',
          ].some((selector) => {
            const rect = rectOf(selector);
            return rect.visible && rect.top < window.innerHeight;
          });
          const chromeHeight = firstViewportChrome.reduce((sum, rect) => sum + rect.height, 0);
          return {
            shellVisible: visible(document.querySelector('.app-shell')),
            mainVisible: visible(document.querySelector('.main-surface')),
            expectedSectionVisible: !expectedSection || sectionElements.some((element) => element.getAttribute('data-section') === expectedSection && visible(element)),
            visibleSectionCount: visibleSections.length,
            bodyTextLength: bodyText.length,
            bodyScrollRatio: document.body.scrollHeight / Math.max(window.innerHeight, 1),
            horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
            croppedCriticalControls,
            croppedCriticalControlDetails,
            fixedControlOverlapCount,
            fixedControlOverlapDetails,
            firstViewportChromeShare: chromeHeight / Math.max(window.innerHeight, 1),
            composer: rectOf('.composer'),
            settingsContent: rectOf('.settings-content'),
            companion: rectOf('.companion-panel'),
            smallTouchTargetCount,
            unlabeledIconButtons,
            visibleWorkflowCount: workflowHeights.length,
            minWorkflowHeight: workflowHeights.length ? Math.min(...workflowHeights) : 0,
            mainDataVisible,
            workspaceTabVisible: visible(document.querySelector('.workspace-tab')),
            workspaceTreeVisible: visible(document.querySelector('.workspace-tree')),
            rawI18nKeyCount: (bodyText.match(/\b(?:status|unit|page|component|script|template|common)\.[a-zA-Z0-9_.-]+|\bstore\.app\.[a-zA-Z0-9_.-]+/g) || []).length,
            rawToolEvidenceCount: (bodyText.match(/Raw evidence ref:|Summary:\s*[\[{]/g) || []).length,
            wrappedDataHeaderCount,
            mobileMoreNavigationVisible: visible(document.querySelector('.mobile-more')),
          };
        }, route.section || null);
        const findings = evaluateLayout(metrics, { ...route, id: route.pageId || route.id }, { ...viewport, ...layoutViewport(viewport) });
        status = statusFrom(findings);
        note = findings.length ? findings.map((finding) => finding.message).join('; ') : note;
        findings.forEach((finding) => {
          const line = `${route.id}/${viewport.id}: ${finding.message}`;
          if (finding.severity === 'fail') failures.push(line);
          if (finding.severity === 'review') reviews.push(line);
        });
        await page.screenshot({ path: filePath, fullPage: true });
      } catch (error) {
        status = 'fail';
        note = error instanceof Error ? error.message : String(error);
        failures.push(`${route.id}/${viewport.id}: ${note}`);
        await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
      }
      rows.push({
        route: route.id,
        viewport: `${viewport.width}x${viewport.height}/${viewport.scenario}`,
        status,
        screenshot: path.relative(planRoot, filePath),
        note,
        metrics,
      });
      completedChecks += 1;
      if (full && completedChecks % 50 === 0) {
        console.log(`Visual audit progress: ${completedChecks}/${routes.length * viewports.length}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}

const markdown = [
  `# ${version} Visual Audit`,
  '',
  `Generated: ${new Date().toISOString()}`,
  `Mode: ${full ? 'full' : 'quick'}`,
  `Frontend commit: ${provenance.frontend.commit}`,
  `Backend commit: ${provenance.backend.commit}`,
  `Base URL: ${baseUrl}`,
  '',
  `Status: ${failures.length ? 'fail' : 'pass'}`,
  '',
  '| Route | Viewport | Status | Screenshot | Note |',
  '|---|---:|---|---|---|',
  ...rows.map((row) => `| ${row.route} | ${row.viewport} | ${row.status} | ${row.screenshot} | ${escapeCell(row.note)} |`),
  '',
  '## Layout Metrics',
  '',
  '| Route | Viewport | Chrome Share | Body Scroll | H Overflow | Cropped Actions | Composer | Settings Width | Workflow Min | Main Data | Tree | Raw Keys | Raw Tool | Small Targets | Unlabeled Icons |',
  '|---|---:|---:|---:|---:|---:|---|---:|---:|---|---|---:|---:|---:|---:|',
  ...rows.map((row) => `| ${row.route} | ${row.viewport} | ${Math.round((row.metrics.firstViewportChromeShare || 0) * 100)}% | ${(row.metrics.bodyScrollRatio || 0).toFixed(1)}x | ${row.metrics.horizontalOverflow || 0} | ${row.metrics.croppedCriticalControls || 0} | ${row.metrics.composer?.visible ? `${row.metrics.composer.top}-${row.metrics.composer.bottom}` : '-'} | ${row.metrics.settingsContent?.width || 0} | ${row.metrics.visibleWorkflowCount ? row.metrics.minWorkflowHeight : '-'} | ${row.metrics.mainDataVisible ? 'yes' : 'no'} | ${row.metrics.workspaceTreeVisible ? 'yes' : '-'} | ${row.metrics.rawI18nKeyCount ?? 0} | ${row.metrics.rawToolEvidenceCount ?? 0} | ${row.metrics.smallTouchTargetCount ?? 0} | ${row.metrics.unlabeledIconButtons ?? 0} |`),
  '',
  '## Failures',
  '',
  ...(failures.length ? failures.map((failure) => `- ${failure}`) : ['- No failing layout gate observed.']),
  '',
  '## Review Items',
  '',
  ...(reviews.length ? reviews.map((review) => `- ${review}`) : ['- No review-level layout issue observed.']),
  '',
].join('\n');

fs.writeFileSync(reportPath, markdown);

if (failures.length) {
  console.error(`Visual audit failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log(`Visual audit written to ${reportPath}`);
