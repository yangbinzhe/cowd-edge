export const APP_CATALOG_SCHEMA_VERSION = 1 as const;
export const APP_PROTOCOL_REVISION = 1 as const;

export const APP_LIFECYCLE_STATES = [
  'mounted',
  'starting',
  'ready',
  'idle',
  'stopping',
  'stopped',
  'failed',
  'invalid',
  'circuit_open',
  'protocol_incompatible',
] as const;

export type AppLifecycleStateV1 = typeof APP_LIFECYCLE_STATES[number];
export type AppActivationPolicyV1 = 'lazy' | 'resident';
export type AppCompatibilityStatusV1 = 'compatible' | 'protocol_incompatible';

export interface AppLifecycleV1 {
  state: AppLifecycleStateV1;
  retryable: boolean;
  reason_code?: string | null;
  retry_after_ms?: number | null;
}

export interface AppCompatibilityV1 {
  status: AppCompatibilityStatusV1;
  gateway_supported_minimum: number;
  gateway_supported_maximum: number;
  app_required_minimum: number;
  app_required_maximum: number;
}

export interface AppWebSurfaceV1 {
  available: boolean;
  bridge_revision: number;
  entry_path?: string | null;
}

export interface AppCatalogEntryV1 {
  app_id: string;
  display_name: string;
  artifact_version: string;
  generation: string;
  required: boolean;
  activation: AppActivationPolicyV1;
  lifecycle: AppLifecycleV1;
  compatibility: AppCompatibilityV1;
  web_surface: AppWebSurfaceV1;
  effective_capabilities: string[];
  effective_authorization_profile: string;
}

export interface AppCatalogV1 {
  schema_version: 1;
  protocol_revision: 1;
  protocol_digest: string;
  catalog_generation: string;
  apps: AppCatalogEntryV1[];
}

export type AppStateTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

export interface AppStateProjection {
  state: AppLifecycleStateV1;
  tone: AppStateTone;
  label: string;
  detail: string;
  workerReady: boolean;
  webSurfaceLoadable: boolean;
  retryable: boolean;
  retryAfterMs: number | null;
}

const catalogKeys = [
  'schema_version', 'protocol_revision', 'protocol_digest', 'catalog_generation', 'apps',
] as const;
const entryKeys = [
  'app_id', 'display_name', 'artifact_version', 'generation', 'required', 'activation',
  'lifecycle', 'compatibility', 'web_surface', 'effective_capabilities',
  'effective_authorization_profile',
] as const;
const lifecycleKeys = ['state', 'retryable', 'reason_code', 'retry_after_ms'] as const;
const compatibilityKeys = [
  'status', 'gateway_supported_minimum', 'gateway_supported_maximum',
  'app_required_minimum', 'app_required_maximum',
] as const;
const webSurfaceKeys = ['available', 'bridge_revision', 'entry_path'] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppCatalogValidationError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
) {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new AppCatalogValidationError(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new AppCatalogValidationError(`${path}.${key}`, 'is required');
    }
  }
}

function stringValue(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new AppCatalogValidationError(path, 'must be a non-empty string');
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AppCatalogValidationError(path, 'must be a boolean');
  return value;
}

function uint16(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 65_535) {
    throw new AppCatalogValidationError(path, 'must be an unsigned 16-bit integer');
  }
  return Number(value);
}

