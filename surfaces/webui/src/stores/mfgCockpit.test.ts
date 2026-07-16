import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMfgCockpitStore } from './mfgCockpit';
import type { MfgCockpitProfile, MfgCockpitProjection, MfgWidgetDefinition } from '../types/mfg';

function profile(): MfgCockpitProfile {
  return {
    profile_id: 'profile-1',
    owner_ref: 'user:test',
    display_name: 'Plant cockpit',
    focus_refs: [],
    focus_metric_ids: [],
    thresholds: null,
    cadence: 'daily',
    revision: 3,
    scope: { kind: 'personal' },
    layout: { columns: 12, row_height: 72, gap: 12 },
    global_filters: {},
    widget_instances: [],
    sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
  };
}

function projection(): MfgCockpitProjection {
  return {
    projection_id: 'projection-1',
    profile: profile(),
    widgets: [
      { widget_id: 'a', instance_id: 'a', definition_id: 'attention.queue', title: 'A', status: 'unavailable', priority_score: 0, data: null, source_refs: [], freshness: null, error: 'temporary' },
      { widget_id: 'b', instance_id: 'b', definition_id: 'quality.gates', title: 'B', status: 'ready', priority_score: 0, data: { count: 2 }, source_refs: [], freshness: null },
    ],
    summary: 'ready',
    generated_at: '2026-07-16T00:00:00Z',
  };
}

describe('MFG cockpit store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('retries one widget without replacing sibling projections', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      kind: 'mfg.cockpit.widget_projection',
      projection: {
        projection_id: 'widget-projection-a',
        profile_id: 'profile-1',
        profile_revision: 3,
        generated_at: '2026-07-16T00:01:00Z',
        widget: { widget_id: 'a', instance_id: 'a', definition_id: 'attention.queue', title: 'A', status: 'ready', priority_score: 0.4, data: { count: 1 }, source_refs: ['matrix:attention:1'], freshness: { status: 'current' } },
      },
    }))));
    vi.stubGlobal('fetch', fetchMock);
    const store = useMfgCockpitStore();
    store.selectedProfileId = 'profile-1';
    store.projection = projection();
    const sibling = store.projection.widgets[1];

    await store.refreshWidget('a');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/apps/mfg/cockpit/profiles/profile-1/widgets/a/projection',
      expect.any(Object),
    );
    expect(store.projection?.widgets[0].status).toBe('ready');
    expect(store.projection?.widgets[1]).toBe(sibling);
    expect(store.widgetRefreshState.a.status).toBe('ready');
  });

  it('places added widgets in the first unoccupied grid area', () => {
    const store = useMfgCockpitStore();
    const definition: MfgWidgetDefinition = {
      definition_id: 'attention.queue',
      title: 'Attention',
      renderer: 'attention',
      renderer_version: 1,
      min_width: 3,
      min_height: 2,
      max_width: 12,
      max_height: 12,
      required_capability: 'mfg.read',
      default_placement: { x: 0, y: 0, width: 6, height: 4 },
    };
    store.catalog = [definition];
    const target = profile();
    target.widget_instances = [{ instance_id: 'existing', definition_id: 'attention.queue', placement: { x: 0, y: 0, width: 6, height: 4 }, visible: true }];

    store.addWidget(target, definition.definition_id);

    expect(target.widget_instances[1].placement).toEqual({ x: 6, y: 0, width: 6, height: 4 });
  });

  it('passes restored URL filters to isolated widget projection requests', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      projection: {
        profile_id: 'profile-1', profile_revision: 3, generated_at: '2026-07-16T00:01:00Z',
        widget: { widget_id: 'a', instance_id: 'a', definition_id: 'attention.queue', title: 'A', status: 'ready', priority_score: 0, data: {}, source_refs: [], freshness: {} },
      },
    }))));
    vi.stubGlobal('fetch', fetchMock);
    const store = useMfgCockpitStore();
    store.selectedProfileId = 'profile-1';
    store.projection = projection();
    store.activeProjectionFilters = { metric: 'metric:output', from: '2026-07-01T00:00:00Z' };

    await store.refreshWidget('a');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/apps/mfg/cockpit/profiles/profile-1/widgets/a/projection?metric=metric%3Aoutput&from=2026-07-01T00%3A00%3A00Z',
      expect.any(Object),
    );
  });

  it('aborts an in-flight widget refresh without degrading sibling state', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal || undefined;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const store = useMfgCockpitStore();
    store.selectedProfileId = 'profile-1';
    store.projection = projection();
    const sibling = store.projection.widgets[1];

    const pending = store.refreshWidget('a');
    expect(store.widgetRefreshState.a.status).toBe('loading');
    store.cancelWidgetRefresh('a');
    await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(store.widgetRefreshState.a.status).toBe('idle');
    expect(store.projection?.widgets[0].status).toBe('unavailable');
    expect(store.projection?.widgets[1]).toBe(sibling);
  });
});
