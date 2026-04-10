/**
 * Integration tests — full Reply Engine (processReply)
 *
 * Uses lightweight mock implementations of ChannelAdapter and FormStore
 * so tests run without any real channel infrastructure.
 */

import { describe, expect, it, mock } from 'bun:test';
import { processReply } from '../index.js';
import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  ChatSDKMessage,
  CaptureMode,
  FormStore,
  ReplyContext,
} from '../../types/index.js';
import { TimeoutError } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type CallRecord = { method: string; args: unknown[] };

/** Creates a mock ChannelAdapter that records every call. */
function makeMockAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter & {
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];

  const defaultResponse: A2HResponse = {
    intent: 'AUTHORIZE',
    response: { approved: true },
    respondedAt: new Date(),
    respondedBy: 'user_001',
  };

  return {
    calls,
    renderChatSDK: mock(async (_msg: ChatSDKMessage, _ctx: ReplyContext) => {
      calls.push({ method: 'renderChatSDK', args: [_msg, _ctx] });
    }),
    renderA2HInline: mock(
      async (msg: A2HMessage, _ctx: ReplyContext): Promise<A2HResponse> => {
        calls.push({ method: 'renderA2HInline', args: [msg, _ctx] });
        return { ...defaultResponse, intent: msg.intent };
      },
    ),
    captureResponse: mock(
      async (
        msg: A2HMessage,
        mode: CaptureMode,
        _ctx: ReplyContext,
      ): Promise<A2HResponse | null> => {
        calls.push({ method: 'captureResponse', args: [msg, mode, _ctx] });
        return {
          intent: msg.intent,
          response: 'captured text',
          respondedAt: new Date(),
        };
      },
    ),
    sendMessage: mock(async (text: string, _ctx: ReplyContext) => {
      calls.push({ method: 'sendMessage', args: [text, _ctx] });
    }),
    sendFormLink: mock(
      async (formUrl: string, intents: A2HMessage[], _ctx: ReplyContext) => {
        calls.push({ method: 'sendFormLink', args: [formUrl, intents, _ctx] });
      },
    ),
    handleEscalation: mock(async (msg: A2HMessage, _ctx: ReplyContext) => {
      calls.push({ method: 'handleEscalation', args: [msg, _ctx] });
    }),
    getCapabilities: mock(() => ({
      supportsButtons: true,
      supportsSelectMenus: true,
      hasNativeThreads: true,
      hasReplyMessages: true,
    })),
    ...overrides,
  };
}

/** Creates a mock FormStore. */
function makeMockFormStore(
  formResult: Record<string, unknown> = { approved: true },
): FormStore {
  return {
    createForm: mock(
      async (turnId: string, _intents: A2HMessage[]): Promise<string> => {
        return `https://openthreads.example/form/${turnId}`;
      },
    ),
    waitForSubmit: mock(
      async (_url: string, _timeout: number): Promise<Record<string, unknown>> => {
        return formResult;
      },
    ),
  };
}

