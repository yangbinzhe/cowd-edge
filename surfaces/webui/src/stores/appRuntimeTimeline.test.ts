import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useAppStore } from './app';

describe('runtime timeline production store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects typed events into semantic activity while retaining raw evidence', async () => {
    const events = [
      {
        event_id: 'app-1',
        sequence: 1,
        type: 'application.execution_outcome',
        status: 'succeeded',
        payload: { title: 'Quality snapshot', summary: '12 facts synchronized' },
      },
      {
        event_id: 'context-1',
        sequence: 2,
        type: 'context.recommendation_action',
        payload: { action: 'accepted', note: 'needed by the active turn' },
      },
      {
        event_id: 'surface-1',
        sequence: 3,
        type: 'surface.message_received',
        payload: { surface: 'feishu', message_id: 'om-1', content_preview: 'inspect incident' },
      },
      {
        event_id: 'tool-1',
        sequence: 4,
        type: 'tool.invocation.completed',
        status: 'completed',
        payload: {
          tool_call_id: 'call-1',
          tool_name: 'glob_search',
          output_preview: '12 matching files',
        },
      },
    ];
    vi.spyOn(api, 'runtimeTimeline').mockResolvedValue({ events } as any);
    setActivePinia(createPinia());
    const store = useAppStore();
    store.activeSessionId = 'session-semantic';

    await store.loadActivity('session-semantic');

    expect(store.runtimeTimelineRows.map((row) => row.domain)).toEqual([
      'app',
      'context',
      'surface',
      'tool',
    ]);
    expect(store.activity.map((event) => event.title)).toEqual([
      'Quality snapshot',
      'Context recommendation action',
      'feishu · Message received',
      'glob_search completed',
    ]);
    expect(store.activity[3]).toMatchObject({
      id: 'tool-1',
      kind: 'tool',
      detail: '12 matching files',
      event_kind: 'tool.invocation.completed',
      raw: events[3],
    });
    expect(store.activity.map((event) => event.detail).join(' ')).not.toContain('"tool_name"');
  });
});
