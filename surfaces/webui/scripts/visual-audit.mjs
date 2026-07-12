#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const planRoot = process.env.COWD_PLAN_ROOT || path.resolve(webuiRoot, '../../..', 'plan/0701-webui-interaction-audit');
const version = process.env.COWD_VERSION || 'webui-interaction-current';
const baseUrl = process.env.COWD_VISUAL_BASE_URL || 'http://127.0.0.1:5195';
const screenshotDir = path.join(planRoot, 'screenshots', version);
const reportPath = path.join(planRoot, 'reports', `${version}-visual-audit.md`);

const routes = [
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

const viewports = [
  { id: 'mobile', width: 375, height: 812 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 960 },
  { id: 'wide', width: 1920, height: 1080 },
];

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
  if (metrics.bodyTextLength < 80) addFinding(findings, 'review', 'rendered text density is low');

  if (route.id === 'chat') {
    if (!metrics.composer.visible) {
      addFinding(findings, 'fail', 'chat composer is missing');
    } else if (metrics.composer.bottom > viewport.height || metrics.composer.top < 0) {
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
    const minWidth = viewport.width >= 1180 ? 900 : Math.min(320, viewport.width - 48);
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

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(15_000);
    for (const route of routes) {
      const url = routeUrl(route);
      const fileName = `${route.id}-${viewport.id}-${viewport.width}.png`;
      const filePath = path.join(screenshotDir, fileName);
      let status = 'pass';
      let note = 'layout gates passed';
      let metrics = {};
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.locator('.app-shell').waitFor({ state: 'visible' });
        await page.waitForTimeout(350);
        metrics = await page.evaluate(() => {
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
          const unlabeledIconButtons = Array.from(document.querySelectorAll('button.icon-action'))
            .filter((element) => visible(element))
            .filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('title') && !element.textContent?.trim()).length;
          const workflowHeights = Array.from(document.querySelectorAll('.workflow-strip'))
            .filter((element) => visible(element))
            .map((element) => Math.round(element.getBoundingClientRect().height));
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
            bodyTextLength: bodyText.length,
            bodyScrollRatio: document.body.scrollHeight / Math.max(window.innerHeight, 1),
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
          };
        });
        const findings = evaluateLayout(metrics, route, viewport);
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
        viewport: `${viewport.width}x${viewport.height}`,
        status,
        screenshot: path.relative(planRoot, filePath),
        note,
        metrics,
      });
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
  '| Route | Viewport | Chrome Share | Body Scroll | Composer | Settings Width | Workflow Min | Main Data | Tree | Raw Keys | Raw Tool | Small Targets | Unlabeled Icons |',
  '|---|---:|---:|---:|---|---:|---:|---|---|---:|---:|---:|---:|',
  ...rows.map((row) => `| ${row.route} | ${row.viewport} | ${Math.round((row.metrics.firstViewportChromeShare || 0) * 100)}% | ${(row.metrics.bodyScrollRatio || 0).toFixed(1)}x | ${row.metrics.composer?.visible ? `${row.metrics.composer.top}-${row.metrics.composer.bottom}` : '-'} | ${row.metrics.settingsContent?.width || 0} | ${row.metrics.visibleWorkflowCount ? row.metrics.minWorkflowHeight : '-'} | ${row.metrics.mainDataVisible ? 'yes' : 'no'} | ${row.metrics.workspaceTreeVisible ? 'yes' : '-'} | ${row.metrics.rawI18nKeyCount ?? 0} | ${row.metrics.rawToolEvidenceCount ?? 0} | ${row.metrics.smallTouchTargetCount ?? 0} | ${row.metrics.unlabeledIconButtons ?? 0} |`),
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
