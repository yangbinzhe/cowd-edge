import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useAppStore } from './app';

describe('Session bulk deletion lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses bounded DELETE calls without creating a second cancel path', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.sessions = Array.from({ length: 9 }, (_, index) => ({
      id: `session-${index}`,
      title: `Session ${index}`,
    }));
    store.selectedSessionIds = store.sessions.map((session) => session.id);
    let running = 0;
    let maxRunning = 0;
    vi.spyOn(api, 'deleteSession').mockImplementation(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return { ok: true } as any;
    });
    const cancel = vi.spyOn(api, 'cancelSessionTurn').mockResolvedValue({ ok: true } as any);

    const result = await store.deleteSelectedSessions();

    expect(result.deleted).toBe(9);
    expect(result.failures).toEqual([]);
    expect(store.sessions).toEqual([]);
    expect(store.selectedSessionIds).toEqual([]);
    expect(maxRunning).toBeGreaterThan(1);
    expect(maxRunning).toBeLessThanOrEqual(4);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps failed sessions selected and removes successful sessions once', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.sessions = [
      { id: 'session-ok', title: 'Success' },
      { id: 'session-failed', title: 'Failure' },
    ];
    store.selectedSessionIds = ['session-ok', 'session-failed'];
    vi.spyOn(api, 'deleteSession').mockImplementation(async (sessionId) => {
      if (sessionId === 'session-failed') throw new Error('delete denied');
      return { ok: true } as any;
    });

    const result = await store.deleteSelectedSessions();

    expect(result.deleted).toBe(1);
    expect(result.failures).toEqual([{ id: 'session-failed', error: 'delete denied' }]);
    expect(store.sessions.map((session) => session.id)).toEqual(['session-failed']);
    expect(store.selectedSessionIds).toEqual(['session-failed']);
  });
});
