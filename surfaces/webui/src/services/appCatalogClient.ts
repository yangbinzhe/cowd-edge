import { parseAppCatalog, type AppCatalogV1 } from '../apps/catalog';

export interface AppCatalogClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  expectedProtocolDigest?: string;
  fetchImpl?: typeof fetch;
}

export class AppCatalogRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppCatalogRequestError';
  }
}

export async function fetchAppCatalog(options: AppCatalogClientOptions = {}): Promise<AppCatalogV1> {
  const endpoint = options.endpoint || '/api/apps';
  const resolvedEndpoint = new URL(endpoint, 'http://cowd.invalid');
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('\\')
    || /[\u0000-\u001f]/.test(endpoint) || resolvedEndpoint.origin !== 'http://cowd.invalid') {
    throw new AppCatalogRequestError('APP Catalog endpoint must be a same-origin path', null);
  }
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 2_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/vnd.cowd.app+json;version=1',
        'x-cowd-surface-id': 'webui',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AppCatalogRequestError(`Gateway APP Catalog returned ${response.status}`, response.status);
    }
    const payload = await response.json();
    return parseAppCatalog(payload, options.expectedProtocolDigest);
  } catch (error) {
    if (error instanceof AppCatalogRequestError) throw error;
    const reason = controller.signal.aborted ? 'APP Catalog request timed out' : 'APP Catalog request failed';
    throw new AppCatalogRequestError(reason, null, error);
  } finally {
    clearTimeout(timeout);
  }
}
