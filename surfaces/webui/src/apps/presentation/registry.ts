import type { CowdPresentationRendererId, CowdPresentationResultShape } from './types';
export interface CowdPresentationRendererContract { id: CowdPresentationRendererId; version: number; acceptedKind: CowdPresentationResultShape['kind']; mode: 'scalar' | 'chart' | 'table' | 'matrix' | 'graph' | 'timeline' }
const contracts: CowdPresentationRendererContract[] = [
  { id: 'kpi', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'line', version: 1, acceptedKind: 'series', mode: 'chart' },
  { id: 'risk_matrix', version: 1, acceptedKind: 'matrix', mode: 'matrix' },
  { id: 'attention', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'incident', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'workflow', version: 1, acceptedKind: 'timeline', mode: 'timeline' },
  { id: 'graph', version: 1, acceptedKind: 'graph', mode: 'graph' },
  { id: 'quality', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'actions', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'delivery', version: 1, acceptedKind: 'scalar', mode: 'scalar' },
  { id: 'freshness', version: 1, acceptedKind: 'table', mode: 'table' },
  { id: 'focus', version: 1, acceptedKind: 'table', mode: 'table' },
];
const registry = new Map(contracts.map((contract) => [contract.id, contract]));
export function presentationRendererContracts() { return [...contracts] }
export function resolvePresentationRenderer(rendererId: string, rendererVersion: number, result: CowdPresentationResultShape) {
  const contract = registry.get(rendererId as CowdPresentationRendererId);
  return contract && contract.version === rendererVersion && contract.acceptedKind === result.kind ? contract : null;
}
