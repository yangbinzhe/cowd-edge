import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { resetLongLivedConnectionBudgetForTests } from '../utils/longLivedConnectionBudget';
import { useChatSessionsStore } from './chatSessions';
import causalTimelineFixture from '../testFixtures/causal-surface-timeline-v1.json';

vi.mock('./liveTransport', () => ({
  openSessionLiveSource: (sessionId: string) => {
    if (typeof EventSource !== 'undefined') {
      return new EventSource(`/test/live/session/${sessionId}`);
    }
    return { onopen: null, onerror: null, onmessage: null, close() {}, update() {} };
  },
  openLiveSource: (_selector: unknown, callbacks: any) => {
    queueMicrotask(() => callbacks.open?.());
    return { close() {}, update() {} };
  },
}));

function causalFields(itemId: string, segmentKind: string, deltaSequence = 1) {
  return {
    model_step_id: 'model-step-test',
    item_id: itemId,
    segment_id: `${itemId}:${segmentKind}:0`,
    causal_sequence: 1,
    delta_sequence: deltaSequence,
  };
}

function mockEmptySessionReads() {
  vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
    session_id: sessionId,
    messages: [],
    total: 0,
  }) as any);
  vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
    session_id: sessionId,
    active_execution_ids: [],
  }) as any);
  vi.spyOn(api, 'sessionExecutionLive').mockResolvedValue({
    __state: 'not_found',
    execution_id: '',
  } as any);
}

function mockWriterAttachment() {
  vi.spyOn(api, 'attachSession').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'detachSession').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'acquireRuntimeLease').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'releaseRuntimeLease').mockResolvedValue({ ok: true } as any);
}

