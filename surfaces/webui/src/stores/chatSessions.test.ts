import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { MAX_ACTIVE_SESSION_STREAMS, useChatSessionsStore } from './chatSessions';

const emptyEvidence = { session_id: '', evidence_refs: [], turns: [], freshness: 'unavailable' };

describe('chatSessions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps concurrent session receipts and turns isolated after out-of-order completion', async () => {
    setActivePinia(createPinia());
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
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; onmessage?: (event: MessageEvent) => void; onopen?: () => void; onerror?: () => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] } as any);
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue(emptyEvidence as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({ active_execution_ids: [] } as any);
    vi.spyOn(api, 'executionProjection').mockResolvedValue({} as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({ execution: { graph_id: 'execution-stream-A' } } as any);

    await chat.open('stream-A');
    await chat.open('stream-B');
    await chat.send('stream-A', 'A');
    const streamA = streams.find((stream) => stream.url.includes('stream-A'));
    const streamB = streams.find((stream) => stream.url.includes('stream-B'));
    streamA?.onmessage?.({ data: JSON.stringify({ type: 'ExecutionPhase', execution_id: 'execution-stream-A', status: 'calling_tool', detail: 'workspace.read' }) } as MessageEvent);
    streamA?.onmessage?.({ data: JSON.stringify({ type: 'TextDelta', execution_id: 'execution-stream-A', text: 'one' }) } as MessageEvent);
    streamB?.onmessage?.({ data: JSON.stringify({ type: 'session_stream_resync', session_id: 'stream-B' }) } as MessageEvent);

    expect(chat.states['stream-A'].turns.find((turn) => turn.id === 'stream:stream-A')?.content).toBe('one');
    expect(chat.states['stream-A'].live?.status).toBe('calling_tool');
    expect(chat.states['stream-A'].unread).toBeGreaterThan(0);
    expect(chat.states['stream-A'].lastProgressAtMs).toBeGreaterThan(0);
    expect(chat.states['stream-B'].turns).toEqual([]);
    expect(chat.states['stream-B'].resyncCount).toBe(1);

    chat.close('stream-A');
    chat.close('stream-B');
  });

  it('degrades excess session observers without evicting active conversations and promotes them after release', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] } as any);
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue(emptyEvidence as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({ active_execution_ids: [] } as any);

    for (let index = 0; index <= MAX_ACTIVE_SESSION_STREAMS; index += 1) {
      await chat.open(`budget-${index}`);
    }

    expect(streams).toHaveLength(MAX_ACTIVE_SESSION_STREAMS);
    expect(chat.states[`budget-${MAX_ACTIVE_SESSION_STREAMS}`].streamState).toBe('degraded');
    expect(chat.states['budget-0'].streamState).toBe('connecting');
    chat.close('budget-0');
    expect(streams).toHaveLength(MAX_ACTIVE_SESSION_STREAMS + 1);
    expect(chat.states[`budget-${MAX_ACTIVE_SESSION_STREAMS}`].streamState).toBe('connecting');
    for (let index = 1; index <= MAX_ACTIVE_SESSION_STREAMS; index += 1) chat.close(`budget-${index}`);
  });

  it('ignores replayed or unrelated terminals while the current execution is pending', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    const streams: Array<{ url: string; onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor(readonly url: string) { streams.push(this); }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] } as any);
    vi.spyOn(api, 'sessionEvidence').mockResolvedValue(emptyEvidence as any);
    vi.spyOn(api, 'sessionExecution').mockResolvedValue({ active_execution_ids: [] } as any);
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
      terminal_id: 'turn-terminal:webui:terminal-session:1',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(true);
    expect(chat.states['terminal-session'].live?.status).toBe('accepted_pending_materialization');

    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', execution_id: 'execution-other', terminal_id: 'turn-terminal:other',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(true);

    stream?.onmessage?.({ data: JSON.stringify({
      type: 'TerminalCommitted', execution_id: 'execution-current',
      terminal_id: 'turn-terminal:webui:terminal-session:1',
    }) } as MessageEvent);
    expect(chat.states['terminal-session'].pending).toBe(false);
    expect(chat.states['terminal-session'].live?.status).toBe('complete');
    chat.close('terminal-session');
  });

  it('does not overwrite a session execution with a second primary submission', async () => {
    setActivePinia(createPinia());
    const chat = useChatSessionsStore();
    vi.spyOn(api, 'executionProjection').mockResolvedValue({ __state: 'not_found', __error: 'pending' } as any);
    vi.spyOn(api, 'sendMessage').mockResolvedValue({ execution: { graph_id: 'execution-one' } } as any);

    expect(await chat.send('single-session', 'first')).toBe(true);
    expect(await chat.send('single-session', 'second')).toBe(false);
    expect(chat.states['single-session'].executionId).toBe('execution-one');
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
