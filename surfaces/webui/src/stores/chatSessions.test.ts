import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { resetLongLivedConnectionBudgetForTests } from '../utils/longLivedConnectionBudget';
import { useChatSessionsStore } from './chatSessions';

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

const emptyEvidence = { session_id: '', evidence_refs: [], turns: [], freshness: 'unavailable' };

function mockEmptySessionReads() {
  vi.spyOn(api, 'messages').mockImplementation(async (sessionId) => ({
    session_id: sessionId,
    messages: [],
    total: 0,
  }) as any);
  vi.spyOn(api, 'sessionEvidence').mockImplementation(async (sessionId) => ({
    ...emptyEvidence,
    session_id: sessionId,
  }) as any);
  vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
    session_id: sessionId,
    active_execution_ids: [],
  }) as any);
}

function mockWriterAttachment() {
  vi.spyOn(api, 'attachSession').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'detachSession').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'acquireRuntimeLease').mockResolvedValue({ ok: true } as any);
  vi.spyOn(api, 'releaseRuntimeLease').mockResolvedValue({ ok: true } as any);
}

describe('chatSessions', () => {
  afterEach(() => {
    resetLongLivedConnectionBudgetForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'ExecutionPhase',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      status: 'calling_tool',
      detail: 'workspace.read',
    }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      session_id: 'stream-A',
      execution_id: 'execution-stream-A',
      turn_id: 'turn-stream-A',
      part_id: 'assistant_text',
      text: 'one',
      start_bytes: 0,
      end_bytes: 3,
    }) } as MessageEvent);
    streamB?.onmessage?.({ data: JSON.stringify({ type: 'session_stream_resync', session_id: 'stream-B' }) } as MessageEvent);

    expect(chat.states['stream-A'].turns.find((turn) => turn.id === chat.states['stream-A'].streamTurnId)?.content).toBe('one');
    expect(chat.states['stream-A'].live?.status).toBe('calling_tool');
    expect(chat.states['stream-A'].unread).toBe(0);
    expect(chat.states['stream-A'].lastProgressAtMs).toBeGreaterThan(0);
    expect(chat.states['stream-B'].turns).toEqual([]);
    expect(chat.states['stream-B'].resyncCount).toBe(1);

    chat.close('stream-A');
    chat.close('stream-B');
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
    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', replayed: true, execution_id: 'execution-current',
      session_id: 'terminal-session',
      terminal_id: 'turn-terminal:webui:terminal-session:1',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(true);
    expect(chat.states['terminal-session'].live?.status).toBe('accepted_pending_materialization');

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

  it('does not overwrite a session execution with a second primary submission', async () => {
    setActivePinia(createPinia());
    mockWriterAttachment();
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found', __error: 'pending' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({ execution: { graph_id: 'execution-one' } } as any);

    expect(await chat.send('single-session', 'first')).toBe(true);
    expect(await chat.send('single-session', 'second')).toBe(false);
    expect(chat.states['single-session'].executionId).toBe('execution-one');
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
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
    vi.spyOn(api, 'sessionEvidence').mockImplementation(async (sessionId) => ({
      ...emptyEvidence, session_id: sessionId,
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
      session_id: 'cross-surface',
      execution_id: 'execution-new',
      turn_id: 'turn-new',
      text: 'visible',
      part_id: 'assistant_text',
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
    vi.spyOn(api, 'sessionEvidence').mockImplementation(async (sessionId) => ({
      ...emptyEvidence, session_id: sessionId,
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
    vi.spyOn(api, 'sendMessage').mockResolvedValue({
      execution: { graph_id: 'utf8-execution', turn_id: 'utf8-turn' },
    } as any);

    await chat.open('utf8-session');
    await chat.send('utf8-session', 'go');
    const stream = streams[0];
    for (const payload of [
      { text: '你', start_bytes: 0, end_bytes: 3, stream_revision: 3 },
      { text: '你', start_bytes: 0, end_bytes: 3, stream_revision: 3 },
      { text: '好', start_bytes: 3, end_bytes: 6, stream_revision: 6 },
    ]) {
      stream.onmessage?.({ data: JSON.stringify({
        type: 'TextDelta',
        session_id: 'utf8-session',
        execution_id: 'utf8-execution',
        turn_id: 'utf8-turn',
        part_id: 'assistant_text',
        ...payload,
      }) } as MessageEvent);
    }
    expect(chat.states['utf8-session'].turns.find(
      (turn) => turn.id === chat.states['utf8-session'].streamTurnId,
    )?.content).toBe('你好');

    projectionSpy.mockResolvedValue({
      schema_version: 2,
      execution_id: 'utf8-execution',
      revision: 4,
      cursor: 4,
      live: {
        status: 'calling_model',
        revision: 4,
        output_preview: '你好',
        output_preview_start_bytes: 0,
        output_bytes: 6,
      },
    } as any);
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      session_id: 'utf8-session',
      execution_id: 'utf8-execution',
      turn_id: 'utf8-turn',
      part_id: 'assistant_text',
      text: '断',
      start_bytes: 9,
      end_bytes: 12,
      stream_revision: 12,
    }) } as MessageEvent);
    expect(chat.states['utf8-session'].resyncCount).toBe(1);
    expect(chat.states['utf8-session'].degradedReason).toContain('byte range gap');
    await vi.waitFor(() => expect(chat.states['utf8-session'].streamState).toBe('connected'));
    stream.onmessage?.({ data: JSON.stringify({
      type: 'TextDelta',
      session_id: 'utf8-session',
      execution_id: 'utf8-execution',
      turn_id: 'utf8-turn',
      part_id: 'assistant_text',
      text: '啊',
      start_bytes: 6,
      end_bytes: 9,
      stream_revision: 9,
    }) } as MessageEvent);
    expect(chat.states['utf8-session'].turns.find(
      (turn) => turn.id === chat.states['utf8-session'].streamTurnId,
    )?.content).toBe('你好啊');
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
    vi.spyOn(api, 'sessionEvidence').mockImplementation(async (sessionId) => ({
      ...emptyEvidence, session_id: sessionId,
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
      session_id: 'contract-session',
      execution_id: 'execution-contract',
      turn_id: 'turn-contract',
      part_id: 'assistant_text',
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
      const offset = Number(options.offset || 0);
      const limit = Number(options.limit || 100);
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
    vi.spyOn(api, 'sessionEvidence').mockImplementation(async (sessionId) => ({
      ...emptyEvidence, session_id: sessionId, __state: 'ready',
    }) as any);
    vi.spyOn(api, 'sessionExecution').mockImplementation(async (sessionId) => ({
      session_id: sessionId, active_execution_ids: [], __state: 'ready',
    }) as any);

    await chat.load('history-window');
    expect(chat.states['history-window'].turns[0].sequence).toBe(105);
    expect(chat.states['history-window'].turns.at(-1)?.sequence).toBe(204);
    expect(chat.states['history-window'].historyHasOlder).toBe(true);
    expect(chat.states['history-window'].historyHasNewer).toBe(false);

    await chat.loadOlder('history-window');
    expect(chat.states['history-window'].turns[0].sequence).toBe(5);
    expect(chat.states['history-window'].historyOldestOffset).toBe(5);
    expect(chat.states['history-window'].historyTotal).toBe(205);
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
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue({
      ...emptyEvidence, session_id: 'forbidden-history', __state: 'ready',
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
    expect(chat.states['revoked-session'].evidence).toBeNull();
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
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue({
      ...emptyEvidence,
      session_id: 'session-A',
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
      evidence: { ...emptyEvidence, session_id: 'session-A' },
      execution: { session_id: 'session-A', active_execution_ids: [] },
    },
    {
      label: 'evidence envelope',
      messages: { session_id: 'session-A', messages: [], total: 0 },
      evidence: { ...emptyEvidence, session_id: 'session-B' },
      execution: { session_id: 'session-A', active_execution_ids: [] },
    },
    {
      label: 'evidence turn',
      messages: { session_id: 'session-A', messages: [], total: 0 },
      evidence: {
        ...emptyEvidence,
        session_id: 'session-A',
        turns: [{ session_id: 'session-B' }],
      },
      execution: { session_id: 'session-A', active_execution_ids: [] },
    },
    {
      label: 'execution envelope',
      messages: { session_id: 'session-A', messages: [], total: 0 },
      evidence: { ...emptyEvidence, session_id: 'session-A' },
      execution: { session_id: 'session-B', active_execution_ids: [] },
    },
  ])('fails closed on a foreign HTTP $label identity', async ({
    messages,
    evidence,
    execution,
  }) => {
    setActivePinia(createPinia());
    vi.spyOn(api, 'messages').mockResolvedValue(messages as any);
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue(evidence as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue(execution as any);
    const chat = useChatSessionsStore();

    await chat.load('session-A');

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
