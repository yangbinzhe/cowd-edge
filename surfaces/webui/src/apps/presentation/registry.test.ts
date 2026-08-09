import { describe, expect, it } from 'vitest';
import { presentationRendererContracts, resolvePresentationRenderer } from './registry';
describe('presentation renderer registry', () => {
  it('registers every MFG renderer exactly once', () => {
    const contracts = presentationRendererContracts();
    expect(contracts).toHaveLength(12);
    expect(new Set(contracts.map((contract) => contract.id)).size).toBe(12);
  });
  it('fails closed on a shape or version mismatch', () => {
    const scalar = { kind: 'scalar', content: { value: 1 } } as const;
    expect(resolvePresentationRenderer('delivery', 1, scalar)).not.toBeNull();
    expect(resolvePresentationRenderer('delivery', 2, scalar)).toBeNull();
    expect(resolvePresentationRenderer('line', 1, scalar)).toBeNull();
  });
});
