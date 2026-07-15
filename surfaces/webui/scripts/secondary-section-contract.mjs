#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const gate = process.argv.includes('--gate');

const pages = {
  runtime: { file: 'RuntimePage.vue', sections: ['overview', 'mission-link', 'runs', 'policy', 'timeline', 'growth'] },
  mission: { file: 'MissionControlPage.vue', sections: ['overview', 'sessions', 'teams', 'agents', 'routes', 'runtime-v2', 'relations', 'approvals', 'trace'] },
  context: { file: 'ContextPage.vue', sections: ['packet', 'budget', 'evidence', 'history'] },
  reality: { file: 'RealityCorePage.vue', sections: ['management', 'core-map', 'overview', 'fact-flow', 'context-runtime', 'evidence', 'promotions', 'boundaries'] },
  memory: { file: 'MemoryPage.vue', sections: ['layers', 'recall', 'graph', 'context-envelope', 'knowledge-governance', 'maintenance', 'structured-core'] },
  skills: { file: 'SkillsPage.vue', sections: ['catalog', 'projection', 'files', 'runs', 'governance'] },
  agents: { file: 'AgentsPage.vue', sections: ['catalog', 'discovery', 'managed-agents', 'tasks', 'reviews', 'graph', 'runs'] },
  tools: { file: 'ToolsPage.vue', sections: ['registry', 'operations', 'mutations', 'checkpoints', 'cache', 'ledger', 'risk'] },
  surfaces: { file: 'SurfacePage.vue', sections: ['health', 'registry', 'routes', 'dispatch', 'delivery', 'trigger-events', 'events'] },
  gateway: { file: 'GatewayPage.vue', sections: ['alignment', 'connectors', 'resources', 'executions', 'identities'] },
  mfg: { file: 'MfgPage.vue', sections: ['overview', 'data-plane', 'source-pack', 'entities', 'metrics', 'evidence', 'incident-room', 'actions', 'skills', 'reports'] },
  audit: { file: 'AuditPage.vue', sections: ['global-timeline', 'logs', 'usage', 'release', 'harness-eval', 'harness-eval-runs', 'harness-eval-scenarios', 'evolution', 'evaluation-policy', 'approvals', 'cross-plane'] },
};

function read(relativePath) {
  return fs.readFileSync(path.join(webuiRoot, relativePath), 'utf8');
}

function unique(values) {
  return Array.from(new Set(values));
}

function hasCapabilitySection(capabilityText, sectionId) {
  return capabilityText.includes(`section('${sectionId}'`)
    || capabilityText.includes(`{ id: '${sectionId}'`);
}

const capabilityText = read('src/data/capabilities.ts');
const failures = [];
const pageReports = [];

for (const [pageId, page] of Object.entries(pages)) {
  const pageText = read(path.join('src/pages', page.file));
  const actualSections = unique(Array.from(pageText.matchAll(/data-section="([^"]+)"/g))
    .map((match) => match[1])
    .filter((sectionId) => !sectionId.includes('${'))).sort();
  const expectedSections = [...page.sections].sort();
  const missingInPage = expectedSections.filter((sectionId) => !actualSections.includes(sectionId));
  const unexpectedInPage = actualSections.filter((sectionId) => !expectedSections.includes(sectionId));
  const missingInCapability = expectedSections.filter((sectionId) => !hasCapabilitySection(capabilityText, sectionId));
  const hasPageSpec = capabilityText.includes(`${pageId}: spec(`);

  if (!hasPageSpec) failures.push(`${pageId}: capability spec missing`);
  for (const sectionId of missingInPage) failures.push(`${pageId}: page missing data-section ${sectionId}`);
  for (const sectionId of unexpectedInPage) failures.push(`${pageId}: page has unregistered data-section ${sectionId}`);
  for (const sectionId of missingInCapability) failures.push(`${pageId}: capability spec missing section ${sectionId}`);

  pageReports.push({
    page: pageId,
    file: page.file,
    expected_sections: expectedSections,
    actual_sections: actualSections,
    status: !missingInPage.length && !unexpectedInPage.length && !missingInCapability.length && hasPageSpec ? 'pass' : 'fail',
  });
}

const report = {
  status: failures.length ? 'fail' : 'pass',
  pages: pageReports,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length && gate) process.exit(1);
