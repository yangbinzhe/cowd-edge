import { describe, expect, it } from 'vitest';

import { isCompatibleRelease, majorMinor } from './release';

describe('release compatibility', () => {
  it('treats patch drift between Edge and Gateway as compatible', () => {
    expect(isCompatibleRelease('0.9.680', '0.9.681')).toBe(true);
    expect(isCompatibleRelease('0.9.681', '0.9.681')).toBe(true);
  });

  it('flags a real major/minor contract mismatch', () => {
    expect(isCompatibleRelease('0.9.681', '1.0.0')).toBe(false);
    expect(isCompatibleRelease('0.9.681', '0.10.0')).toBe(false);
  });

  it('normalizes only the major.minor prefix', () => {
    expect(majorMinor('0.9.681')).toBe('0.9');
    expect(majorMinor('1.2.3')).toBe('1.2');
  });
});
