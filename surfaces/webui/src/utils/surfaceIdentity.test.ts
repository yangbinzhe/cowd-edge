import { describe, expect, it } from 'vitest';
import { buildLiveSurfaceInstance, isLiveSurfaceInstance, liveTabNonce } from './surfaceIdentity';

describe('surface identity derivation', () => {
  it('builds a stable tab-scoped live surface instance', () => {
    const first = buildLiveSurfaceInstance('webui:observer-a');
    const second = buildLiveSurfaceInstance('webui:observer-a');
    expect(first).toMatch(/^webui:observer-a:tab:/);
    expect(first).toBe(second);
    expect(liveTabNonce()).toBe(liveTabNonce());
  });

  it('keeps writer and live identities distinct', () => {
    const writer = 'webui:observer-a';
    const live = buildLiveSurfaceInstance(writer);
    expect(live).not.toBe(writer);
    expect(isLiveSurfaceInstance(live)).toBe(true);
    expect(isLiveSurfaceInstance(writer)).toBe(false);
  });

  it('produces distinct instances for distinct observers', () => {
    expect(buildLiveSurfaceInstance('webui:a')).not.toBe(buildLiveSurfaceInstance('webui:b'));
  });
});
