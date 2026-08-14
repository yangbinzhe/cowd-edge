declare const __COWD_EDGE_VERSION__: string;

export const EDGE_VERSION = typeof __COWD_EDGE_VERSION__ === 'string'
  ? __COWD_EDGE_VERSION__
  : 'unknown';

export function gatewayVersionFrom(manifest: any): string {
  const version = manifest?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
}

export function majorMinor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export function isCompatibleRelease(edge: string, gateway: string): boolean {
  return majorMinor(edge) === majorMinor(gateway);
}

export function releaseProjection(manifest: any) {
  const edge = EDGE_VERSION;
  const gateway = gatewayVersionFrom(manifest);
  const known = edge !== 'unknown' && gateway !== 'unknown';
  // Patch-level drift between the independent Edge and Gateway release
  // cycles is expected and non-breaking; only a major/minor mismatch
  // indicates a real contract incompatibility.
  const mismatch = known && !isCompatibleRelease(edge, gateway);
  return {
    edge,
    gateway,
    mismatch,
    label: edge !== 'unknown' ? edge : gateway,
  };
}