function makeContext(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return {
    channelId: 'C001',
    isDM: false,
    turnId: 'ot_turn_test',
    capabilities: {
      supportsButtons: true,
      supportsSelectMenus: true,
      hasNativeThreads: true,
      hasReplyMessages: true,
    },
    trustLayerActive: false,
    formBaseUrl: 'https://openthreads.example/form',
    responseTimeoutMs: 5_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chat SDK — single text message
// ---------------------------------------------------------------------------

describe('processReply — single Chat SDK message', () => {
  it('renders via renderChatSDK and returns no responses', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply({ text: 'Deploy complete.' }, ctx, adapter, formStore);

    expect(result.chatSDKCount).toBe(1);
    expect(result.a2hCount).toBe(0);
    expect(result.responses).toEqual([null]);
    expect(adapter.calls.filter((c) => c.method === 'renderChatSDK')).toHaveLength(1);
  });

  it('handles an array of Chat SDK messages', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      [{ text: 'First.' }, { text: 'Second.' }],
      ctx,
      adapter,
      formStore,
    );

    expect(result.chatSDKCount).toBe(2);
    expect(result.a2hCount).toBe(0);
    expect(result.responses).toEqual([null, null]);
    expect(adapter.calls.filter((c) => c.method === 'renderChatSDK')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AUTHORIZE — method 1 (inline)
// ---------------------------------------------------------------------------

describe('processReply — AUTHORIZE via method 1', () => {
  it('calls renderA2HInline and returns the response', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      { intent: 'AUTHORIZE', context: { action: 'deploy' } },
      ctx,
      adapter,
      formStore,
    );

    expect(result.a2hCount).toBe(1);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0]?.intent).toBe('AUTHORIZE');
    expect(adapter.calls.filter((c) => c.method === 'renderA2HInline')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AUTHORIZE — method 3 (no buttons)
// ---------------------------------------------------------------------------

describe('processReply — AUTHORIZE via method 3 (no buttons)', () => {
  it('creates a form and sends the link', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore({ approved: true });
    const ctx = makeContext({
      capabilities: {
        supportsButtons: false,
        supportsSelectMenus: false,
        hasNativeThreads: false,
        hasReplyMessages: false,
      },
    });

    const result = await processReply({ intent: 'AUTHORIZE' }, ctx, adapter, formStore);

    expect(result.responses[0]?.intent).toBe('AUTHORIZE');
    expect(adapter.calls.some((c) => c.method === 'sendFormLink')).toBe(true);
    expect(formStore.createForm).toHaveBeenCalledTimes(1);
    expect(formStore.waitForSubmit).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — method 1 (closed options)
// ---------------------------------------------------------------------------

describe('processReply — COLLECT with closed options via method 1', () => {
  it('uses renderA2HInline for closed-option COLLECT', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const msg: A2HMessage = {
      intent: 'COLLECT',
      options: ['staging', 'production', 'rollback'],
    };

    const result = await processReply(msg, ctx, adapter, formStore);

    expect(result.responses[0]?.intent).toBe('COLLECT');
    expect(adapter.calls.some((c) => c.method === 'renderA2HInline')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — method 2 (free-text, thread capture)
// ---------------------------------------------------------------------------

describe('processReply — COLLECT free-text via method 2', () => {
  it('uses captureResponse with mode=thread on a thread-capable channel', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext({
      capabilities: {
        supportsButtons: false,
        supportsSelectMenus: false,
        hasNativeThreads: true,
        hasReplyMessages: false,
      },
    });

    const result = await processReply({ intent: 'COLLECT' }, ctx, adapter, formStore);

    expect(result.responses[0]?.intent).toBe('COLLECT');
    const captureCalls = adapter.calls.filter((c) => c.method === 'captureResponse');
    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]!.args[1]).toBe('thread');
  });

  it('falls back to method 3 when captureResponse returns null', async () => {
    const adapter = makeMockAdapter({
      captureResponse: mock(async () => null),
    });
    const formStore = makeMockFormStore({ answer: 'text response' });
    const ctx = makeContext({
      capabilities: {
        supportsButtons: false,
        supportsSelectMenus: false,
        hasNativeThreads: true,
        hasReplyMessages: false,
      },
    });

    const result = await processReply({ intent: 'COLLECT' }, ctx, adapter, formStore);

    expect(result.responses[0]?.intent).toBe('COLLECT');
    // Form was used as fallback
    expect(formStore.createForm).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — method 3 (multiple fields)
// ---------------------------------------------------------------------------

describe('processReply — COLLECT multiple fields via method 3', () => {
  it('creates a form for multi-field COLLECT', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore({ name: 'Alice', email: 'alice@example.com' });
    const ctx = makeContext();

    const msg: A2HMessage = {
      intent: 'COLLECT',
      schema: {
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'email', label: 'Email', type: 'email' },
        ],
      },
    };

    const result = await processReply(msg, ctx, adapter, formStore);

    expect(result.responses[0]?.intent).toBe('COLLECT');
    expect(adapter.calls.some((c) => c.method === 'sendFormLink')).toBe(true);
    expect(formStore.createForm).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// INFORM — fire-and-forget
// ---------------------------------------------------------------------------

describe('processReply — INFORM (fire-and-forget)', () => {
  it('sends a message and returns null response', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      { intent: 'INFORM', context: { message: 'Build finished.' } },
      ctx,
      adapter,
      formStore,
    );

    expect(result.a2hCount).toBe(1);
    expect(result.responses[0]).toBeNull();
    expect(adapter.calls.some((c) => c.method === 'sendMessage')).toBe(true);
    expect(adapter.calls.some((c) => c.method === 'renderA2HInline')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ESCALATE
// ---------------------------------------------------------------------------

describe('processReply — ESCALATE', () => {
  it('calls handleEscalation and returns null response', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      { intent: 'ESCALATE', context: { reason: 'Critical issue' } },
      ctx,
      adapter,
      formStore,
    );

    expect(result.responses[0]).toBeNull();
    expect(adapter.calls.some((c) => c.method === 'handleEscalation')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mixed array (text + AUTHORIZE)
// ---------------------------------------------------------------------------

describe('processReply — mixed array', () => {
  it('sends text then renders AUTHORIZE inline', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      [
        { text: 'Tests passed. Ready for production.' },
        { intent: 'AUTHORIZE', context: { action: 'deploy-to-production' } },
      ],
      ctx,
      adapter,
      formStore,
    );

    expect(result.chatSDKCount).toBe(1);
    expect(result.a2hCount).toBe(1);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0]).toBeNull(); // text message
    expect(result.responses[1]?.intent).toBe('AUTHORIZE');

    const renderCalls = adapter.calls.filter((c) => c.method === 'renderChatSDK');
    expect(renderCalls).toHaveLength(1);
    const inlineCalls = adapter.calls.filter((c) => c.method === 'renderA2HInline');
    expect(inlineCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple A2H intents → method 4 (batch form)
// ---------------------------------------------------------------------------

describe('processReply — multiple blocking A2H intents → method 4', () => {
  it('batches multiple intents into a single form call', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore({
      intent_0: 'approved',
      intent_1: 'Alice',
    });
    const ctx = makeContext();

    const result = await processReply(
      [
        { intent: 'AUTHORIZE', context: { action: 'deploy' } },
        { intent: 'COLLECT', schema: { fields: [{ name: 'name', label: 'Name', type: 'text' }] } },
      ],
      ctx,
      adapter,
      formStore,
    );

    expect(result.a2hCount).toBe(2);
    expect(result.responses).toHaveLength(2);
    // Both should have responses
    expect(result.responses[0]?.intent).toBe('AUTHORIZE');
    expect(result.responses[1]?.intent).toBe('COLLECT');

    // Only one form should be created for the batch
    expect(formStore.createForm).toHaveBeenCalledTimes(1);
    // Form was created with both intents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createCall = (formStore.createForm as any).mock.calls[0];
    expect((createCall[1] as A2HMessage[]).length).toBe(2);
  });

  it('ignores INFORM when counting blocking intents for batch decision', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    // 1 blocking (AUTHORIZE) + 1 fire-and-forget (INFORM) → should NOT batch
    const result = await processReply(
      [
        { intent: 'INFORM', context: { message: 'Starting deploy...' } },
        { intent: 'AUTHORIZE' },
      ],
      ctx,
      adapter,
      formStore,
    );

    expect(result.a2hCount).toBe(2);
    // INFORM → null, AUTHORIZE → response via method 1 (not method 4)
    expect(result.responses[0]).toBeNull();
    expect(result.responses[1]?.intent).toBe('AUTHORIZE');
    // Should use inline, not form
    expect(adapter.calls.some((c) => c.method === 'renderA2HInline')).toBe(true);
    expect(formStore.createForm).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Trust layer → always method 3
// ---------------------------------------------------------------------------

describe('processReply — trust layer active', () => {
  it('routes all A2H intents to method 3 when trust layer is on', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore({ approved: true });
    const ctx = makeContext({ trustLayerActive: true });

    const result = await processReply(
      { intent: 'AUTHORIZE' },
      ctx,
      adapter,
      formStore,
    );

    expect(result.responses[0]?.intent).toBe('AUTHORIZE');
    // method 3 → form link sent, NOT inline
    expect(adapter.calls.some((c) => c.method === 'sendFormLink')).toBe(true);
    expect(adapter.calls.some((c) => c.method === 'renderA2HInline')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe('processReply — timeout', () => {
  it('throws TimeoutError when response takes longer than responseTimeoutMs', async () => {
    const adapter = makeMockAdapter({
      renderA2HInline: mock(
        async (_msg: A2HMessage, _ctx: ReplyContext): Promise<A2HResponse> => {
          // Simulate a very slow response
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return { intent: 'AUTHORIZE', response: {}, respondedAt: new Date() };
        },
      ),
    });
    const formStore = makeMockFormStore();
    const ctx = makeContext({ responseTimeoutMs: 50 }); // 50 ms timeout

    await expect(
      processReply({ intent: 'AUTHORIZE' }, ctx, adapter, formStore),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

// ---------------------------------------------------------------------------
// Empty message array
// ---------------------------------------------------------------------------

describe('processReply — edge cases', () => {
  it('handles an empty message array', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply([], ctx, adapter, formStore);

    expect(result.chatSDKCount).toBe(0);
    expect(result.a2hCount).toBe(0);
    expect(result.responses).toEqual([]);
  });

  it('handles a message array with only INFORM intents', async () => {
    const adapter = makeMockAdapter();
    const formStore = makeMockFormStore();
    const ctx = makeContext();

    const result = await processReply(
      [
        { intent: 'INFORM', context: { message: 'Step 1 done.' } },
        { intent: 'INFORM', context: { message: 'Step 2 done.' } },
      ],
      ctx,
      adapter,
      formStore,
    );

    expect(result.a2hCount).toBe(2);
    expect(result.responses).toEqual([null, null]);
    const sendCalls = adapter.calls.filter((c) => c.method === 'sendMessage');
    expect(sendCalls).toHaveLength(2);
  });
});
