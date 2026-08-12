import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useChatSessionsStore } from './chatSessions';
import { useAppStore } from './app';

describe('branchSession lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches the active session to the freshly created branch and reloads messages', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'session-a', title: 'Original' } as any];
    store.activeSessionId = 'session-a';
    const open = vi.spyOn(chat, 'open').mockResolvedValue();
    const branch = vi.spyOn(api, 'branchSession').mockResolvedValue({
      ok: true,
      data: { id: 'session-b', title: 'Original (branch)', parent_session_id: 'session-a' },
    } as any);

    const receipt = await store.branchSession('session-a');

    expect(branch).toHaveBeenCalledWith('session-a');
    expect(receipt.ok).toBe(true);
    expect(store.sessions.map((session) => session.id)).toEqual(['session-b', 'session-a']);
    expect(store.activeSessionId).toBe('session-b');
    expect(open).toHaveBeenCalledWith('session-b');
    expect(store.branchSessionBusy).toBe(false);
  });

  it('keeps the original session active and surfaces the failure in the inspector', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'session-a', title: 'Original' } as any];
    store.activeSessionId = 'session-a';
    const open = vi.spyOn(chat, 'open');
    vi.spyOn(api, 'branchSession').mockResolvedValue({
      ok: false,
      endpoint: '/api/sessions/session-a/branch',
      method: 'POST',
      error: 'branch denied',
    } as any);

    const receipt = await store.branchSession('session-a');

    expect(receipt.ok).toBe(false);
    expect(store.activeSessionId).toBe('session-a');
    expect(open).not.toHaveBeenCalled();
    expect(store.companionTab).toBe('inspector');
    expect(store.selectedActivity).toMatchObject({ ok: false, error: 'branch denied' });
    expect(store.branchSessionBusy).toBe(false);
  });

  it('guards against double clicks with an in-flight lock', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'session-a', title: 'Original' } as any];
    store.activeSessionId = 'session-a';
    vi.spyOn(chat, 'open').mockResolvedValue();
    let release!: () => void;
    const branch = vi.spyOn(api, 'branchSession').mockImplementation(() => (
      new Promise((resolve) => {
        release = () => resolve({ ok: true, data: { id: 'session-b', title: 'Branch' } } as any);
      })
    ));

    const first = store.branchSession('session-a');
    const second = await store.branchSession('session-a');
    release();
    await first;

    expect(branch).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ok: false, error: 'branch already in flight' });
    expect(store.activeSessionId).toBe('session-b');
    expect(store.branchSessionBusy).toBe(false);
  });
});