describe('chatSessions', () => {
  beforeEach(() => {
    vi.spyOn(api, 'sessionHistoryIndex').mockImplementation(async (sessionId) => ({
      schema_version: 1,
      session_id: sessionId,
      projection_generation: 0,
      durable_cursor: 0,
      event_cursor: 0,
      history_revision: 0,
      total_messages: 0,
      total_bytes: 0,
      index_generation: 0,
      index_card_count: 0,
      index_complete: true,
      recovery_state: 'ready',
      recent_metadata: [],
      cards: [],
    }) as any);
    vi.spyOn(api, 'sessionTurnProjection').mockImplementation(async (sessionId) => ({
      kind: 'session.turn_projection',
      session_id: sessionId,
      turn_count: 0,
      turns: [],
    }) as any);
  });

  afterEach(() => {
    resetLongLivedConnectionBudgetForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the latest transcript before execution detail hydration finishes', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    let resolveExecution!: (value: unknown) => void;
    const messages = vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'history-fast',
      messages: [{
        id: 'message-1',
        session_id: 'history-fast',
        sequence: 41,
        role: 'user',
        blocks: [{ type: 'text', text: 'visible before details' }],
      }],
      total: 42,
      offset: 41,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(() => new Promise((resolve) => {
      resolveExecution = resolve;
    }) as any);
    const evidence = vi.spyOn(api, 'sessionEvidence').mockRejectedValue(
      new Error('whole-session evidence must stay off the chat hydration path'),
    );

    await chat.load('history-fast');

    expect(messages).toHaveBeenCalledTimes(1);
    expect(messages).toHaveBeenCalledWith('history-fast', {
      limit: 50,
      tail: true,
    });
    expect(chat.states['history-fast'].turns[0].content).toBe('visible before details');
    expect(chat.states['history-fast'].historyLoading).toBe(false);
    expect(chat.states['history-fast'].detailsLoading).toBe(false);
    expect(evidence).not.toHaveBeenCalled();
    expect(api.sessionExecution).not.toHaveBeenCalled();

    const hydration = chat.hydrateRuntimeDetails('history-fast');
    expect(chat.states['history-fast'].detailsLoading).toBe(true);
    resolveExecution({ session_id: 'history-fast', active_execution_ids: [] });
    await hydration;
    expect(chat.states['history-fast'].detailsLoaded).toBe(true);
    expect(evidence).not.toHaveBeenCalled();
  });

  it('loads the body-free history index before transcript bodies and preserves canonical coverage', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    const historyIndex = vi.mocked(api.sessionHistoryIndex).mockResolvedValue({
      schema_version: 1,
      session_id: 'history-indexed',
      projection_generation: 9,
      durable_cursor: 42,
      event_cursor: 41,
      history_revision: 7,
      total_messages: 100_000,
      total_bytes: 8_000_000,
      latest_checkpoint_event_id: 'event-checkpoint',
      latest_checkpoint_sequence: 90_000,
      index_generation: 4,
      index_card_count: 250,
      index_complete: true,
      indexed_through_sequence: 99_999,
      recovery_state: 'ready',
      recent_metadata: [{
        message_id: 'message-99999',
        sequence: 99_999,
        role: 'assistant',
        created_at_ms: 100,
        content_bytes: 32,
        blocks_count: 1,
      }],
      cards: [{
        card_id: 'card-latest',
        scope: 'session',
        summary: 'bounded navigation summary',
        source_start_sequence: 99_000,
        source_end_sequence: 99_999,
        source_message_count: 1_000,
        source_digest: 'sha256:card',
        generation: 4,
        updated_at_ms: 100,
        authority: 'rebuildable_index',
      }],
    } as any);
    const messages = vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'history-indexed',
      messages: [{
        id: 'message-99999',
        session_id: 'history-indexed',
        sequence: 99_999,
        role: 'assistant',
        blocks: [{ type: 'text', text: 'latest body only' }],
      }],
      total: 100_000,
      offset: 99_999,
    } as any);

    await chat.load('history-indexed');
    await vi.waitFor(() => expect(chat.states['history-indexed'].historyIndexLoaded).toBe(true));

    const state = chat.states['history-indexed'];
    expect(historyIndex.mock.invocationCallOrder[0]).toBeLessThan(messages.mock.invocationCallOrder[0]);
    expect(state.historyIndex).toMatchObject({
      projection_generation: 9,
      total_messages: 100_000,
      index_generation: 4,
      recovery_state: 'ready',
    });
    expect(state.runtimeCommitCursor).toBe(42);
    expect(state.historyTotal).toBe(100_000);
    expect(state.turns).toHaveLength(1);
    expect(JSON.stringify(state.historyIndex)).not.toContain('latest body only');
  });

  it('restores public reasoning summaries without exposing private provider transcript blocks', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'history-reasoning',
      messages: [{
        id: 'message-reasoning',
        session_id: 'history-reasoning',
        sequence: 1,
        role: 'assistant',
        blocks: [
          { type: 'reasoning_summary', text: 'checked durable evidence' },
          { type: 'text', text: 'final answer' },
        ],
      }],
      total: 1,
    } as any);

    await chat.load('history-reasoning');

    const state = chat.states['history-reasoning'];
    expect(state.turns[0].content).toBe('final answer');
    expect(JSON.stringify(state.turns[0].activity)).toContain('checked durable evidence');
    expect(JSON.stringify(state.turns[0])).not.toContain('provider-transcript');
  });

  it('hydrates durable execution history into exactly the canonical user turns', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    const messages = [1, 2, 3].flatMap((number) => ([
      {
        id: `user-${number}`,
        session_id: 'turn-history',
        sequence: (number - 1) * 2,
        role: 'user',
        blocks: [{
          type: 'text',
          text: `request ${number}`,
          cowd_turn_id: `turn-${number}`,
          cowd_turn_ingress_message_id: `user-${number}`,
        }],
      },
      {
        id: `assistant-${number}`,
        session_id: 'turn-history',
        sequence: (number - 1) * 2 + 1,
        role: 'assistant',
        blocks: [{
          type: 'text',
          text: `answer ${number}`,
          cowd_turn_id: `turn-${number}`,
          cowd_turn_ingress_message_id: `user-${number}`,
        }],
      },
    ]));
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'turn-history',
      messages,
      total: messages.length,
    } as any);
    vi.mocked(api.sessionTurnProjection).mockResolvedValue({
      kind: 'session.turn_projection',
      session_id: 'turn-history',
      turn_count: 3,
      turns: [1, 2, 3].map((number) => ({
        turn_id: `turn-${number}`,
        status: 'completed',
        tool_calls: [],
        approvals: [],
        context_events: [],
        usage: [],
        evidence_refs: [],
        event_sequences: [],
        activity_events: [{
          id: `tool-${number}`,
          kind: 'tool',
          title: 'read_file',
          status: 'complete',
          turn_id: `turn-${number}`,
          execution_id: number === 1 ? 'runtime-team:researcher:1' : `root-${number}`,
          parent_execution_id: number === 1 ? 'root-1' : '',
          tool_call_id: `tool-${number}`,
          output: `result ${number}`,
        }],
      })),
    } as any);

    await chat.load('turn-history');
    await chat.hydrateTurnProjection('turn-history');

    const state = chat.states['turn-history'];
    expect(state.turns.filter((turn) => turn.role === 'user')).toHaveLength(3);
    expect(state.turnProjection?.turn_count).toBe(3);
    expect(state.turns.filter((turn) => turn.role === 'assistant').map((turn) => (
      turn.activity?.map((event) => event.tool_call_id)
    ))).toEqual([['tool-1'], ['tool-2'], ['tool-3']]);
    expect(state.turns.some((turn) => turn.turn_id === 'runtime-team:researcher:1')).toBe(false);
  });

  it('keeps concurrent session receipts and turns isolated after out-of-order completion', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const replies = new Map<string, (value: unknown) => void>();
    vi.spyOn(api, 'sendMessage').mockImplementation((sessionId) => new Promise((resolve) => {
      replies.set(sessionId, resolve);
    }) as any);
    vi.spyOn(api, 'executionProjection').mockImplementation(async (executionId) => ({
      execution_id: executionId,
      live: { status: 'queued', revision: 1 },
    }) as any);

    const a = chat.send('session-A', 'message A');
    const b = chat.send('session-B', 'message B');
    await vi.waitFor(() => expect(replies.size).toBe(2));
    expect(chat.states['session-A'].turns.map((turn) => turn.content)).toEqual(['message A', '']);
    expect(chat.states['session-B'].turns.map((turn) => turn.content)).toEqual(['message B', '']);

    replies.get('session-B')?.({ execution: { graph_id: 'execution-B' } });
    await b;
    replies.get('session-A')?.({ execution: { graph_id: 'execution-A' } });
    await a;

    expect(chat.states['session-A'].executionId).toBe('execution-A');
    expect(chat.states['session-B'].executionId).toBe('execution-B');
    expect(chat.states['session-A'].turns[0].content).toBe('message A');
    expect(chat.states['session-B'].turns[0].content).toBe('message B');
  });

  it('reconciles the optimistic user row with the canonical Gateway message identity', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({} as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'execution-1', turn_id: 'turn-1' },
      message: { message_id: 'message-1', sequence: 7, turn_id: 'turn-1' },
    } as any);

    await chat.send('session-1', 'only once');

    const userTurns = chat.states['session-1'].turns.filter((turn) => turn.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]).toMatchObject({
      id: 'message-1',
      content: 'only once',
      sequence: 7,
      execution_id: 'execution-1',
      turn_id: 'turn-1',
    });
  });

  it('batches one session stream without allowing transport resync to alter another session', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; onmessage?: (event: MessageEvent) => void; onopen?: () => void; onerror?: () => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({} as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'execution-stream-A', turn_id: 'turn-stream-A' },
    } as any);

    await chat.open('stream-A');
    await chat.open('stream-B');
    await chat.send('stream-A', 'A');
    const streamA = streams.find((stream) => stream.url.includes('stream-A'));
    const streamB = streams.find((stream) => stream.url.includes('stream-B'));
    const approvalChanged = vi.fn();
    window.addEventListener('cowd:approval-changed', approvalChanged);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ExecutionPhase',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      status: 'preparing_context',
      detail: 'building root context',
    }) } as MessageEvent);
    for (const [itemId, summary] of [
      ['reasoning-a', 'inspect '],
      ['reasoning-b', 'decide'],
    ]) {
      streamA?.onmessage?.({ data: JSON.stringify({
        type: 'ItemStarted',
        ...causalFields(itemId, 'reasoning-summary', 0),
        session_id: 'stream-A',
        execution_id: 'execution-stream-A',
        turn_id: 'turn-stream-A',
        kind: 'public_reasoning',
      }) } as MessageEvent);
      streamA?.onmessage?.({ data: JSON.stringify({
        type: 'ReasoningSummaryDelta',
        ...causalFields(itemId, 'reasoning-summary', 1),
        session_id: 'stream-A',
        execution_id: 'execution-stream-A',
        turn_id: 'turn-stream-A',
        summary,
      }) } as MessageEvent);
      streamA?.onmessage?.({ data: JSON.stringify({
        type: 'ItemCompleted',
        ...causalFields(itemId, 'reasoning-summary', 2),
        session_id: 'stream-A',
        execution_id: 'execution-stream-A',
        turn_id: 'turn-stream-A',
        kind: 'public_reasoning',
      }) } as MessageEvent);
    }
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ItemCompleted',
      ...causalFields('call-read', 'tool-call', 1),
      tool_call_id: 'call-read',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      kind: 'tool_call',
      tool_name: 'read_file',
      tool_input: JSON.stringify({ path: 'README.md' }),
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolStart',
      ...causalFields('call-read', 'tool-execution', 1),
      tool_call_id: 'call-read',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      id: 'call-read',
      name: 'read_file',
      preview: 'README.md',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolComplete',
      ...causalFields('call-read', 'tool-execution', 2),
      tool_call_id: 'call-read',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      id: 'call-read',
      name: 'read_file',
      summary: 'read 42 lines',
      exit_code: 0,
    }) } as MessageEvent);
    const childLineage = {
      session_id: 'stream-A',
      execution_id: 'agent-run-1',
      parent_execution_id: 'execution-stream-A',
      graph_id: 'team-graph-1',
      node_id: 'researcher:1',
      team_id: 'team-run-1',
      agent_id: 'researcher',
      turn_id: 'turn-stream-A',
    };
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'AgentLifecycle',
      ...childLineage,
      run_id: 'agent-run-1',
      role: 'researcher',
      phase: 'started',
      status: 'running',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolStart',
      ...causalFields('call-child-search', 'tool-execution', 1),
      ...childLineage,
      tool_call_id: 'call-child-search',
      id: 'call-child-search',
      name: 'web_search',
      preview: '{"query":"technical standard"}',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolComplete',
      ...causalFields('call-child-search', 'tool-execution', 2),
      ...childLineage,
      tool_call_id: 'call-child-search',
      id: 'call-child-search',
      name: 'web_search',
      summary: 'found 12 sources',
      exit_code: 0,
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'AgentLifecycle',
      ...childLineage,
      run_id: 'agent-run-1',
      role: 'researcher',
      phase: 'completed',
      status: 'completed',
      summary: 'verified research',
    }) } as MessageEvent);
    const teamExecution = {
      session_id: 'stream-A',
      execution_id: 'runtime-team:researcher:2',
      turn_id: 'turn-stream-A',
    };
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ExecutionPhase',
      ...teamExecution,
      status: 'calling_tool',
      detail: 'team researcher is searching',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolStart',
      ...causalFields('call-team-search', 'tool-execution', 1),
      ...teamExecution,
      tool_call_id: 'call-team-search',
      id: 'call-team-search',
      name: 'web_search',
      preview: '{"query":"technical standard team"}',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolComplete',
      ...causalFields('call-team-search', 'tool-execution', 2),
      ...teamExecution,
      tool_call_id: 'call-team-search',
      id: 'call-team-search',
      name: 'web_search',
      summary: 'team result',
      exit_code: 0,
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ToolStart',
      ...causalFields('call-stale-turn', 'tool-execution', 1),
      session_id: 'stream-A',
      execution_id: 'runtime-team:stale',
      turn_id: 'turn-before-stream-A',
      tool_call_id: 'call-stale-turn',
      id: 'call-stale-turn',
      name: 'stale_tool',
      preview: 'must remain isolated',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('child-private-answer', 'text', 1),
      ...childLineage,
      part_id: 'child-private-answer:text:0',
      text: 'child draft must not enter the parent answer',
      start_bytes: 0,
      end_bytes: 42,
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('text-stream-a', 'text', 1),
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      part_id: 'text-stream-a:text:0',
      text: 'one',
      start_bytes: 0,
      end_bytes: 3,
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ApprovalRequested',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      approval_id: 'approval-stream-A',
      action: 'network.external_research',
      summary: 'Allow external research',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'RuntimePolicyDecision',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      status: 'observed',
      summary: { mode: 'balanced', source: 'runtime' },
    }) } as MessageEvent);
    streamB?.onmessage?.({ data: JSON.stringify({ type: 'session_stream_resync', session_id: 'stream-B' }) } as MessageEvent);

    expect(chat.states['stream-A'].turns.find((turn) => turn.id === chat.states['stream-A'].streamTurnId)?.content).toBe('one');
    // Nested Agent phases remain activity facts; only the root execution may
    // move the root status indicator.
    expect(chat.states['stream-A'].live?.status).toBe('preparing_context');
    expect(chat.states['stream-A'].unread).toBe(0);
    expect(chat.states['stream-A'].lastProgressAtMs).toBeGreaterThan(0);
    expect(chat.states['stream-A'].activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'call-read',
        title: 'read_file',
        status: 'complete',
        detail: 'read 42 lines',
        input: { path: 'README.md' },
      }),
      expect.objectContaining({
        id: 'agent-run-1:call-child-search',
        title: 'web_search',
        status: 'complete',
        output: 'found 12 sources',
        parent_execution_id: 'execution-stream-A',
        graph_id: 'team-graph-1',
        node_id: 'researcher:1',
        agent_id: 'researcher',
      }),
      expect.objectContaining({
        id: 'agent:agent-run-1:started',
        kind: 'agent',
        title: 'researcher',
        status: 'running',
        parent_execution_id: 'execution-stream-A',
      }),
      expect.objectContaining({
        id: 'agent:agent-run-1:completed',
        kind: 'agent',
        status: 'completed',
        output: 'verified research',
      }),
      expect.objectContaining({
        id: 'runtime-team:researcher:2:call-team-search',
        title: 'web_search',
        status: 'complete',
        output: 'team result',
        execution_id: 'runtime-team:researcher:2',
        turn_id: 'turn-stream-A',
      }),
      expect.objectContaining({
        id: 'approval:approval-stream-A',
        title: 'network.external_research',
        status: 'pending',
      }),
      expect.objectContaining({
        id: 'policy:execution-stream-A',
        kind: 'runtime',
        title: '运行策略',
      }),
      expect.objectContaining({
        id: 'reasoning-a:reasoning-summary:0',
        detail: 'inspect',
        status: 'complete',
      }),
      expect.objectContaining({
        id: 'reasoning-b:reasoning-summary:0',
        detail: 'decide',
        status: 'complete',
      }),
    ]));
    expect(chat.states['stream-A'].activity).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'stale_tool' }),
    ]));
    expect(approvalChanged).toHaveBeenCalledWith(expect.objectContaining({
      detail: { sessionId: 'stream-A', type: 'ApprovalRequested' },
    }));
    expect(
      chat.states['stream-A'].turns
        .find((turn) => turn.id === chat.states['stream-A'].streamTurnId)
        ?.activity,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'read_file', status: 'complete' }),
    ]));
    expect(chat.states['stream-B'].turns).toEqual([]);
    expect(chat.states['stream-B'].resyncCount).toBe(1);

    chat.close('stream-A');
    chat.close('stream-B');
    window.removeEventListener('cowd:approval-changed', approvalChanged);
  });

  it('projects the canonical cross-Surface causal fixture without serializing parallel tools', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    const streams: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor() { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    mockEmptySessionReads();

    await chat.open(causalTimelineFixture.session_id);
    const stream = streams[0];
    for (const payload of causalTimelineFixture.events) {
      stream?.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    }

    const state = chat.states[causalTimelineFixture.session_id];
    const causalRows = state.activity.filter((event) => event.kind === 'think' || event.kind === 'tool');
    expect(causalRows.map((event) => event.item_id || event.tool_call_id)).toEqual(
      causalTimelineFixture.expected_activity,
    );
    expect(causalRows.find((event) => event.tool_call_id === 'tool-a')).toMatchObject({
      status: 'complete',
      wave: 0,
      lane: 0,
      lane_count: 2,
    });
    expect(causalRows.find((event) => event.tool_call_id === 'tool-b')).toMatchObject({
      status: 'complete',
      wave: 0,
      lane: 1,
      lane_count: 2,
    });
    expect(causalRows.find((event) => event.tool_call_id === 'tool-c')).toMatchObject({
      wave: 1,
      lane: 0,
      lane_count: 1,
    });
    expect(causalRows.find((event) => event.item_id === 'reasoning-1')?.detail)
      .toBe('inspect inputs');
    expect(state.turns.find((turn) => turn.id === state.streamTurnId)?.content).toBe('完成');

    await chat.close(causalTimelineFixture.session_id);
  });

  it('keeps eight logical Session sources live without the former per-topic cap', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    mockEmptySessionReads();

    for (let index = 0; index < 8; index += 1) {
      await chat.open(`budget-${index}`);
    }

    expect(streams).toHaveLength(8);
    expect(chat.activeSourceCount).toBe(8);
    expect(Object.values(chat.states).every((state) => state.streamState === 'connecting')).toBe(true);
    await Promise.all(Array.from({ length: 8 }, (_, index) => chat.close(`budget-${index}`)));
    expect(chat.activeSourceCount).toBe(0);
  });

  it('ignores replayed or unrelated terminals while the current execution is pending', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found', __error: 'pending' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: {
        graph_id: 'execution-current',
        terminal_id: 'turn-terminal:webui:terminal-session:1',
        status: 'accepted_pending_materialization',
      },
    } as any);

    await chat.open('terminal-session');
    await chat.send('terminal-session', 'hello');
    const stream = streams.find((item) => item.url.includes('terminal-session'));
    const historyReadsBeforeReplay = vi.mocked(api.messages).mock.calls.length;
    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', replayed: true, execution_id: 'execution-current',
      session_id: 'terminal-session',
      terminal_id: 'turn-terminal:webui:terminal-session:1',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(true);
    expect(chat.states['terminal-session'].live?.status).toBe('accepted_pending_materialization');
    expect(vi.mocked(api.messages).mock.calls).toHaveLength(historyReadsBeforeReplay);

    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', execution_id: 'execution-other', terminal_id: 'turn-terminal:other',
      session_id: 'terminal-session',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(true);

    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', execution_id: 'execution-current',
      session_id: 'terminal-session',
      terminal_id: 'turn-terminal:webui:terminal-session:1',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(false);
    expect(chat.states['terminal-session'].live?.status).toBe('accepted_pending_materialization');
    chat.close('terminal-session');
  });

  it('routes a second submission into the active Session Input stream without replacing the execution', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found', __error: 'pending' } as any);
    vi.spyOn(api, 'sendMessage')
      .mockResolvedValueOnce({ execution: { graph_id: 'execution-one' } } as any)
      .mockResolvedValueOnce({
        mode: 'attached_to_active_turn',
        execution: { graph_id: 'execution-one' },
        input: {
          input_id: 'supplement-one',
          decision: 'supplement_current_turn',
        },
      } as any);

    expect(await chat.send('single-session', 'first')).toBe(true);
    expect(await chat.send('single-session', 'second')).toBe(true);
    expect(chat.states['single-session'].executionId).toBe('execution-one');
    expect(chat.states['single-session'].pending).toBe(true);
    expect(chat.states['single-session'].activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'supplement-one',
        detail: 'supplement_current_turn',
        status: 'complete',
      }),
    ]));
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('adopts an execution started by another surface and follows it through terminal state', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
      session_id: sessionId, messages: [], total: 0,
    }) as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId,
      active_execution_ids: [],
      latest_execution_id: 'execution-old',
      latest_status: 'complete',
    }) as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);

    await chat.open('cross-surface');
    const stream = streams[0];
    stream.onmessage?.({ data: JSON.stringify({
      type: 'UserMessageCommitted',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      message_id: 'tui:message-1',
      sequence: 4,
      content: 'started in TUI',
    }) } as MessageEvent);
    stream.onmessage?.({ data: JSON.stringify({
      type: 'ExecutionPhase',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      status: 'calling_model',
      detail: 'provider request',
    }) } as MessageEvent);
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('text-cross-surface', 'text', 1),
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      text: 'visible',
      part_id: 'text-cross-surface:text:0',
      start_bytes: 0,
      end_bytes: 7,
      stream_revision: 7,
    }) } as MessageEvent);

    expect(chat.states['cross-surface'].executionId).toBe('execution-new');
    expect(chat.states['cross-surface'].pending).toBe(true);
    expect(chat.states['cross-surface'].live?.status).toBe('calling_model');
    expect(chat.states['cross-surface'].turns.find(
      (turn) => turn.id === chat.states['cross-surface'].streamTurnId,
    )?.content).toBe('visible');

    stream.onmessage?.({ data: JSON.stringify({
      type: 'UserMessageCommitted',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      input_turn_id: 'turn-supplement',
      supplemental: true,
      message_id: 'webui:supplement-1',
      sequence: 5,
      content: 'additional constraint',
    }) } as MessageEvent);

    expect(chat.states['cross-surface'].executionId).toBe('execution-new');
    expect(chat.states['cross-surface'].executionTurnId).toBe('turn-new');
    expect(chat.states['cross-surface'].live?.status).toBe('calling_model');
    expect(chat.states['cross-surface'].turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: 'additional constraint',
        execution_id: 'execution-new',
        turn_id: 'turn-new',
      }),
    ]));
    stream.onmessage?.({ data: JSON.stringify({
      type: 'SessionInputReceived',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      receipt: {
        input_id: 'input-live-1',
        active_turn_id: 'turn-new',
        status: 'pending',
        decision: 'supplement_current_turn',
        evidence_refs: ['session-input://input-live-1'],
      },
    }) } as MessageEvent);
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TurnInputCheckpointConsumed',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      checkpoint: 'after_tool',
      consumed: [{
        input_id: 'input-live-1',
        content_preview: 'additional constraint',
        status: 'consumed',
      }],
    }) } as MessageEvent);
    expect(chat.states['cross-surface'].activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'session-input:input-live-1',
        status: 'complete',
        turn_id: 'turn-new',
        output: { checkpoint: 'after_tool', consumed: true },
      }),
    ]));

    stream.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted',
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      terminal_id: 'terminal-new',
    }) } as MessageEvent);
    expect(chat.states['cross-surface'].pending).toBe(false);
    expect(chat.states['cross-surface'].live?.status).toBe('calling_model');
  });

  it('renders causal turn order while preserving physical message sequences', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
      session_id: sessionId,
      messages: [
        {
          id: 'user-1', session_id: sessionId, sequence: 0, role: 'user',
          blocks: [{ type: 'text', text: 'first', cowd_turn_id: 'turn-1', cowd_turn_ingress_message_id: 'user-1' }],
        },
        {
          id: 'user-2', session_id: sessionId, sequence: 1, role: 'user',
          blocks: [{ type: 'text', text: 'second', cowd_turn_id: 'turn-2', cowd_turn_ingress_message_id: 'user-2' }],
        },
        {
          id: 'assistant-1', session_id: sessionId, sequence: 2, role: 'assistant',
          blocks: [{ type: 'text', text: 'first answer', cowd_turn_id: 'turn-1', cowd_turn_ingress_message_id: 'user-1' }],
        },
      ],
    }) as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId, active_execution_ids: [],
    }) as any);

    await chat.load('causal');
    expect(chat.states.causal.turns.map((turn) => turn.content)).toEqual([
      'first',
      'first answer',
      'second',
    ]);
    expect(chat.states.causal.turns.map((turn) => turn.sequence)).toEqual([0, 2, 1]);
  });

  it('renders structured assistant reports as readable Markdown without losing fields', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'structured-report',
      messages: [{
        id: 'assistant-report',
        session_id: 'structured-report',
        sequence: 1,
        role: 'assistant',
        blocks: [{
          type: 'text',
          text: JSON.stringify({
            objective: 'inspect the runtime',
            summary: 'the execution completed',
            findings: {
              stream: 'connected',
              tools: ['read_file', 'grep_search'],
            },
          }),
        }],
        total: 1,
      }],
      total: 1,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'structured-report',
      active_execution_ids: [],
    } as any);

    const chat = useChatSessionsStore();
    await chat.load('structured-report');
    const content = chat.states['structured-report'].turns[0].content;
    expect(content).not.toMatch(/^\s*\{/);
    expect(content).toContain('**Objective:** inspect the runtime');
    expect(content).toContain('## Findings');
    expect(content).toContain('read_file');
    expect(content).toContain('grep_search');
  });

  it('renders a complete fenced JSON terminal report as readable Markdown', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'fenced-structured-report',
      messages: [{
        id: 'assistant-fenced-report',
        session_id: 'fenced-structured-report',
        sequence: 1,
        role: 'assistant',
        blocks: [{
          type: 'text',
          text: `\`\`\`json
{"summary":"外部研究被策略租约阻断","findings":["WebSearch 未执行"],"unresolved":["需要重新规划"],"risks":["证据不足"],"evidence_receipts":[]}
\`\`\``,
        }],
        total: 1,
      }],
      total: 1,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'fenced-structured-report',
      active_execution_ids: [],
    } as any);

    const chat = useChatSessionsStore();
    await chat.load('fenced-structured-report');
    const content = chat.states['fenced-structured-report'].turns[0].content;
    expect(content).not.toContain('```json');
    expect(content).toContain('**Summary:** 外部研究被策略租约阻断');
    expect(content).toContain('WebSearch 未执行');
    expect(content).toContain('需要重新规划');
  });

  it('renders arbitrary multi-field assistant JSON as readable Markdown', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'provider-report',
      messages: [{
        id: 'assistant-provider-report',
        session_id: 'provider-report',
        sequence: 1,
        role: 'assistant',
        blocks: [{
          type: 'text',
          text: JSON.stringify({
            version: '1.99.0',
            source_title: 'Rust releases',
            source_url: 'https://releases.rs/',
            grounding: 'The release index reports the version.',
            unresolved: ['The official release page was unavailable.'],
            risks: ['Treat the version as provisional.'],
          }),
        }],
        total: 1,
      }],
      total: 1,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'provider-report',
      active_execution_ids: [],
    } as any);

    const chat = useChatSessionsStore();
    await chat.load('provider-report');
    const content = chat.states['provider-report'].turns[0].content;
    expect(content).not.toMatch(/^\s*\{/);
    expect(content).toContain('**Version:** 1.99.0');
    expect(content).toContain('**Source Title:** Rust releases');
    expect(content).toContain('## Unresolved');
    expect(content).toContain('The official release page was unavailable.');
    expect(content).toContain('## Risks');
  });

  it('deduplicates UTF-8 byte-range replay and requests recovery on a gap', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(_url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    mockEmptySessionReads();
    const projectionSpy = vi.spyOn(api, 'executionProjection')
      .mockResolvedValue({ __state: 'not_found' } as any);
    const liveSpy = vi.spyOn(api, 'sessionExecutionLive')
      .mockResolvedValue({ __state: 'not_found', execution_id: '' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'utf8-execution', turn_id: 'utf8-turn' },
    } as any);

    await chat.open('utf8-session');
    await chat.send('utf8-session', 'go');
    vi.mocked(api.messages).mockClear();
    projectionSpy.mockClear();
    const stream = streams[0];
    for (const payload of [
      { text: '你', start_bytes: 0, end_bytes: 3, stream_revision: 3 },
      { text: '你', start_bytes: 0, end_bytes: 3, stream_revision: 3 },
      { text: '好', start_bytes: 3, end_bytes: 6, stream_revision: 6 },
    ]) {
      stream.onmessage?.({ data: JSON.stringify({
        type: 'TextDelta',
        ...causalFields('text-utf8', 'text', Number(payload.stream_revision)),
        session_id: 'utf8-session',
        execution_id: 'utf8-execution',
        turn_id: 'utf8-turn',
        part_id: 'text-utf8:text:0',
        ...payload,
      }) } as MessageEvent);
    }
    expect(chat.states['utf8-session'].turns.find(
      (turn) => turn.id === chat.states['utf8-session'].streamTurnId,
    )?.content).toBe('你好');

    liveSpy.mockResolvedValue({
      schema_version: 2,
      execution_id: 'utf8-execution',
      live: {
        status: 'calling_model',
        revision: 4,
        output_preview: '你好',
        output_preview_start_bytes: 0,
        output_bytes: 6,
        output_parts: [{
          model_step_id: 'step-utf8',
          item_id: 'text-utf8',
          part_id: 'text-utf8:text:0',
          causal_sequence: 1,
          preview: '你好',
          preview_start_bytes: 0,
          bytes: 6,
        }],
      },
    } as any);
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('text-utf8', 'text', 4),
      session_id: 'utf8-session',
      execution_id: 'utf8-execution',
      turn_id: 'utf8-turn',
      part_id: 'text-utf8:text:0',
      text: '断',
      start_bytes: 9,
      end_bytes: 12,
      stream_revision: 12,
    }) } as MessageEvent);
    expect(chat.states['utf8-session'].resyncCount).toBe(1);
    expect(chat.states['utf8-session'].degradedReason).toContain('byte range gap');
    await vi.waitFor(() => expect(chat.states['utf8-session'].streamState).toBe('connected'));
    expect(chat.states['utf8-session'].degradedReason).toBe('');
    expect(chat.states['utf8-session'].lastError).toBe('');
    expect(projectionSpy).not.toHaveBeenCalled();
    expect(api.messages).not.toHaveBeenCalled();
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('text-utf8', 'text', 3),
      session_id: 'utf8-session',
      execution_id: 'utf8-execution',
      turn_id: 'utf8-turn',
      part_id: 'text-utf8:text:0',
      text: '啊',
      start_bytes: 6,
      end_bytes: 9,
      stream_revision: 9,
    }) } as MessageEvent);
    expect(chat.states['utf8-session'].turns.find(
      (turn) => turn.id === chat.states['utf8-session'].streamTurnId,
    )?.content).toBe('你好啊');
  });

  it('retains live tool activity received before the canonical execution receipt', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    mockEmptySessionReads();
    const streams: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(_url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    let resolveSend!: (value: unknown) => void;
    vi.spyOn(api, 'sendMessage').mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }) as any);

    const chat = useChatSessionsStore();
    await chat.open('early-progress');
    const sending = chat.send('early-progress', 'inspect now');
    await vi.waitFor(() => expect(vi.mocked(api.sendMessage)).toHaveBeenCalled());
    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'ToolStart',
      ...causalFields('tool-before-receipt', 'tool', 1),
      session_id: 'early-progress',
      name: 'workspace_read',
      tool_call_id: 'tool-before-receipt',
      input: { path: 'README.md' },
    }) } as MessageEvent);

    resolveSend({
      message: { message_id: 'message-1', sequence: 1, turn_id: 'turn-1' },
      execution: { graph_id: 'execution-1', turn_id: 'turn-1', status: 'running' },
    });
    await sending;

    const state = chat.states['early-progress'];
    const streamTurn = state.turns.find((turn) => turn.id === state.streamTurnId);
    expect(state.executionId).toBe('execution-1');
    expect(streamTurn?.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool-before-receipt',
        title: 'workspace_read',
        status: 'running',
      }),
    ]));
  });

  it('recovers an active turn from the canonical live snapshot when the stream is silent', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    mockWriterAttachment();
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: {
        graph_id: 'silent-execution',
        turn_id: 'silent-turn',
        status: 'calling_model',
      },
    } as any);
    const live = vi.mocked(api.sessionExecutionLive);
    const chat = useChatSessionsStore();

    await chat.open('silent-session');
    await chat.send('silent-session', 'recover me');
    live.mockClear();
    live.mockResolvedValue({
      schema_version: 2,
      execution_id: 'silent-execution',
      live: {
        revision: 4,
        status: 'complete',
        started_at_ms: 1,
        updated_at_ms: 2,
        last_progress_at_ms: 2,
        output_preview: '',
        output_preview_start_bytes: 0,
        output_bytes: 0,
        output_parts: [],
        terminal_ref: 'terminal:silent',
        metrics: {},
      },
    } as any);

    await vi.advanceTimersByTimeAsync(3_100);

    expect(live).toHaveBeenCalledWith('silent-session');
    expect(chat.states['silent-session'].pending).toBe(false);
    await chat.close('silent-session');
  });

  it('keeps ingress lifecycle identity separate from the queryable execution graph', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'dual-identity',
      messages: [],
      total: 0,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'dual-identity',
      executions: [{
        execution_id: 'session-ingress-graph:turn-1',
        graph_id: 'execution-graph:turn-1',
        turn_id: 'turn-1',
        status: 'calling_model',
        updated_at_ms: 2,
      }],
      active_execution_ids: ['session-ingress-graph:turn-1'],
      latest_execution_id: 'session-ingress-graph:turn-1',
      latest_graph_id: 'execution-graph:turn-1',
      latest_status: 'calling_model',
    } as any);
    vi.spyOn(api, 'sessionExecutionLive').mockResolvedValue({
      schema_version: 2,
      execution_id: 'session-ingress-graph:turn-1',
      live: {
        revision: 3,
        status: 'calling_model',
        started_at_ms: 1,
        updated_at_ms: 2,
        last_progress_at_ms: 2,
        output_preview: '',
        output_preview_start_bytes: 0,
        output_bytes: 0,
        metrics: {},
      },
    } as any);
    const projection = vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-graph:turn-1',
      revision: 1,
      cursor: 1,
      graph: {
        graph_id: 'execution-graph:turn-1',
        objective: 'dual identity',
        status: 'running',
        nodes: [],
        edges: [],
      },
    } as any);

    await chat.load('dual-identity');
    await chat.hydrateRuntimeDetails('dual-identity', true);
    expect(projection).toHaveBeenCalled();

    expect(chat.states['dual-identity'].executionId).toBe('session-ingress-graph:turn-1');
    expect(chat.states['dual-identity'].executionGraphId).toBe('execution-graph:turn-1');
    expect(chat.states['dual-identity'].executionIndex?.executions[0].turn_id).toBe('turn-1');
    expect(projection.mock.calls.every(([executionId]) => executionId === 'execution-graph:turn-1')).toBe(true);
  });

  it('hydrates an execution projection when the index has no separate graph id', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'execution-only',
      messages: [],
      total: 0,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'execution-only',
      executions: [{
        execution_id: 'execution-without-graph',
        turn_id: 'turn-without-graph',
        status: 'calling_model',
        updated_at_ms: 2,
      }],
      active_execution_ids: ['execution-without-graph'],
      latest_execution_id: 'execution-without-graph',
      latest_status: 'calling_model',
    } as any);
    vi.spyOn(api, 'sessionExecutionLive').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-without-graph',
      live: {
        revision: 2,
        status: 'calling_model',
        started_at_ms: 1,
        updated_at_ms: 2,
        last_progress_at_ms: 2,
        output_preview: '',
        output_preview_start_bytes: 0,
        output_bytes: 0,
        metrics: {},
      },
    } as any);
    const projection = vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-without-graph',
      revision: 2,
      cursor: 2,
      live: {
        revision: 2,
        status: 'calling_model',
      },
    } as any);

    await chat.load('execution-only');
    await chat.hydrateRuntimeDetails('execution-only', true);

    expect(chat.states['execution-only'].executionId).toBe('execution-without-graph');
    expect(chat.states['execution-only'].executionGraphId).toBe('');
    expect(projection.mock.calls.some(
      ([executionId]) => executionId === 'execution-without-graph',
    )).toBe(true);
  });

  it('merges history and live output by causal identity rather than equal text', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    let durableMessages: any[] = [{
      id: 'assistant-previous',
      sequence: 1,
      role: 'assistant',
      blocks: [{
        type: 'text',
        text: 'same answer',
        cowd_execution_id: 'execution-previous',
        cowd_turn_id: 'turn-previous',
      }],
    }];
    vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
      session_id: sessionId,
      messages: durableMessages.map((message) => ({ ...message, session_id: sessionId })),
    }) as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId,
      active_execution_ids: ['execution-current'],
      latest_execution_id: 'execution-current',
      latest_status: 'calling_model',
      turn_id: 'turn-current',
    }) as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-current',
      revision: 1,
      cursor: 1,
      live: { status: 'calling_model', revision: 1 },
    } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'execution-current', turn_id: 'turn-current' },
    } as any);

    await chat.send('identity-session', 'current objective');
    const live = chat.states['identity-session'].turns.find(
      (turn) => turn.id === chat.states['identity-session'].streamTurnId,
    );
    expect(live?.execution_id).toBe('execution-current');
    if (live) live.content = 'same answer';
    await chat.load('identity-session');
    expect(chat.states['identity-session'].turns.filter(
      (turn) => turn.role === 'assistant' && turn.content === 'same answer',
    )).toHaveLength(2);

    durableMessages = [...durableMessages, {
      id: 'assistant-current',
      sequence: 3,
      role: 'assistant',
      blocks: [{
        type: 'text',
        text: 'same answer fully durable',
        cowd_execution_id: 'execution-current',
        cowd_turn_id: 'turn-current',
      }],
      token_usage: { input_tokens: 20, output_tokens: 4 },
    }];
    await chat.load('identity-session');
    expect(chat.states['identity-session'].turns.filter(
      (turn) => turn.execution_id === 'execution-current' && turn.role === 'assistant',
    )).toHaveLength(1);
    expect(chat.states['identity-session'].turns.find(
      (turn) => turn.id === 'assistant-current',
    )?.token_usage).toEqual({ input_tokens: 20, output_tokens: 4 });
  });

  it('does not recreate a streaming placeholder after the durable final answer exists', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'terminal-dedupe',
      messages: [{
        id: 'assistant-final',
        session_id: 'terminal-dedupe',
        sequence: 3,
        role: 'assistant',
        blocks: [{
          type: 'text',
          text: 'durable answer',
          cowd_execution_id: 'execution-final',
          cowd_turn_id: 'turn-final',
        }],
      }],
      total: 1,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'terminal-dedupe',
      active_execution_ids: [],
      latest_execution_id: 'execution-final',
      latest_status: 'complete',
      turn_id: 'turn-final',
    } as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-final',
      revision: 8,
      cursor: 8,
      live: {
        status: 'complete',
        turn_id: 'turn-final',
        output_preview: 'durable answer',
        output_preview_start_bytes: 0,
        output_bytes: 14,
        output_parts: [{
          model_step_id: 'step-final',
          item_id: 'text-final',
          part_id: 'text-final:text:0',
          causal_sequence: 1,
          completed: true,
          preview: 'durable answer',
          preview_start_bytes: 0,
          bytes: 14,
        }],
      },
    } as any);

    await chat.load('terminal-dedupe');
    await chat.hydrateRuntimeDetails('terminal-dedupe', true);
    await chat.refreshProjection('terminal-dedupe');

    expect(chat.states['terminal-dedupe'].turns.filter(
      (turn) => turn.role === 'assistant' && turn.content === 'durable answer',
    )).toHaveLength(1);
    expect(chat.states['terminal-dedupe'].turns.some(
      (turn) => turn.id === chat.states['terminal-dedupe'].streamTurnId,
    )).toBe(false);
    expect(chat.states['terminal-dedupe'].live?.status).toBe('complete');
  });

  it('keeps provider transcript evidence out of the final answer timeline', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'transcript-final',
      messages: [
        {
          id: 'assistant:turn-1:transcript:0',
          session_id: 'transcript-final',
          sequence: 1,
          role: 'assistant',
          blocks: [{
            type: 'text',
            text: 'premature answer',
            cowd_execution_id: 'execution-1',
            cowd_turn_id: 'turn-1',
          }],
        },
        {
          id: 'assistant:turn-1',
          session_id: 'transcript-final',
          sequence: 3,
          role: 'assistant',
          blocks: [{
            type: 'text',
            text: 'verified final answer',
            cowd_execution_id: 'execution-1',
            cowd_turn_id: 'turn-1',
          }],
        },
      ],
      total: 2,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'transcript-final',
      active_execution_ids: [],
      latest_execution_id: 'execution-1',
      latest_status: 'complete',
      turn_id: 'turn-1',
    } as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      execution_id: 'execution-1',
      revision: 1,
      live: { status: 'complete', turn_id: 'turn-1' },
    } as any);

    await chat.load('transcript-final');

    expect(chat.states['transcript-final'].turns.filter(
      (turn) => turn.role === 'assistant',
    ).map((turn) => turn.content)).toEqual(['verified final answer']);
  });

  it('does not let transcript terminal materialization overwrite canonical error outcome', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(_url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    vi.spyOn(api, 'sendMessage')
      .mockResolvedValueOnce({ execution: { graph_id: 'execution-error-first' } } as any)
      .mockResolvedValueOnce({ execution: { graph_id: 'execution-terminal-first' } } as any);

    await chat.open('error-first');
    await chat.send('error-first', 'fail');
    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'TurnError',
      session_id: 'error-first',
      execution_id: 'execution-error-first',
      error: 'blocked',
    }) } as MessageEvent);
    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted',
      session_id: 'error-first',
      execution_id: 'execution-error-first',
    }) } as MessageEvent);
    expect(chat.states['error-first'].live?.status).toBe('error');

    await chat.open('terminal-first');
    await chat.send('terminal-first', 'fail later');
    streams[1].onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted',
      session_id: 'terminal-first',
      execution_id: 'execution-terminal-first',
    }) } as MessageEvent);
    expect(chat.states['terminal-first'].live?.status).not.toBe('complete');
    streams[1].onmessage?.({ data: JSON.stringify({
      type: 'TurnError',
      session_id: 'terminal-first',
      execution_id: 'execution-terminal-first',
      error: 'canonical blocked',
    }) } as MessageEvent);
    expect(chat.states['terminal-first'].live?.status).toBe('error');
  });

  it('surfaces malformed SSE and invalid delta contracts through canonical resync', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    const streams: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(_url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'execution-contract', turn_id: 'turn-contract' },
    } as any);

    await chat.open('contract-session');
    await chat.send('contract-session', 'go');
    streams[0].onmessage?.({ data: '{broken-json' } as MessageEvent);
    expect(chat.states['contract-session'].resyncCount).toBe(1);
    expect(chat.states['contract-session'].degradedReason).toContain('invalid JSON');

    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      ...causalFields('text-contract', 'text', 1),
      session_id: 'contract-session',
      execution_id: 'execution-contract',
      turn_id: 'turn-contract',
      part_id: 'text-contract:text:0',
      text: 'missing range',
    }) } as MessageEvent);
    expect(chat.states['contract-session'].resyncCount).toBe(2);
    expect(chat.states['contract-session'].degradedReason).toContain('canonical byte range');

    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'TurnError',
      session_id: 'contract-session',
      error: 'missing identity',
    }) } as MessageEvent);
    expect(chat.states['contract-session'].resyncCount).toBe(3);
    expect(chat.states['contract-session'].degradedReason).toContain('canonical execution identity');
  });

  it('releases the exact writer lease before detaching the Surface', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    let finishRelease: (() => void) | undefined;
    vi.spyOn(api, 'attachSession').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'acquireRuntimeLease').mockResolvedValue({ ok: true } as any);
    const release = vi.spyOn(api, 'releaseRuntimeLease').mockImplementation(
      () => new Promise<void>((resolve) => { finishRelease = resolve; }) as any,
    );
    const detach = vi.spyOn(api, 'detachSession').mockResolvedValue({ ok: true } as any);
    mockEmptySessionReads();

    await chat.open('ordered-detach');
    await chat.attachSurface('ordered-detach');
    release.mockClear();
    detach.mockClear();
    const closing = chat.close('ordered-detach');
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('ordered-detach'));
    expect(detach).not.toHaveBeenCalled();
    finishRelease?.();
    await closing;
    expect(detach).toHaveBeenCalledWith('ordered-detach');
    expect(chat.states['ordered-detach'].attachmentRole).toBe('detached');
  });

  it('hydrates the newest durable page and can page backward without losing metadata', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockImplementation(async (sessionId, options = {}) => {
      const limit = Number(options.limit || 100);
      const offset = options.tail
        ? Math.max(0, 205 - limit)
        : Number(options.offset || 0);
      const messages = Array.from(
        { length: Math.min(limit, Math.max(0, 205 - offset)) },
        (_, index) => ({
          id: `message-${offset + index}`,
          session_id: sessionId,
          sequence: offset + index,
          role: (offset + index) % 2 ? 'assistant' : 'user',
          blocks: [{ type: 'text', text: `message ${offset + index}` }],
        }),
      );
      return {
        __state: 'ready',
        session_id: sessionId,
        messages,
        total: 205,
        offset,
        limit,
        has_more: offset + messages.length < 205,
      } as any;
    });
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId, active_execution_ids: [], __state: 'ready',
    }) as any);

    await chat.load('history-window');
    expect(chat.states['history-window'].turns[0].sequence).toBe(155);
    expect(chat.states['history-window'].turns.at(-1)?.sequence).toBe(204);
    expect(chat.states['history-window'].historyHasOlder).toBe(true);
    expect(chat.states['history-window'].historyHasNewer).toBe(false);

    await chat.loadOlder('history-window');
    expect(chat.states['history-window'].turns[0].sequence).toBe(105);
    expect(chat.states['history-window'].historyOldestOffset).toBe(105);
    expect(chat.states['history-window'].historyTotal).toBe(205);
  });

  it('accepts canonical tool messages in durable history', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
      __state: 'ready',
      session_id: sessionId,
      messages: [
        {
          id: 'user-1',
          session_id: sessionId,
          sequence: 0,
          role: 'user',
          blocks: [{ type: 'text', text: 'inspect the workspace' }],
        },
        {
          id: 'tool-1',
          session_id: sessionId,
          sequence: 1,
          role: 'tool',
          tool_name: 'workspace_snapshot',
          blocks: [{
            type: 'tool_result',
            tool_use_id: 'call-1',
            tool_name: 'workspace_snapshot',
            output: 'workspace snapshot loaded',
            is_error: false,
          }],
        },
        {
          id: 'assistant-1',
          session_id: sessionId,
          sequence: 2,
          role: 'assistant',
          blocks: [{ type: 'text', text: 'done' }],
        },
      ],
      total: 3,
      offset: 0,
      limit: 100,
      has_more: false,
    }) as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId, active_execution_ids: [], __state: 'ready',
    }) as any);

    await chat.load('tool-history');

    expect(chat.states['tool-history'].lastError).toBe('');
    expect(chat.states['tool-history'].streamState).not.toBe('degraded');
    expect(chat.states['tool-history'].turns.map((turn) => turn.role)).toEqual([
      'user',
      'tool',
      'assistant',
    ]);
    expect(chat.states['tool-history'].turns[1].content).toBe('workspace snapshot loaded');
  });

  it('keeps history authorization failures visible instead of presenting an empty conversation', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'messages').mockResolvedValue({
      __state: 'forbidden',
      __error: '401 unauthorized',
      session_id: 'forbidden-history',
      messages: [],
      total: 0,
      limit: 1,
      has_more: false,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'forbidden-history', active_execution_ids: [], __state: 'ready',
    } as any);

    await chat.load('forbidden-history');
    expect(chat.states['forbidden-history'].turns).toEqual([]);
    expect(chat.states['forbidden-history'].lastError).toContain('401 unauthorized');
    expect(chat.states['forbidden-history'].streamState).toBe('degraded');
  });

  it('preserves draft and scroll state independently for each session', () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    chat.setDraft('session-a', 'draft A');
    chat.setDraft('session-b', 'draft B');
    chat.setScrollTop('session-a', 120);
    chat.setScrollTop('session-b', 940);

    expect(chat.states['session-a'].draft).toBe('draft A');
    expect(chat.states['session-b'].draft).toBe('draft B');
    expect(chat.states['session-a'].scrollTop).toBe(120);
    expect(chat.states['session-b'].scrollTop).toBe(940);
  });

  it('restores browser drafts independently after the chat store is recreated', () => {
    setActivePinia(createPinia());
    let chat = useChatSessionsStore();
    chat.setDraft('session-a', 'draft A');
    chat.setDraft('session-b', 'draft B');

    setActivePinia(createPinia());
    chat = useChatSessionsStore();
    chat.setScrollTop('session-a', 0);
    chat.setScrollTop('session-b', 0);
    expect(chat.states['session-a'].draft).toBe('draft A');
    expect(chat.states['session-b'].draft).toBe('draft B');

    chat.setDraft('session-a', '');
    setActivePinia(createPinia());
    chat = useChatSessionsStore();
    chat.setScrollTop('session-a', 0);
    chat.setScrollTop('session-b', 0);
    expect(chat.states['session-a'].draft).toBe('');
    expect(chat.states['session-b'].draft).toBe('draft B');
  });

  it('does not create a phantom user turn when writer attachment is rejected', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'attachSession')
      .mockRejectedValueOnce(new Error('writer lease rejected'))
      .mockResolvedValueOnce({ ok: true } as any);
    vi.spyOn(api, 'detachSession').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({} as any);

    expect(await chat.send('read-only', 'must not appear')).toBe(false);
    expect(chat.states['read-only'].turns).toEqual([]);
    expect(chat.states['read-only'].pending).toBe(false);
    expect(chat.states['read-only'].lastError).toContain('writer lease rejected');
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed on session authorization revocation and fences queued callbacks from the old stream', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const streams: Array<{
      url: string;
      closed: boolean;
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      close: () => void;
    }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      closed = false;
      constructor(readonly url: string) { streams.push(this); }
      close() { this.closed = true; }
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    mockEmptySessionReads();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'revoked-execution', turn_id: 'revoked-turn' },
    } as any);
    const chat = useChatSessionsStore();

    await chat.open('revoked-session');
    await chat.send('revoked-session', 'sensitive objective');
    const revoked = streams[0];
    revoked.onmessage?.({ data: JSON.stringify({
      type: 'SessionAuthorizationRevoked',
      session_id: 'revoked-session',
      reason: 'credential_epoch_changed',
    }) } as MessageEvent);

    expect(revoked.closed).toBe(true);
    expect(chat.states['revoked-session'].reconnectBlocked).toBe(true);
    expect(chat.states['revoked-session'].turns).toEqual([]);
    expect(chat.states['revoked-session'].live).toBeNull();
    expect(chat.states['revoked-session'].lastError).toContain('authorization revoked');

    revoked.onmessage?.({ data: JSON.stringify({
      type: 'UserMessageCommitted',
      session_id: 'revoked-session',
      execution_id: 'zombie-execution',
      turn_id: 'zombie-turn',
      message_id: 'zombie-message',
      sequence: 99,
      content: 'must remain hidden',
    }) } as MessageEvent);
    expect(chat.states['revoked-session'].executionId).toBe('');
    expect(chat.states['revoked-session'].turns).toEqual([]);

    await chat.open('revoked-session');
    expect(streams).toHaveLength(1);
    chat.refreshAuthorization();
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    expect(chat.states['revoked-session'].reconnectBlocked).toBe(false);
  });

  it('rejects foreign HTTP and SSE session identities before they mutate state or cursor', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const streams: Array<{
      onmessage?: (event: MessageEvent) => void;
      close: () => void;
    }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(_url: string) { streams.push(this); }
      close() {}
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(api, 'messages').mockResolvedValue({
      session_id: 'session-B',
      messages: [{
        id: 'foreign-message',
        session_id: 'session-B',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'must not render' }],
      }],
      total: 1,
    } as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({
      session_id: 'session-A',
      active_execution_ids: [],
    } as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    const chat = useChatSessionsStore();

    await chat.open('session-A');
    expect(chat.states['session-A'].turns).toEqual([]);
    expect(chat.states['session-A'].lastError).toContain('session identity mismatch');

    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'UserMessageCommitted',
      session_id: 'session-B',
      runtime_commit_cursor: 99,
      execution_id: 'foreign-execution',
      turn_id: 'foreign-turn',
      message_id: 'foreign-ingress',
      content: 'must not render',
    }) } as MessageEvent);

    expect(chat.states['session-A'].executionId).toBe('');
    expect(chat.states['session-A'].runtimeCommitCursor).toBe(0);
    expect(chat.states['session-A'].turns).toEqual([]);
    expect(chat.states['session-A'].resyncCount).toBe(1);
    expect(chat.states['session-A'].degradedReason).toContain('expected session-A, received session-B');
    await chat.close('session-A');
  });

  it.each([
    {
      label: 'message',
      messages: {
        session_id: 'session-A',
        messages: [{
          id: 'foreign-message',
          session_id: 'session-B',
          role: 'assistant',
          blocks: [],
        }],
        total: 1,
      },
      execution: { session_id: 'session-A', active_execution_ids: [] },
    },
    {
      label: 'execution envelope',
      messages: { session_id: 'session-A', messages: [], total: 0 },
      execution: { session_id: 'session-B', active_execution_ids: [] },
    },
  ])('fails closed on a foreign HTTP $label identity', async ({
    messages,
    execution,
  }) => {
    setActivePinia(createPinia());
    vi.spyOn(api, 'messages').mockResolvedValue(messages as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue(execution as any);
    const chat = useChatSessionsStore();

    await chat.load('session-A');
    await chat.hydrateRuntimeDetails('session-A');

    expect(chat.states['session-A'].turns).toEqual([]);
    expect(chat.states['session-A'].streamState).toBe('degraded');
    expect(chat.states['session-A'].lastError).toContain('session identity mismatch');
  });

  it('keeps the logical Session source attached while the physical transport reconnects', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    mockEmptySessionReads();
    const streams: Array<{
      closed: boolean;
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      close: () => void;
    }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      closed = false;
      constructor(_url: string) { streams.push(this); }
      close() { this.closed = true; }
      addEventListener() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const chat = useChatSessionsStore();

    await chat.open('reconnect-session');
    expect(chat.activeSourceCount).toBe(1);
    streams[0].onopen?.();
    streams[0].onerror?.();
    expect(streams[0].closed).toBe(false);
    expect(chat.activeSourceCount).toBe(1);
    expect(chat.states['reconnect-session'].streamState).toBe('reconnecting');

    streams[0].onopen?.();
    expect(streams).toHaveLength(1);
    expect(chat.activeSourceCount).toBe(1);
    expect(chat.states['reconnect-session'].streamState).toBe('connecting');
    streams[0].onmessage?.({ data: JSON.stringify({
      type: 'Connected',
      session_id: 'reconnect-session',
      runtime_commit_cursor: 0,
    }) } as MessageEvent);
    expect(chat.states['reconnect-session'].streamState).toBe('connected');
    await chat.close('reconnect-session');
  });

  it('compensates an in-flight writer attachment that completes after authorization revocation', async () => {
    setActivePinia(createPinia());
    let finishAttach!: (value: unknown) => void;
    vi.spyOn(api, 'attachSession').mockImplementation(() => new Promise((resolve) => {
      finishAttach = resolve;
    }) as any);
    const detach = vi.spyOn(api, 'detachSession').mockResolvedValue({ ok: true } as any);
    const release = vi.spyOn(api, 'releaseRuntimeLease').mockResolvedValue({ ok: true } as any);
    const acquire = vi.spyOn(api, 'acquireRuntimeLease').mockResolvedValue({ ok: true } as any);
    const sendMessage = vi.spyOn(api, 'sendMessage').mockResolvedValue({} as any);
    const chat = useChatSessionsStore();

    const sending = chat.send('revoked-in-flight', 'must never acquire a stale writer');
    await vi.waitFor(() => expect(api.attachSession).toHaveBeenCalledTimes(1));
    chat.failClosedAllSessionAuthorization('credential epoch changed during attach');
    finishAttach({ ok: true });

    expect(await sending).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('revoked-in-flight');
    expect(detach).toHaveBeenCalledWith('revoked-in-flight');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(chat.states['revoked-in-flight'].attachmentRole).toBe('detached');
    expect(chat.states['revoked-in-flight'].writable).toBe(false);
    expect(chat.states['revoked-in-flight'].reconnectBlocked).toBe(true);
  });

  it.each([401, 409, 500])('keeps execution and writer state visible when cancellation returns HTTP %s', async (status) => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const release = vi.spyOn(api, 'releaseRuntimeLease');
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: `cancel-execution-${status}`, turn_id: `cancel-turn-${status}` },
    } as any);
    vi.spyOn(api, 'cancelSessionTurn').mockResolvedValue({
      ok: false,
      status,
      error: 'cancellation rejected',
    } as any);
    const chat = useChatSessionsStore();

    expect(await chat.send(`cancel-${status}`, 'keep running')).toBe(true);
    release.mockClear();
    expect(await chat.stop(`cancel-${status}`)).toBe(false);

    expect(chat.states[`cancel-${status}`].pending).toBe(true);
    expect(chat.states[`cancel-${status}`].writable).toBe(true);
    expect(chat.states[`cancel-${status}`].lastError).toContain(`HTTP ${status}`);
    expect(release).not.toHaveBeenCalled();
  });
});
