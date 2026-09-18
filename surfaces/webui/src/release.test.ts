import { describe, expect, it } from 'vitest';

import { isCompatibleRelease, majorMinor } from './release';

// Neutral sample versions only. These fixtures exercise the compatibility
// function and must not look like a product release number.
describe('release compatibility', () => {
  it('treats patch drift between Edge and Gateway as compatible', () => {
    expect(isCompatibleRelease('3.4.5', '3.4.6')).toBe(true);
    expect(isCompatibleRelease('3.4.6', '3.4.6')).toBe(true);
  });

  it('flags a real major/minor contract mismatch', () => {
    expect(isCompatibleRelease('3.4.6', '4.0.0')).toBe(false);
    expect(isCompatibleRelease('3.4.6', '3.5.0')).toBe(false);
  });

  it('normalizes only the major.minor prefix', () => {
    expect(majorMinor('3.4.6')).toBe('3.4');
    expect(majorMinor('1.2.3')).toBe('1.2');
  });
});
