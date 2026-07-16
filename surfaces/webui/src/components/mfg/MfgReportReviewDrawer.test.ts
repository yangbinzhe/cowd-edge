import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MfgReportReviewDrawer from './MfgReportReviewDrawer.vue';
import { resetMfgMutationIntents } from '../../stores/mutationIntents';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  request: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    mfgReportReviews: mocks.list,
    mfgRequestReportReview: mocks.request,
    mfgDecideReportReview: mocks.decide,
  },
  ApiWriteError: class ApiWriteError extends Error {},
}));

const review = {
  review_id: 'review-1',
  report_id: 'report-1',
  report_revision: 7,
  delivery_revision: 4,
  dead_letter_digest: 'digest',
  requester_principal: 'requester',
  approval_id: 'approval-1',
  correlation_id: 'correlation-1',
  status: 'pending_approval',
  revision: 3,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
};

async function mountDrawer() {
  const wrapper = mount(MfgReportReviewDrawer, {
    props: {
      reportId: 'report-1',
      reportRevision: 7,
      deadLettered: true,
      canReview: true,
    },
  });
  await flushPromises();
  return wrapper;
}

describe('MFG report review drawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    resetMfgMutationIntents();
    mocks.list.mockReset().mockResolvedValue({ items: [review], __state: 'ready' });
    mocks.request.mockReset().mockResolvedValue({ review });
    mocks.decide.mockReset().mockImplementation(async (_id: string, payload: any) => ({
      review: { ...review, decision: payload.decision, status: 'decision_pending_effect' },
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('focuses the typed drawer and requests review with an explicit intent', async () => {
    const wrapper = await mountDrawer();
    await wrapper.get('[data-testid="review-reason"]').setValue('dead letter requires review');
    await wrapper.get('[data-testid="review-evidence"]').setValue('audit:1,evidence:2');
    await wrapper.get('[data-testid="review-request"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('aside').attributes('tabindex')).toBe('-1');
    expect(mocks.request).toHaveBeenCalledWith(
      'report-1',
      {
        expected_report_revision: 7,
        reason: 'dead letter requires review',
        evidence_refs: ['audit:1', 'evidence:2'],
      },
      expect.objectContaining({
        action_id: 'mfg.report.review.request',
        resource_ref: 'mfg:report:report-1',
      }),
    );
  });

  for (const decision of ['force_retry', 'abandon', 'resolve', 'reject'] as const) {
    it(`submits typed ${decision} without generic approval fallback`, async () => {
      const wrapper = await mountDrawer();
      await wrapper.get('[data-testid="review-reason"]').setValue(`${decision} reason`);
      await wrapper.get('[data-testid="review-evidence"]').setValue('evidence:1');
      await wrapper.get('[data-testid="review-decision"]').setValue(decision);
      await wrapper.get('[data-testid="review-submit"]').trigger('click');
      await flushPromises();

      expect(mocks.decide).toHaveBeenCalledWith(
        'review-1',
        expect.objectContaining({
          decision,
          expected_revision: 3,
          reason: `${decision} reason`,
          evidence_refs: ['evidence:1'],
        }),
        expect.objectContaining({
          action_id: `mfg.report.review.${decision}`,
          resource_ref: 'mfg:report-review:review-1',
        }),
      );
    });
  }

  it('requires and sends the complete reroute target contract', async () => {
    const wrapper = await mountDrawer();
    await wrapper.get('[data-testid="review-reason"]').setValue('reroute to backup');
    await wrapper.get('[data-testid="review-decision"]').setValue('reroute');
    await wrapper.get('[data-testid="review-reroute-target"]').setValue('channel://backup');
    await wrapper.get('[data-testid="review-reroute-provider"]').setValue('provider-2');
    await wrapper.get('[data-testid="review-reroute-channel"]').setValue('email');
    await wrapper.get('[data-testid="review-reroute-capability"]').setValue('channel.email.send');
    await wrapper.get('[data-testid="review-submit"]').trigger('click');
    await flushPromises();

    expect(mocks.decide).toHaveBeenCalledWith(
      'review-1',
      expect.objectContaining({
        decision: 'reroute',
        reroute: {
          target_ref: 'channel://backup',
          provider_account: 'provider-2',
          channel: 'email',
          requested_capability: 'channel.email.send',
        },
      }),
      expect.objectContaining({ action_id: 'mfg.report.review.reroute' }),
    );
  });
});
