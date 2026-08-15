import { describe, expect, it, vi } from 'vitest';
import emptyFixture from './fixtures/catalog-empty.json';
import singleFixture from './fixtures/catalog-single.json';
import manyFixture from './fixtures/catalog-many.json';
import duplicateFixture from './fixtures/catalog-duplicate.json';
import malformedFixture from './fixtures/catalog-malformed.json';
import { appCatalogEntry, AppCatalogValidationError, parseAppCatalog, projectAppState } from './catalog';
import { fetchAppCatalog } from '../services/appCatalogClient';

const digest = 'sha256:54030ea4f653de5c1e4ebb4fd5cd236df8e5ea51136dd74f3dcd648beb8ca87d';

describe('APP Catalog v1', () => {
  it('accepts empty, single and many catalogs and makes ordering deterministic', () => {
    expect(parseAppCatalog(emptyFixture, digest).apps).toEqual([]);
    expect(parseAppCatalog(singleFixture, digest).apps[0].app_id).toBe('reference-app');
    const many = parseAppCatalog(manyFixture, digest);
    expect(many.apps.map((entry) => entry.app_id)).toEqual(['alpha-app', 'zeta-app']);
    expect(many.apps[1].effective_capabilities).toEqual(['zeta.read', 'zeta.write']);
    expect(appCatalogEntry(many, 'zeta-app')).toBe(many.apps[1]);
    expect(appCatalogEntry(many, 'missing-app')).toBeNull();
  });

  it('rejects duplicate identities, extra fields, digest drift and route escapes', () => {
    expect(() => parseAppCatalog(duplicateFixture, digest)).toThrow(/duplicates APP same-app/);
    expect(() => parseAppCatalog(malformedFixture, digest)).toThrow(AppCatalogValidationError);
    expect(() => parseAppCatalog(singleFixture, 'sha256:different')).toThrow(/frozen protocol/);
    const escaped = structuredClone(singleFixture);
    escaped.apps[0].web_surface.entry_path = '/apps/reference-app/../foreign/index.html';
    expect(() => parseAppCatalog(escaped, digest)).toThrow(/same-origin APP path/);
  });

  it('projects worker truth independently from a compatible static Web surface', () => {
    const entry = parseAppCatalog(manyFixture, digest).apps[0];
    expect(projectAppState(entry)).toMatchObject({
      state: 'failed', workerReady: false, webSurfaceLoadable: true, retryable: true, retryAfterMs: 5000,
    });
    const incompatible = structuredClone(singleFixture);
    incompatible.apps[0].lifecycle.state = 'protocol_incompatible';
    incompatible.apps[0].compatibility.status = 'protocol_incompatible';
    expect(projectAppState(parseAppCatalog(incompatible).apps[0]).webSurfaceLoadable).toBe(false);
  });

  it('fetches through the same-origin gateway boundary and parses before returning', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(singleFixture), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const catalog = await fetchAppCatalog({ fetchImpl, expectedProtocolDigest: digest });
    expect(catalog.apps[0].app_id).toBe('reference-app');
    expect(fetchImpl).toHaveBeenCalledWith('/api/apps', expect.objectContaining({ credentials: 'same-origin' }));
    await expect(fetchAppCatalog({ endpoint: 'https://foreign.invalid/api/apps', fetchImpl }))
      .rejects.toThrow(/same-origin/);
  });
});