function uint64(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AppCatalogValidationError(path, 'must be a safe unsigned integer');
  }
  return Number(value);
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function nullableUint64(value: unknown, path: string): number | null {
  if (value === null) return null;
  return uint64(value, path);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new AppCatalogValidationError(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
}

function parseLifecycle(value: unknown, path: string): AppLifecycleV1 {
  const input = record(value, path);
  exactKeys(input, lifecycleKeys, ['state', 'retryable'], path);
  return Object.freeze({
    state: enumValue(input.state, APP_LIFECYCLE_STATES, `${path}.state`),
    retryable: booleanValue(input.retryable, `${path}.retryable`),
    ...(Object.prototype.hasOwnProperty.call(input, 'reason_code')
      ? { reason_code: nullableString(input.reason_code, `${path}.reason_code`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'retry_after_ms')
      ? { retry_after_ms: nullableUint64(input.retry_after_ms, `${path}.retry_after_ms`) }
      : {}),
  });
}

function parseCompatibility(value: unknown, path: string): AppCompatibilityV1 {
  const input = record(value, path);
  exactKeys(input, compatibilityKeys, compatibilityKeys, path);
  const parsed = {
    status: enumValue(input.status, ['compatible', 'protocol_incompatible'] as const, `${path}.status`),
    gateway_supported_minimum: uint16(input.gateway_supported_minimum, `${path}.gateway_supported_minimum`),
    gateway_supported_maximum: uint16(input.gateway_supported_maximum, `${path}.gateway_supported_maximum`),
    app_required_minimum: uint16(input.app_required_minimum, `${path}.app_required_minimum`),
    app_required_maximum: uint16(input.app_required_maximum, `${path}.app_required_maximum`),
  };
  if (parsed.gateway_supported_minimum > parsed.gateway_supported_maximum) {
    throw new AppCatalogValidationError(path, 'gateway protocol range is reversed');
  }
  if (parsed.app_required_minimum > parsed.app_required_maximum) {
    throw new AppCatalogValidationError(path, 'APP protocol range is reversed');
  }
  return Object.freeze(parsed);
}

function expectedWebPrefix(appId: string) {
  return `/apps/${encodeURIComponent(appId)}/`;
}

function parseWebSurface(value: unknown, appId: string, path: string): AppWebSurfaceV1 {
  const input = record(value, path);
  exactKeys(input, webSurfaceKeys, ['available', 'bridge_revision'], path);
  const available = booleanValue(input.available, `${path}.available`);
  const entryPath = Object.prototype.hasOwnProperty.call(input, 'entry_path')
    ? nullableString(input.entry_path, `${path}.entry_path`)
    : undefined;
  if (available && !entryPath) {
    throw new AppCatalogValidationError(`${path}.entry_path`, 'is required for an available Web surface');
  }
  if (!available && entryPath !== undefined && entryPath !== null) {
    throw new AppCatalogValidationError(`${path}.entry_path`, 'must be null when the Web surface is unavailable');
  }
  if (entryPath) {
    if (!entryPath.startsWith(expectedWebPrefix(appId)) || entryPath.includes('\\') || entryPath.includes('\0')) {
      throw new AppCatalogValidationError(`${path}.entry_path`, 'must remain inside the APP Web route');
    }
    const resolved = new URL(entryPath, 'http://cowd.invalid');
    if (resolved.origin !== 'http://cowd.invalid' || !resolved.pathname.startsWith(expectedWebPrefix(appId))) {
      throw new AppCatalogValidationError(`${path}.entry_path`, 'must be a same-origin APP path');
    }
  }
  return Object.freeze({
    available,
    bridge_revision: uint16(input.bridge_revision, `${path}.bridge_revision`),
    ...(entryPath !== undefined ? { entry_path: entryPath } : {}),
  });
}

function parseCapabilities(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new AppCatalogValidationError(path, 'must be an array');
  const seen = new Set<string>();
  const capabilities = value.map((item, index) => {
    const capability = stringValue(item, `${path}[${index}]`);
    if (seen.has(capability)) throw new AppCatalogValidationError(path, `duplicates capability ${capability}`);
    seen.add(capability);
    return capability;
  });
  return Object.freeze(capabilities.sort(compareCodePoints)) as unknown as string[];
}

function parseEntry(value: unknown, index: number): AppCatalogEntryV1 {
  const path = `catalog.apps[${index}]`;
  const input = record(value, path);
  exactKeys(input, entryKeys, entryKeys, path);
  const appId = stringValue(input.app_id, `${path}.app_id`);
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(appId)) {
    throw new AppCatalogValidationError(`${path}.app_id`, 'is not a canonical APP identifier');
  }
  return Object.freeze({
    app_id: appId,
    display_name: stringValue(input.display_name, `${path}.display_name`),
    artifact_version: stringValue(input.artifact_version, `${path}.artifact_version`),
    generation: stringValue(input.generation, `${path}.generation`),
    required: booleanValue(input.required, `${path}.required`),
    activation: enumValue(input.activation, ['lazy', 'resident'] as const, `${path}.activation`),
    lifecycle: parseLifecycle(input.lifecycle, `${path}.lifecycle`),
    compatibility: parseCompatibility(input.compatibility, `${path}.compatibility`),
    web_surface: parseWebSurface(input.web_surface, appId, `${path}.web_surface`),
    effective_capabilities: parseCapabilities(input.effective_capabilities, `${path}.effective_capabilities`),
    effective_authorization_profile: stringValue(
      input.effective_authorization_profile,
      `${path}.effective_authorization_profile`,
      true,
    ),
  });
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class AppCatalogValidationError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`${path} ${reason}`);
    this.name = 'AppCatalogValidationError';
  }
}

