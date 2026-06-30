import { t } from '../index';

export const termKeys = {
  agent: 'term.agent',
  approval: 'term.approval',
  context: 'term.context',
  evidence: 'term.evidence',
  factFlow: 'term.factFlow',
  gateway: 'term.gateway',
  matrix: 'term.matrix',
  memory: 'term.memory',
  missionControl: 'term.missionControl',
  realityCore: 'term.realityCore',
  runtime: 'term.runtime',
  skill: 'term.skill',
  surface: 'term.surface',
  tool: 'term.tool',
} as const;

export function term(key: keyof typeof termKeys): string {
  return t(termKeys[key]);
}
