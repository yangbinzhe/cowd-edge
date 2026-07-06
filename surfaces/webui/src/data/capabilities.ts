import { t } from '../i18n';
import type { CapabilityAction, CapabilitySection, CapabilitySpec, NavId } from '../types';

type CapabilityId = Exclude<NavId, 'chat' | 'settings'>;

function spec(
  id: CapabilityId,
  title: string,
  subtitle: string,
  sections: CapabilitySection[],
  actions: CapabilityAction[],
  inspector: Array<{ label: string; value: string }>,
): CapabilitySpec {
  return {
    id,
    title,
    subtitle,
    primaryAction: actions[0]?.label || 'Refresh',
    metrics: [],
    chartKind: 'bar',
    chartTitle: '',
    chartData: [],
    tableTitle: '',
    rows: [],
    sections,
    actions,
    inspector,
  };
}

function section(
  id: string,
  label: string,
  description: string,
  displayMode: CapabilitySection['displayMode'] = 'detail',
  density: CapabilitySection['density'] = 'standard',
  primaryObject = '',
): CapabilitySection {
  return {
    id,
    label,
    description,
    displayMode,
    density,
    ...(primaryObject ? { primaryObject } : {}),
  };
}

export function buildCapabilitySpecs(): Record<CapabilityId, CapabilitySpec> {
  return {
  runtime: spec(
    'runtime',
    t('data.capabilities.string.779178eae6'),
    t('data.capabilities.string.004510a45b'),
    [
      section('overview', t('script.data.capabilities.label.0efc2e6be4'), t('data.capabilities.string.f0a3e31e80'), 'summary', 'compact', 'runtime.status'),
      section('mission', t('capability.section.runtime.mission.label'), t('capability.section.runtime.mission.description'), 'table', 'standard', 'runtime.mission'),
      section('runs', t('script.data.capabilities.label.fcde5c325d'), t('data.capabilities.string.2aa35b8983'), 'table', 'standard', 'runtime.run'),
      section('policy', t('script.data.capabilities.label.bb9cf14180'), t('data.capabilities.string.2742c73c25'), 'governance', 'inspect', 'runtime.policy'),
      section('timeline', t('script.data.capabilities.label.018514a3d5'), t('data.capabilities.string.932915f166'), 'timeline', 'standard', 'runtime.event'),
      section('growth', t('script.data.capabilities.label.f3b21e049f'), t('data.capabilities.string.bb512225ea'), 'timeline', 'standard', 'growth.event'),
    ],
    [
      { label: t('data.capabilities.string.01a9c40568'), kind: 'primary', endpoint: '/api/runtime/timeline' },
      { label: t('config.reload.statusEndpoint'), kind: 'secondary', endpoint: '/api/runtime/config/reload/status' },
      { label: t('data.capabilities.string.3ee57607c7'), kind: 'secondary', endpoint: '/api/runtime/session-leases/acquire' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/runtime/control-plane' },
      { label: t('script.data.capabilities.label.f3b21e049f'), value: '/api/growth/status, /api/growth/events' },
      { label: t('script.data.capabilities.label.73fe3c6ca7'), value: t('data.capabilities.string.a8cdf07d68') },
      { label: t('script.data.capabilities.label.700b401ca5'), value: t('data.capabilities.string.6ba3689767') },
    ],
  ),
  mission: spec(
    'mission',
    t('capability.mission.title'),
    t('capability.mission.subtitle'),
    [
      section('overview', t('script.data.capabilities.label.0efc2e6be4'), t('capability.section.mission.overview.description'), 'summary', 'compact', 'mission.overview'),
      section('sessions', t('capability.section.mission.sessions.label'), t('capability.section.mission.sessions.description'), 'queue', 'standard', 'mission.session'),
      section('teams', t('capability.section.mission.teams.label'), t('capability.section.mission.teams.description'), 'queue', 'standard', 'mission.team'),
      section('agents', t('capability.section.mission.agents.label'), t('capability.section.mission.agents.description'), 'table', 'standard', 'mission.agent'),
      section('routes', t('capability.section.mission.routes.label'), t('capability.section.mission.routes.description'), 'form', 'standard', 'mission.route'),
      section('runtime-v2', t('page.mission.control.runtimeV2.title'), t('capability.section.mission.runtimeV2.description'), 'table', 'standard', 'mission.runtime_v2'),
      section('inbox', t('capability.section.mission.inbox.label'), t('capability.section.mission.inbox.description'), 'queue', 'standard', 'mission.command'),
      section('approvals', t('capability.section.mission.approvals.label'), t('capability.section.mission.approvals.description'), 'governance', 'inspect', 'mission.approval'),
      section('trace', t('capability.section.mission.trace.label'), t('capability.section.mission.trace.description'), 'timeline', 'standard', 'mission.trace'),
    ],
    [
      { label: t('capability.mission.action.refresh'), kind: 'primary', endpoint: '/api/mission/control' },
      { label: t('capability.mission.action.dispatch'), kind: 'secondary', endpoint: '/api/mission/sessions/dispatch' },
      { label: t('capability.mission.action.recovery'), kind: 'secondary', endpoint: '/api/runtime/recovery/report' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/mission/*' },
      { label: t('capability.mission.inspector.boundary'), value: t('capability.mission.inspector.boundaryValue') },
      { label: t('capability.mission.inspector.runtime'), value: '/api/collaboration/*, /api/stewards/*' },
    ],
  ),
  context: spec(
    'context',
    t('data.capabilities.string.588dc9009b'),
    t('data.capabilities.string.938605f249'),
    [
      section('packet', t('data.capabilities.string.75dc3867d8'), t('data.capabilities.string.92a93646fd'), 'table', 'standard', 'context.packet'),
      section('budget', t('script.data.capabilities.label.7aeba4cd15'), t('data.capabilities.string.bb5d8a7a44'), 'summary', 'compact', 'context.budget'),
      section('evidence', t('script.data.capabilities.label.7ea014de7b'), t('data.capabilities.string.096c650438'), 'reader', 'inspect', 'evidence.object'),
      section('history', t('script.data.capabilities.label.90ccd64974'), t('data.capabilities.string.8ee9358bfe'), 'timeline', 'standard', 'context.history'),
    ],
    [
      { label: t('data.capabilities.string.aa472158be'), kind: 'primary', endpoint: '/api/context/current' },
      { label: t('data.capabilities.string.a2379035ca'), kind: 'secondary', endpoint: '/api/evidence/resolve' },
      { label: t('data.capabilities.string.a8c0ddaa0f'), kind: 'secondary', endpoint: '/api/sessions/:id/context/recommendations' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/context/current' },
      { label: t('data.capabilities.string.14363758b0'), value: t('data.capabilities.string.a6991ffc0e') },
      { label: t('data.capabilities.string.3ed7a0b7fa'), value: t('data.capabilities.string.d993f606a1') },
    ],
  ),
  reality: spec(
    'reality',
    t('data.capabilities.string.815dd2fd70'),
    t('data.capabilities.string.8bd5e3af68'),
    [
      section('management', t('capability.section.reality.management.label'), t('capability.section.reality.management.description'), 'governance', 'inspect', 'reality.management'),
      section('core-map', t('data.capabilities.string.0c7f4647ac'), t('data.capabilities.string.5128dbe38c'), 'graph', 'inspect', 'reality.core-map'),
      section('overview', t('script.data.capabilities.label.0efc2e6be4'), t('capability.section.reality.overview.description'), 'summary', 'compact', 'reality.status'),
      section('fact-flow', t('data.capabilities.string.b15d445923'), t('data.capabilities.string.e55ef83e5e'), 'timeline', 'standard', 'fact.flow'),
      section('evidence', t('script.data.capabilities.label.7ea014de7b'), t('capability.section.reality.evidence.description'), 'reader', 'inspect', 'reality.evidence'),
      section('promotions', t('data.capabilities.string.596a9b586c'), t('data.capabilities.string.4d1b8a95fa'), 'governance', 'standard', 'reality.promotion'),
      section('boundaries', t('data.capabilities.string.8a0afbc5db'), t('data.capabilities.string.a9b6df0e38'), 'governance', 'inspect', 'reality.boundary'),
    ],
    [
      { label: t('data.capabilities.string.8f38559b12'), kind: 'primary', endpoint: '/api/reality/status' },
      { label: t('data.capabilities.string.35f81f5ce6'), kind: 'secondary', endpoint: '/api/reality/flow' },
      { label: t('data.capabilities.string.ac4d2f7fad'), kind: 'secondary', endpoint: '/api/reality/promotions' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/reality/*' },
      { label: t('data.capabilities.string.d22fef7e56'), value: t('data.capabilities.string.625d9e46c0') },
      { label: t('script.data.capabilities.label.7f5d63aa39'), value: t('data.capabilities.string.2c79c891e2') },
    ],
  ),
  memory: spec(
    'memory',
    t('data.capabilities.string.79c4671301'),
    t('data.capabilities.string.0045580059'),
    [
      section('layers', t('capability.section.memory.layers.label'), t('capability.section.memory.layers.description'), 'table', 'standard', 'memory.layer'),
      section('recall', t('script.data.capabilities.label.3f7e1fd914'), t('data.capabilities.string.7f710870b6'), 'table', 'standard', 'memory.recall'),
      section('graph', t('capability.section.memory.graph.label'), t('capability.section.memory.graph.description'), 'graph', 'inspect', 'memory.graph'),
      section('maintenance', t('script.data.capabilities.label.94de303bbe'), t('data.capabilities.string.789390ceb0'), 'governance', 'inspect', 'memory.maintenance'),
      section('structured-core', t('capability.section.memory.structuredCore.label'), t('capability.section.memory.structuredCore.description'), 'table', 'standard', 'structured.fact'),
    ],
    [
      { label: t('data.capabilities.string.80db2ffb69'), kind: 'primary', endpoint: '/api/memory/maintenance' },
      { label: t('data.capabilities.string.cba488a977'), kind: 'secondary', endpoint: '/api/memory/facts/check' },
      { label: t('data.capabilities.string.1320df3502'), kind: 'secondary', endpoint: '/api/memory/packet' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/memory/status' },
      { label: t('data.capabilities.string.6866b3d9b6'), value: t('data.capabilities.string.85f8568c11') },
      { label: t('data.capabilities.string.c563b93949'), value: t('data.capabilities.string.c02bfecfe2') },
    ],
  ),
  skills: spec(
    'skills',
    t('data.capabilities.string.f2bfdd4a8a'),
    t('data.capabilities.string.76a7da3a41'),
    [
      section('catalog', t('script.data.capabilities.label.4a88d27bba'), t('data.capabilities.string.c02a893652'), 'table', 'standard', 'skill.catalog'),
      section('projection', t('script.data.capabilities.label.8aa49fe840'), t('data.capabilities.string.70eecba034'), 'detail', 'inspect', 'skill.projection'),
      section('files', t('capability.section.skills.files.label'), t('capability.section.skills.files.description'), 'reader', 'inspect', 'skill.file'),
      section('runs', t('script.data.capabilities.label.fcde5c325d'), t('data.capabilities.string.cad4d40c4b'), 'timeline', 'standard', 'skill.run'),
      section('governance', t('script.data.capabilities.label.823619e079'), t('data.capabilities.string.c02b26ef72'), 'governance', 'inspect', 'skill.governance'),
    ],
    [
      { label: t('data.capabilities.string.9017b30e8c'), kind: 'primary', endpoint: '/api/skills/:id/actions/validate' },
      { label: t('data.capabilities.string.25d00e8b07'), kind: 'secondary', endpoint: '/api/skills/:id/actions/plan' },
      { label: t('data.capabilities.string.af9604b9e7'), kind: 'secondary', endpoint: '/api/skills/:id/actions/run' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/skills/projection' },
      { label: t('script.data.capabilities.label.73fe3c6ca7'), value: t('data.capabilities.string.abbac9e692') },
      { label: t('script.data.capabilities.label.700b401ca5'), value: t('data.capabilities.string.282002ebdd') },
    ],
  ),
  agents: spec(
    'agents',
    t('data.capabilities.string.42fd4be1e4'),
    t('data.capabilities.string.342a481011'),
    [
      section('catalog', t('capability.section.agents.catalog.label'), t('capability.section.agents.catalog.description'), 'table', 'standard', 'agent.catalog'),
      section('discovery', t('capability.section.agents.discovery.label'), t('capability.section.agents.discovery.description'), 'table', 'standard', 'agent.discovery'),
      section('tasks', t('capability.section.agents.tasks.label'), t('capability.section.agents.tasks.description'), 'queue', 'standard', 'agent.task'),
      section('reviews', t('capability.section.agents.reviews.label'), t('capability.section.agents.reviews.description'), 'governance', 'inspect', 'agent.review'),
      section('graph', t('data.capabilities.string.b0dedef95b'), t('data.capabilities.string.4d1e70fa50'), 'graph', 'inspect', 'agent.graph'),
      section('runs', t('capability.section.agents.runs.label'), t('capability.section.agents.runs.description'), 'timeline', 'standard', 'agent.run'),
    ],
    [
      { label: t('data.capabilities.string.ae29b4411f'), kind: 'primary', endpoint: '/api/tasks/:id/agent-graph' },
      { label: t('data.capabilities.string.e042386c4d'), kind: 'secondary', endpoint: '/api/tasks/:id/phases/:phase/review' },
      { label: t('data.capabilities.string.d908be73ae'), kind: 'danger', endpoint: '/api/tasks/:id/cancel' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/agents/runs' },
      { label: t('script.data.capabilities.label.6d525b7156'), value: t('data.capabilities.string.d892f89fee') },
      { label: t('script.data.capabilities.label.4bed336194'), value: t('data.capabilities.string.a7d1e2b5ba') },
    ],
  ),
  tools: spec(
    'tools',
    t('data.capabilities.string.43ff57ec81'),
    t('data.capabilities.string.0a366beec7'),
    [
      { id: 'registry', label: t('script.data.capabilities.label.1fd6a805da'), description: t('data.capabilities.string.43d23a0405') },
      { id: 'operations', label: t('script.data.capabilities.label.a1fdaa6b2a'), description: t('data.capabilities.string.7ad068a11d') },
      { id: 'mutations', label: t('script.data.capabilities.label.00a7fb7314'), description: t('data.capabilities.string.660ab24f9e') },
      { id: 'checkpoints', label: t('script.data.capabilities.label.a2b3a59adb'), description: t('data.capabilities.string.5bb36ae147') },
      { id: 'cache', label: t('script.data.capabilities.label.50338b3b24'), description: t('data.capabilities.string.4418a1f45f') },
      { id: 'ledger', label: t('script.data.capabilities.label.1aa2f31ee7'), description: t('data.capabilities.string.412d9d63f8') },
      { id: 'risk', label: t('script.data.capabilities.label.5a8f23f567'), description: t('data.capabilities.string.d45f28463e') },
    ],
    [
      { label: t('data.capabilities.string.ecb193c987'), kind: 'primary', endpoint: '/api/tools/batch-readonly' },
      { label: t('data.capabilities.string.dee311a134'), kind: 'secondary', endpoint: '/api/tools/mutations/preview' },
      { label: t('data.capabilities.string.6b818aa3ed'), kind: 'secondary', endpoint: '/api/tools/checkpoints' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/tools' },
      { label: t('script.data.capabilities.label.6d525b7156'), value: '/api/tools/execute, /api/tools/batch-readonly' },
      { label: t('script.data.capabilities.label.a2c169fcee'), value: '/api/slash' },
      { label: t('script.data.capabilities.label.db6e7e4104'), value: t('data.capabilities.string.43b1329786') },
    ],
  ),
  surfaces: spec(
    'surfaces',
    t('data.capabilities.string.4417c2dd48'),
    t('data.capabilities.string.3d4aae83ed'),
    [
      section('health', t('script.data.capabilities.label.3703cd2168'), t('data.capabilities.string.058f873288'), 'summary', 'compact', 'surface.health'),
      section('registry', t('script.data.capabilities.label.1fd6a805da'), t('data.capabilities.string.ff271a288a'), 'table', 'standard', 'surface.registry'),
      section('routes', t('script.data.capabilities.label.03730e5840'), t('data.capabilities.string.05942baecd'), 'table', 'standard', 'surface.route'),
      section('dispatch', t('script.data.capabilities.label.840e1b364a'), t('data.capabilities.string.ff04d823f3'), 'form', 'standard', 'surface.dispatch'),
      section('delivery', t('capability.section.surfaces.delivery.label'), t('capability.section.surfaces.delivery.description'), 'queue', 'standard', 'surface.delivery'),
      section('events', t('script.data.capabilities.label.c5497bca58'), t('data.capabilities.string.e0bbab98f3'), 'timeline', 'standard', 'surface.event'),
    ],
    [
      { label: t('data.capabilities.string.f450311e0d'), kind: 'primary', endpoint: '/api/surfaces' },
      { label: t('data.capabilities.string.ed39105d61'), kind: 'secondary', endpoint: '/api/surfaces/:id/health' },
      { label: t('data.capabilities.string.9b21af2f9c'), kind: 'secondary', endpoint: '/api/surfaces/:id/send' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/surfaces' },
      { label: t('script.data.capabilities.label.0a5e7a0583'), value: t('data.capabilities.string.fd098e3408') },
      { label: t('script.data.capabilities.label.c4740e4ca2'), value: t('data.capabilities.string.d85ecd6fcc') },
    ],
  ),
  gateway: spec(
    'gateway',
    t('data.capabilities.string.b472992685'),
    t('data.capabilities.string.63d299d528'),
    [
      section('surfaces', t('script.data.capabilities.label.22b4b0c3c3'), t('data.capabilities.string.495209c2b4'), 'table', 'standard', 'gateway.surface'),
      section('alignment', t('capability.section.gateway.alignment.label'), t('capability.section.gateway.alignment.description'), 'governance', 'inspect', 'gateway.alignment'),
      section('connectors', t('script.data.capabilities.label.4b1e9501b9'), t('data.capabilities.string.a28af0b2ae'), 'table', 'standard', 'gateway.connector'),
      section('message-plane', t('capability.section.gateway.messagePlane.label'), t('capability.section.gateway.messagePlane.description'), 'table', 'inspect', 'gateway.message_plane'),
      section('resources', t('script.data.capabilities.label.87df60de33'), t('data.capabilities.string.c6e170e4d5'), 'table', 'standard', 'gateway.resource'),
      section('executions', t('script.data.capabilities.label.8999e5848a'), t('data.capabilities.string.69f14312f9'), 'timeline', 'standard', 'gateway.execution'),
      section('identities', t('script.data.capabilities.label.42c248d3eb'), t('data.capabilities.string.73c2257e6d'), 'governance', 'inspect', 'gateway.identity'),
    ],
    [
      { label: t('data.capabilities.string.f8507b442a'), kind: 'primary', endpoint: '/api/cross-plane/action/preflight' },
      { label: t('data.capabilities.string.b2111faf63'), kind: 'secondary', endpoint: '/api/cross-plane/identities' },
      { label: t('data.capabilities.string.9fa9978189'), kind: 'secondary', endpoint: '/api/cross-plane/grants' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/cross-plane/summary' },
      { label: t('script.data.capabilities.label.22b4b0c3c3'), value: '/api/surfaces' },
      { label: t('script.data.capabilities.label.4b1e9501b9'), value: '/api/connectors/resources' },
      { label: t('script.data.capabilities.label.823619e079'), value: t('data.capabilities.string.6c8cca8939') },
    ],
  ),
  mfg: spec(
    'mfg',
    t('data.capabilities.string.00e34e2f1e'),
    t('data.capabilities.string.725f332676'),
    [
      section('overview', t('script.data.capabilities.label.0efc2e6be4'), t('capability.section.mfg.overview.description'), 'summary', 'compact', 'mfg.overview'),
      section('data-plane', t('data.capabilities.string.a9464b42dd'), t('data.capabilities.string.f7066a6b27'), 'table', 'standard', 'mfg.data-plane'),
      section('source-pack', t('capability.section.mfg.sourcePack.label'), t('capability.section.mfg.sourcePack.description'), 'form', 'standard', 'mfg.source-pack'),
      section('entities', t('script.data.capabilities.label.f7638a26e8'), t('data.capabilities.string.e485611d89'), 'table', 'standard', 'mfg.entity'),
      section('metrics', t('data.capabilities.string.b362d5551f'), t('data.capabilities.string.e6401ad553'), 'summary', 'standard', 'mfg.metric'),
      section('evidence', t('script.data.capabilities.label.7ea014de7b'), t('capability.section.mfg.evidence.description'), 'reader', 'inspect', 'mfg.evidence'),
      section('incident-room', t('capability.section.mfg.incidentRoom.label'), t('data.capabilities.string.396978b852'), 'queue', 'standard', 'mfg.incident'),
      section('actions', t('capability.section.mfg.actions.label'), t('capability.section.mfg.actions.description'), 'governance', 'inspect', 'mfg.action'),
      section('skills', t('data.capabilities.string.f2bfdd4a8a'), t('capability.section.mfg.skills.description'), 'table', 'standard', 'mfg.skill'),
      section('reports', t('capability.section.mfg.reports.label'), t('capability.section.mfg.reports.description'), 'reader', 'standard', 'mfg.report'),
    ],
    [
      { label: t('data.capabilities.string.668c0630e4'), kind: 'primary', endpoint: '/api/apps/mfg/app' },
      { label: t('data.capabilities.string.9c20a951ff'), kind: 'secondary', endpoint: '/api/apps/mfg/command-center' },
      { label: t('data.capabilities.string.b607489c3b'), kind: 'secondary', endpoint: '/api/apps/mfg/cockpit/profiles/:id/reports/generate' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/apps/mfg/app' },
      { label: t('script.data.capabilities.label.0a5e7a0583'), value: t('data.capabilities.string.05d927676d') },
      { label: t('data.capabilities.string.a7ce4d08d4'), value: t('data.capabilities.string.9f854ba1d8') },
    ],
  ),
  audit: spec(
    'audit',
    t('data.capabilities.string.347f634163'),
    t('data.capabilities.string.686783bcd0'),
    [
      section('global-timeline', t('capability.section.audit.globalTimeline.label'), t('capability.section.audit.globalTimeline.description'), 'timeline', 'standard', 'audit.timeline'),
      section('logs', t('capability.section.audit.logs.label'), t('capability.section.audit.logs.description'), 'table', 'standard', 'audit.log'),
      section('usage', t('data.capabilities.string.4551b60d32'), t('data.capabilities.string.817bcd2f0c'), 'summary', 'compact', 'audit.usage'),
      section('release', t('data.capabilities.string.88d3c7a634'), t('data.capabilities.string.b3498c2b2d'), 'governance', 'inspect', 'release.gate'),
      section('harness-eval', t('capability.section.audit.harnessEval.label'), t('capability.section.audit.harnessEval.description'), 'summary', 'standard', 'harness.eval'),
      section('harness-eval-runs', t('capability.section.audit.harnessEvalRuns.label'), t('capability.section.audit.harnessEvalRuns.description'), 'timeline', 'standard', 'harness.eval.run'),
      section('harness-eval-scenarios', t('capability.section.audit.harnessEvalScenarios.label'), t('capability.section.audit.harnessEvalScenarios.description'), 'table', 'standard', 'harness.eval.scenario'),
      section('approvals', t('capability.section.audit.approvals.label'), t('capability.section.audit.approvals.description'), 'governance', 'inspect', 'approval.audit'),
      section('cross-plane', t('capability.section.audit.crossPlane.label'), t('capability.section.audit.crossPlane.description'), 'table', 'standard', 'cross-plane.audit'),
    ],
    [
      { label: t('data.capabilities.string.251f91fa37'), kind: 'primary', endpoint: '/api/audit/export' },
      { label: t('data.capabilities.string.9e034cdc37'), kind: 'secondary', endpoint: '/api/cowd/release-gate' },
      { label: t('data.capabilities.string.f17425ac0b'), kind: 'secondary', endpoint: '/api/cross-plane/audit' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/audit/export' },
      { label: t('script.data.capabilities.label.823619e079'), value: t('data.capabilities.string.41f91e51b5') },
      { label: t('script.data.capabilities.label.7ea014de7b'), value: t('data.capabilities.string.cca382def1') },
    ],
  ),
  };
}