export function parseAppCatalog(value: unknown, expectedProtocolDigest?: string): AppCatalogV1 {
  const input = record(value, 'catalog');
  exactKeys(input, catalogKeys, catalogKeys, 'catalog');
  const schemaVersion = uint16(input.schema_version, 'catalog.schema_version');
  const protocolRevision = uint16(input.protocol_revision, 'catalog.protocol_revision');
  if (schemaVersion !== APP_CATALOG_SCHEMA_VERSION) {
    throw new AppCatalogValidationError('catalog.schema_version', 'is unsupported');
  }
  if (protocolRevision !== APP_PROTOCOL_REVISION) {
    throw new AppCatalogValidationError('catalog.protocol_revision', 'is unsupported');
  }
  const protocolDigest = stringValue(input.protocol_digest, 'catalog.protocol_digest');
  if (expectedProtocolDigest && protocolDigest !== expectedProtocolDigest) {
    throw new AppCatalogValidationError('catalog.protocol_digest', 'does not match the frozen protocol');
  }
  if (!Array.isArray(input.apps)) throw new AppCatalogValidationError('catalog.apps', 'must be an array');
  const seen = new Set<string>();
  const apps = input.apps.map(parseEntry);
  for (const entry of apps) {
    if (seen.has(entry.app_id)) {
      throw new AppCatalogValidationError('catalog.apps', `duplicates APP ${entry.app_id}`);
    }
    seen.add(entry.app_id);
  }
  apps.sort((left, right) => compareCodePoints(left.app_id, right.app_id));
  return Object.freeze({
    schema_version: APP_CATALOG_SCHEMA_VERSION,
    protocol_revision: APP_PROTOCOL_REVISION,
    protocol_digest: protocolDigest,
    catalog_generation: stringValue(input.catalog_generation, 'catalog.catalog_generation'),
    apps: Object.freeze(apps) as unknown as AppCatalogEntryV1[],
  });
}

export function appCatalogEntry(catalog: AppCatalogV1, appId: string): AppCatalogEntryV1 | null {
  return catalog.apps.find((entry) => entry.app_id === appId) || null;
}

export function projectAppState(entry: AppCatalogEntryV1): AppStateProjection {
  const state = entry.lifecycle.state;
  const compatible = entry.compatibility.status === 'compatible' && state !== 'protocol_incompatible';
  const webSurfaceLoadable = compatible && entry.web_surface.available && Boolean(entry.web_surface.entry_path);
  const projections: Record<AppLifecycleStateV1, Pick<AppStateProjection, 'tone' | 'label' | 'detail' | 'workerReady'>> = {
    mounted: { tone: 'neutral', label: 'Mounted', detail: 'Available on demand.', workerReady: false },
    starting: { tone: 'info', label: 'Starting', detail: 'The application worker is starting.', workerReady: false },
    ready: { tone: 'success', label: 'Ready', detail: 'The application worker is ready.', workerReady: true },
    idle: { tone: 'success', label: 'Idle', detail: 'Mounted and ready for on-demand activation.', workerReady: false },
    stopping: { tone: 'info', label: 'Stopping', detail: 'The application worker is draining.', workerReady: false },
    stopped: { tone: 'neutral', label: 'Stopped', detail: 'Mounted and currently stopped.', workerReady: false },
    failed: { tone: 'danger', label: 'Unavailable', detail: 'The application worker is unavailable.', workerReady: false },
    invalid: { tone: 'danger', label: 'Invalid', detail: 'The installed application bundle was rejected.', workerReady: false },
    circuit_open: { tone: 'warn', label: 'Recovery paused', detail: 'Automatic activation is temporarily paused.', workerReady: false },
    protocol_incompatible: { tone: 'danger', label: 'Incompatible', detail: 'The application protocol is incompatible.', workerReady: false },
  };
  const projection = projections[state];
  return {
    state,
    ...projection,
    webSurfaceLoadable,
    retryable: entry.lifecycle.retryable,
    retryAfterMs: entry.lifecycle.retry_after_ms ?? null,
  };
}
