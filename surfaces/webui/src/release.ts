declare const __COWD_EDGE_VERSION__: string;

export const EDGE_VERSION = typeof __COWD_EDGE_VERSION__ === 'string'
  ? __COWD_EDGE_VERSION__
  : 'unknown';

export function gatewayVersionFrom(openApi: any): string {
  const version = openApi?.info?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
}

export function releaseProjection(openApi: any) {
  const edge = EDGE_VERSION;
  const gateway = gatewayVersionFrom(openApi);
  const known = edge !== 'unknown' && gateway !== 'unknown';
  return {
    edge,
    gateway,
    mismatch: known && edge !== gateway,
    label: edge !== 'unknown' ? edge : gateway,
  };
}
