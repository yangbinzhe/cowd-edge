declare const __COWD_EDGE_VERSION__: string;

export const EDGE_VERSION = typeof __COWD_EDGE_VERSION__ === 'string'
  ? __COWD_EDGE_VERSION__
  : 'unknown';

export function gatewayVersionFrom(manifest: any): string {
  const version = manifest?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
}

export function releaseProjection(manifest: any) {
  const edge = EDGE_VERSION;
  const gateway = gatewayVersionFrom(manifest);
  const known = edge !== 'unknown' && gateway !== 'unknown';
  return {
    edge,
    gateway,
    mismatch: known && edge !== gateway,
    label: edge !== 'unknown' ? edge : gateway,
  };
}
