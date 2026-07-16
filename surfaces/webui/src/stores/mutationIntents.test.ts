import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiWriteError } from '../api/client';
import {
  createMfgMutationIntent,
  mutationIntentSnapshot,
  resetMfgMutationIntents,
  useMutationIntentsStore,
} from './mutationIntents';

describe('MFG mutation intent registry', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetMfgMutationIntents();
    setActivePinia(createPinia());
  });

  it('reuses one idempotency key across timeout retry and records replay terminal', async () => {
    const payload = { profile_id: 'profile-1', owner_ref: '', display_name: 'Plant' };
    const intent = createMfgMutationIntent(
      'mfg.cockpit.profile.create',
      'mfg:cockpit-profile:profile-1',
      payload,
    );
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        profile: payload,
        receipt: { idempotent_replay: true },
        idempotent_replay: true,
      })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.mfgUpsertProfile(payload, intent)).rejects.toThrow('network timeout');
    await api.mfgUpsertProfile(payload, intent);

    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('Idempotency-Key'));
    expect(keys).toEqual([intent.idempotency_key, intent.idempotency_key]);
    expect(mutationIntentSnapshot().find((item) => item.intent_id === intent.intent_id)?.status).toBe('replayed');
  });

  it('keeps high-risk intent recoverable without auto-submitting it', () => {
    const store = useMutationIntentsStore();
    const intent = store.begin(
      'mfg.report.review.abandon',
      'mfg:report-review:review-1',
      { reason: 'irreversible' },
      { expectedRevision: 3, risk: 'high' },
    );

    expect(store.pending).toHaveLength(1);
    expect(intent.status).toBe('draft');
    const persisted = JSON.parse(sessionStorage.getItem('cowd.webui.mfg.mutation-intents.v1') || '[]');
    expect(persisted[0].idempotency_key).toBe(intent.idempotency_key);
    expect(persisted[0].status).toBe('draft');
  });

  it('retains unfinished intent state across Pinia unmount and remount', () => {
    const first = useMutationIntentsStore();
    const intent = first.begin(
      'mfg.report.deliver.commit',
      'mfg:report:report-1',
      { mode: 'commit' },
      { risk: 'high' },
    );

    setActivePinia(createPinia());
    const remounted = useMutationIntentsStore();

    expect(remounted.intents.some((item) => item.intent_id === intent.intent_id)).toBe(true);
    expect(remounted.intents.find((item) => item.intent_id === intent.intent_id)?.status).toBe('draft');
  });

  it('deduplicates an unfinished semantic retry to the original intent key', () => {
    const payload = { assignment_id: 'assignment-1', expected_revision: 4 };
    const first = createMfgMutationIntent(
      'mfg.assignment.update',
      'mfg:assignment:assignment-1',
      payload,
      { expectedRevision: 4 },
    );
    const second = createMfgMutationIntent(
      'mfg.assignment.update',
      'mfg:assignment:assignment-1',
      { expected_revision: 4, assignment_id: 'assignment-1' },
      { expectedRevision: 4 },
    );

    expect(second.intent_id).toBe(first.intent_id);
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  it('parses typed conflict recovery without inferring from strings', async () => {
    const intent = createMfgMutationIntent(
      'mfg.assignment.update',
      'mfg:assignment:assignment-1',
      { expected_revision: 1 },
      { expectedRevision: 1 },
    );
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      code: 'revision_conflict',
      message: 'assignment changed',
      http_status: 409,
      details: { expected_revision: 1, actual_revision: 2 },
      retryable: false,
      recovery_actions: [
        { kind: 'reload', label: 'Reload', enabled: true },
        { kind: 'compare', label: 'Compare', enabled: true },
        { kind: 'save_as', label: 'Save as', enabled: true },
      ],
      request_id: 'request-409',
    }), { status: 409 }))));

    const error = await api.mfgAssignmentCommand(
      'assignment-1',
      { command: 'claim', expected_revision: 1 },
      intent,
    ).catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiWriteError);
    expect(error.code).toBe('revision_conflict');
    expect(error.recoveryActions.map((action: any) => action.kind)).toEqual(['reload', 'compare', 'save_as']);
    expect(error.requestId).toBe('request-409');
  });

  it('marks forbidden terminal and signals entitlement recrop on typed 403', async () => {
    const intent = createMfgMutationIntent(
      'mfg.cockpit.profile.update',
      'mfg:cockpit-profile:profile-1',
      { expected_revision: 2 },
      { expectedRevision: 2 },
    );
    const recrop = vi.fn();
    window.addEventListener('cowd:mfg-entitlement-stale', recrop);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      code: 'mfg_capability_denied',
      message: 'capability denied',
      http_status: 403,
      retryable: false,
      recovery_actions: [{ kind: 'request_access', label: 'Review access', enabled: true }],
      request_id: 'request-403',
    }), { status: 403 }))));

    await expect(api.mfgUpsertProfile({ profile_id: 'profile-1', revision: 2 }, intent))
      .rejects.toBeInstanceOf(ApiWriteError);

    expect(mutationIntentSnapshot().find((item) => item.intent_id === intent.intent_id)?.status)
      .toBe('forbidden');
    expect(recrop).toHaveBeenCalledTimes(1);
    window.removeEventListener('cowd:mfg-entitlement-stale', recrop);
  });
});
