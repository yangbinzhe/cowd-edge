import { t } from '../i18n';
import type { CapabilitySpec, NavId } from '../types';

type CapabilityId = Exclude<NavId, 'chat' | 'settings'>;

function spec(
  id: CapabilityId,
  title: string,
  subtitle: string,
  sections: Array<{ id: string; label: string; description: string }>,
  actions: Array<{ label: string; kind: 'primary' | 'secondary' | 'danger'; endpoint?: string }>,
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

export function buildCapabilitySpecs(): Record<CapabilityId, CapabilitySpec> {
  return {
  runtime: spec(
    'runtime',
    t('data.capabilities.string.779178eae6'),
    t('data.capabilities.string.004510a45b'),
    [
      { id: 'overview', label: t('script.data.capabilities.label.0efc2e6be4'), description: t('data.capabilities.string.f0a3e31e80') },
      { id: 'runs', label: t('script.data.capabilities.label.fcde5c325d'), description: t('data.capabilities.string.2aa35b8983') },
      { id: 'policy', label: t('script.data.capabilities.label.bb9cf14180'), description: t('data.capabilities.string.2742c73c25') },
      { id: 'timeline', label: t('script.data.capabilities.label.018514a3d5'), description: t('data.capabilities.string.932915f166') },
      { id: 'growth', label: t('script.data.capabilities.label.f3b21e049f'), description: t('data.capabilities.string.bb512225ea') },
    ],
    [
      { label: t('data.capabilities.string.01a9c40568'), kind: 'primary', endpoint: '/api/runtime/timeline' },
      { label: t('data.capabilities.string.75d0c8e680'), kind: 'secondary', endpoint: '/api/runtime/providers/reload' },
      { label: t('data.capabilities.string.3ee57607c7'), kind: 'secondary', endpoint: '/api/runtime/session-leases/acquire' },
    ],
    [
      { label: t('script.data.capabilities.label.d93d10ff0f'), value: '/api/runtime/control-plane' },
      { label: t('script.data.capabilities.label.f3b21e049f'), value: '/api/growth/status, /api/growth/events' },
      { label: t('script.data.capabilities.label.73fe3c6ca7'), value: t('data.capabilities.string.a8cdf07d68') },
      { label: t('script.data.capabilities.label.700b401ca5'), value: t('data.capabilities.string.6ba3689767') },
    ],
  ),
  context: spec(
    'context',
    t('data.capabilities.string.588dc9009b'),
    t('data.capabilities.string.938605f249'),
    [
      { id: 'packet', label: t('data.capabilities.string.75dc3867d8'), description: t('data.capabilities.string.92a93646fd') },
      { id: 'budget', label: t('script.data.capabilities.label.7aeba4cd15'), description: t('data.capabilities.string.bb5d8a7a44') },
      { id: 'evidence', label: t('script.data.capabilities.label.7ea014de7b'), description: t('data.capabilities.string.096c650438') },
      { id: 'history', label: t('script.data.capabilities.label.90ccd64974'), description: t('data.capabilities.string.8ee9358bfe') },
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
      { id: 'core-map', label: t('data.capabilities.string.0c7f4647ac'), description: t('data.capabilities.string.5128dbe38c') },
      { id: 'fact-flow', label: t('data.capabilities.string.b15d445923'), description: t('data.capabilities.string.e55ef83e5e') },
      { id: 'promotions', label: t('data.capabilities.string.596a9b586c'), description: t('data.capabilities.string.4d1b8a95fa') },
      { id: 'boundaries', label: t('data.capabilities.string.8a0afbc5db'), description: t('data.capabilities.string.a9b6df0e38') },
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
      { id: 'recall', label: t('script.data.capabilities.label.3f7e1fd914'), description: t('data.capabilities.string.7f710870b6') },
      { id: 'entities', label: t('script.data.capabilities.label.f7638a26e8'), description: t('data.capabilities.string.ad9ff9e429') },
      { id: 'facts', label: t('script.data.capabilities.label.aeff1bc997'), description: t('data.capabilities.string.21c3cf39d5') },
      { id: 'maintenance', label: t('script.data.capabilities.label.94de303bbe'), description: t('data.capabilities.string.789390ceb0') },
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
      { id: 'catalog', label: t('script.data.capabilities.label.4a88d27bba'), description: t('data.capabilities.string.c02a893652') },
      { id: 'projection', label: t('script.data.capabilities.label.8aa49fe840'), description: t('data.capabilities.string.70eecba034') },
      { id: 'runs', label: t('script.data.capabilities.label.fcde5c325d'), description: t('data.capabilities.string.cad4d40c4b') },
      { id: 'governance', label: t('script.data.capabilities.label.823619e079'), description: t('data.capabilities.string.c02b26ef72') },
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
      { id: 'lanes', label: t('script.data.capabilities.label.f1ba232bf1'), description: t('data.capabilities.string.f51bc8f067') },
      { id: 'graph', label: t('data.capabilities.string.b0dedef95b'), description: t('data.capabilities.string.4d1e70fa50') },
      { id: 'review', label: t('script.data.capabilities.label.e29a79fe0c'), description: t('data.capabilities.string.b02df64509') },
      { id: 'terminal', label: t('data.capabilities.string.abdc3f7a25'), description: t('data.capabilities.string.5191f2cf64') },
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
      { id: 'registry', label: t('script.data.capabilities.label.1fd6a805da'), description: t('data.capabilities.string.ff271a288a') },
      { id: 'health', label: t('script.data.capabilities.label.3703cd2168'), description: t('data.capabilities.string.058f873288') },
      { id: 'routes', label: t('script.data.capabilities.label.03730e5840'), description: t('data.capabilities.string.05942baecd') },
      { id: 'events', label: t('script.data.capabilities.label.c5497bca58'), description: t('data.capabilities.string.e0bbab98f3') },
      { id: 'dispatch', label: t('script.data.capabilities.label.840e1b364a'), description: t('data.capabilities.string.ff04d823f3') },
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
      { id: 'surfaces', label: t('script.data.capabilities.label.22b4b0c3c3'), description: t('data.capabilities.string.495209c2b4') },
      { id: 'connectors', label: t('script.data.capabilities.label.4b1e9501b9'), description: t('data.capabilities.string.a28af0b2ae') },
      { id: 'resources', label: t('script.data.capabilities.label.87df60de33'), description: t('data.capabilities.string.c6e170e4d5') },
      { id: 'identities', label: t('script.data.capabilities.label.42c248d3eb'), description: t('data.capabilities.string.73c2257e6d') },
      { id: 'executions', label: t('script.data.capabilities.label.8999e5848a'), description: t('data.capabilities.string.69f14312f9') },
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
      { id: 'data-plane', label: t('data.capabilities.string.a9464b42dd'), description: t('data.capabilities.string.f7066a6b27') },
      { id: 'entities', label: t('script.data.capabilities.label.f7638a26e8'), description: t('data.capabilities.string.e485611d89') },
      { id: 'metrics', label: t('data.capabilities.string.b362d5551f'), description: t('data.capabilities.string.e6401ad553') },
      { id: 'incidents', label: t('data.capabilities.string.40b58bfceb'), description: t('data.capabilities.string.396978b852') },
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
      { id: 'export', label: t('data.capabilities.string.f958be7f3d'), description: t('data.capabilities.string.4e1d347e86') },
      { id: 'usage', label: t('data.capabilities.string.4551b60d32'), description: t('data.capabilities.string.817bcd2f0c') },
      { id: 'release', label: t('data.capabilities.string.88d3c7a634'), description: t('data.capabilities.string.b3498c2b2d') },
      { id: 'evidence', label: t('script.data.capabilities.label.7ea014de7b'), description: t('data.capabilities.string.86aa14af0e') },
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
