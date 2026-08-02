export type ApiReadClass = 'bootstrap' | 'control' | 'interactive' | 'bulk' | 'unbounded';

export interface ApiReadPolicy {
  class: ApiReadClass;
  deadlineMs: number | null;
}

const POLICIES: Record<ApiReadClass, ApiReadPolicy> = {
  bootstrap: { class: 'bootstrap', deadlineMs: 2_000 },
  control: { class: 'control', deadlineMs: 10_000 },
  interactive: { class: 'interactive', deadlineMs: 30_000 },
  bulk: { class: 'bulk', deadlineMs: 120_000 },
  unbounded: { class: 'unbounded', deadlineMs: null },
};

const BULK_PATH_MARKERS = [
  '/messages',
  '/history',
  '/evidence',
  '/audit',
  '/evaluations',
  '/reports',
  '/memory/scan',
  '/memory/governance',
];

export function inferApiReadClass(path: string): ApiReadClass {
  const pathname = path.split('?', 1)[0];
  if (
    pathname === '/api/health'
    || pathname === '/api/config'
    || pathname === '/api/config/providers'
    || pathname === '/api/config/provider-catalog'
    || pathname === '/api/profiles'
    || pathname === '/api/apps/manifest'
  ) return 'bootstrap';
  if (
    pathname.endsWith('/status')
    || pathname.endsWith('/health')
    || pathname.includes('/control')
    || pathname.includes('/approvals')
  ) return 'control';
  if (BULK_PATH_MARKERS.some((marker) => pathname.includes(marker))) return 'bulk';
  return 'interactive';
}

export function apiReadPolicy(path: string, requested?: ApiReadClass): ApiReadPolicy {
  return POLICIES[requested || inferApiReadClass(path)];
}
