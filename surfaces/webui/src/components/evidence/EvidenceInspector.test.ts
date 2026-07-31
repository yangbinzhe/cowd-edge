import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import EvidenceInspector from './EvidenceInspector.vue';

describe('EvidenceInspector Session boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves refs only inside the explicitly supplied Session', async () => {
    const resolve = vi.spyOn(api, 'resolveEvidenceBatch').mockResolvedValue({
      kind: 'evidence_batch_projection',
      count: 1,
      items: [{
        ref: 'tool://call-1/evidence/result',
        status: 'resolved',
        evidence: { available: true, kind: 'tool', summary: 'verified output' },
      }],
    } as any);
    const wrapper = mount(EvidenceInspector, {
      props: {
        refs: ['tool://call-1/evidence/result'],
        sessionId: 'session-boundary',
      },
      global: {
        stubs: {
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });

    await flushPromises();

    expect(resolve).toHaveBeenCalledWith(
      ['tool://call-1/evidence/result'],
      'session-boundary',
    );
    expect(wrapper.text()).toContain('verified output');
  });
});
