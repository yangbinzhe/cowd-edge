import { t } from '../index';

const unitKeys: Record<string, string> = {
  bytes: 'unit.bytes',
  chars: 'unit.chars',
  contracts: 'unit.contracts',
  actions: 'unit.actions',
  candidates: 'unit.candidates',
  checks: 'unit.checks',
  entities: 'unit.entities',
  entries: 'unit.entries',
  events: 'unit.events',
  executions: 'unit.executions',
  graphs: 'unit.graphs',
  identities: 'unit.identities',
  items: 'unit.items',
  lanes: 'unit.lanes',
  leases: 'unit.leases',
  matches: 'unit.matches',
  metrics: 'unit.metrics',
  models: 'unit.models',
  packets: 'unit.packets',
  pending: 'unit.pending',
  phases: 'unit.phases',
  promotions: 'unit.promotions',
  receipts: 'unit.receipts',
  records: 'unit.records',
  refs: 'unit.refs',
  reports: 'unit.reports',
  resources: 'unit.resources',
  routes: 'unit.routes',
  runs: 'unit.runs',
  scenarios: 'unit.scenarios',
  servers: 'unit.servers',
  sources: 'unit.sources',
  skills: 'unit.skills',
  stages: 'unit.stages',
  surfaces: 'unit.surfaces',
  tasks: 'unit.tasks',
  tools: 'unit.tools',
  turns: 'unit.turns',
  vectors: 'unit.vectors',
};

export function formatCount(unit: string, count: number | string): string {
  return `${count} ${t(unitKeys[unit] || `unit.${unit}`)}`;
}

export function formatDateTime(value: unknown): string {
  if (!value) return t('status.unknown');
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
