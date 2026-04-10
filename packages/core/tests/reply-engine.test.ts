import { describe, test, expect, mock } from 'bun:test';
import { ReplyEngine } from '../src/reply-engine/index.js';
import { TimeoutError } from '../src/reply-engine/response-collector.js';
import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  ChannelCapabilities,
  ChatSDKMessage,
  ReplyEnvelope,
} from '../src/types/index.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeCapabilities(overrides: Partial<ChannelCapabilities> = {}): ChannelCapabilities {
  return {
    supportsButtons: true,
    supportsSelectMenus: true,
    supportsNativeThreads: true,
    supportsNativeReplies: false,
    isDM: false,
    ...overrides,
  };
}

function makeA2HResponse(intent: A2HMessage['intent'], response: unknown = true): A2HResponse {
  return { intent, response, respondedAt: new Date() };
}

function makeAdapter(
  capabilities: ChannelCapabilities,
  overrides: Partial<{
    renderChatSDK: (msg: ChatSDKMessage) => Promise<void>;
    renderA2HInline: (msg: A2HMessage) => Promise<A2HResponse>;
    captureResponse: (msg: A2HMessage, method: string) => Promise<A2HResponse>;
    sendFormLink: (url: string, context: A2HMessage | A2HMessage[]) => Promise<void>;
  }> = {},
): ChannelAdapter {
  return {
    capabilities,
    renderChatSDK: overrides.renderChatSDK ?? mock(() => Promise.resolve()),
    renderA2HInline: overrides.renderA2HInline ?? mock(() => Promise.resolve(makeA2HResponse('AUTHORIZE'))),
    captureResponse: overrides.captureResponse ?? mock(() => Promise.resolve(makeA2HResponse('COLLECT', 'yes'))),
    sendFormLink: overrides.sendFormLink ?? mock(() => Promise.resolve()),
  } as ChannelAdapter;
}

// ---------------------------------------------------------------------------
// Message parsing & normalization
// ---------------------------------------------------------------------------

describe('ReplyEngine — message parsing', () => {
  test('wraps a single Chat SDK object and renders it', async () => {
    const renderChatSDK = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK });
    const engine = new ReplyEngine(adapter);

    const envelope: ReplyEnvelope = { message: { text: 'Hello' } };
    const result = await engine.process(envelope, 'turn_001');

    expect(renderChatSDK).toHaveBeenCalledTimes(1);
    expect(renderChatSDK).toHaveBeenCalledWith({ text: 'Hello' });
    expect(result.responses).toEqual([null]);
  });

  test('processes a 1-item array the same as a single object', async () => {
    const renderChatSDK = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK });
    const engine = new ReplyEngine(adapter);

    const envelope: ReplyEnvelope = { message: [{ text: 'Hello' }] };
    const result = await engine.process(envelope, 'turn_002');

    expect(renderChatSDK).toHaveBeenCalledTimes(1);
    expect(result.responses).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// Chat SDK path
// ---------------------------------------------------------------------------

describe('ReplyEngine — Chat SDK path', () => {
  test('delegates to renderChatSDK for Chat SDK messages', async () => {
    const renderChatSDK = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK });
    const engine = new ReplyEngine(adapter);

    await engine.process({ message: [{ text: 'Deploy complete.' }] }, 'turn_001');

    expect(renderChatSDK).toHaveBeenCalledWith({ text: 'Deploy complete.' });
  });

  test('sends null response for Chat SDK messages (no blocking)', async () => {
    const adapter = makeAdapter(makeCapabilities());
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { message: [{ text: 'Notification' }, { markdown: '**bold**' }] },
      'turn_002',
    );

    expect(result.responses).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// A2H — INFORM (fire-and-forget)
// ---------------------------------------------------------------------------

describe('ReplyEngine — INFORM intent', () => {
  test('renders INFORM as a plain channel message and returns null response', async () => {
    const renderChatSDK = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK });
    const engine = new ReplyEngine(adapter);

    const msg: A2HMessage = {
      intent: 'INFORM',
      context: { details: 'Deployment completed.' },
    };
    const result = await engine.process({ message: msg }, 'turn_003');

    expect(renderChatSDK).toHaveBeenCalled();
    expect(result.responses).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// A2H — AUTHORIZE
// ---------------------------------------------------------------------------

describe('ReplyEngine — AUTHORIZE intent', () => {
  test('method 1: delegates to renderA2HInline on capable channel', async () => {
    const approvalResponse = makeA2HResponse('AUTHORIZE', true);
    const renderA2HInline = mock(() => Promise.resolve(approvalResponse));
    const adapter = makeAdapter(makeCapabilities(), { renderA2HInline });
    const engine = new ReplyEngine(adapter);

    const msg: A2HMessage = { intent: 'AUTHORIZE', context: { action: 'deploy-to-prod' } };
    const result = await engine.process({ message: msg }, 'turn_004');

    expect(renderA2HInline).toHaveBeenCalledWith(msg);
    expect(result.responses[0]).toEqual(approvalResponse);
  });

  test('method 3: sends form link when channel has no buttons', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false, supportsSelectMenus: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, { timeoutMs: 100 });

    const msg: A2HMessage = { intent: 'AUTHORIZE' };

    // The engine blocks on method 3 — resolve it manually via the registry
    const processPromise = engine.process({ message: msg }, 'turn_005');

    // Simulate form submission
    setTimeout(() => {
      engine.registry.submit('turn_005', makeA2HResponse('AUTHORIZE', true));
    }, 10);

    const result = await processPromise;
    expect(sendFormLink).toHaveBeenCalled();
    expect((result.responses[0] as A2HResponse).response).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A2H — COLLECT
// ---------------------------------------------------------------------------

describe('ReplyEngine — COLLECT intent', () => {
  test('method 2: delegates to captureResponse on Slack-like channel (thread)', async () => {
    const captureResponse = mock(() => Promise.resolve(makeA2HResponse('COLLECT', 'my reason')));
    const adapter = makeAdapter(
      makeCapabilities({ supportsNativeThreads: true }),
      { captureResponse },
    );
    const engine = new ReplyEngine(adapter);

    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'reason', type: 'text' }] },
    };
    const result = await engine.process({ message: msg }, 'turn_006');

    expect(captureResponse).toHaveBeenCalledWith(msg, 'thread');
    expect((result.responses[0] as A2HResponse).response).toBe('my reason');
  });

  test('method 1: uses inline for closed-option select field on capable channel', async () => {
    const renderA2HInline = mock(() => Promise.resolve(makeA2HResponse('COLLECT', 'staging')));
    const adapter = makeAdapter(makeCapabilities(), { renderA2HInline });
    const engine = new ReplyEngine(adapter);

    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'env', type: 'select', options: ['staging', 'prod'] }] },
    };
    await engine.process({ message: msg }, 'turn_007');

    expect(renderA2HInline).toHaveBeenCalledWith(msg);
  });

  test('method 3: multiple fields always use external form', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { sendFormLink });
    const engine = new ReplyEngine(adapter, { timeoutMs: 100 });

    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: {
        fields: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'text' },
        ],
      },
    };

    const processPromise = engine.process({ message: msg }, 'turn_008');
    setTimeout(() => {
      engine.registry.submit('turn_008', makeA2HResponse('COLLECT', { name: 'Alice', email: 'alice@example.com' }));
    }, 10);

    await processPromise;
    expect(sendFormLink).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mixed array (Chat SDK + A2H)
// ---------------------------------------------------------------------------

describe('ReplyEngine — mixed array', () => {
  test('sends text first, then AUTHORIZE with correct method', async () => {
    const callOrder: string[] = [];
    const renderChatSDK = mock(() => {
      callOrder.push('renderChatSDK');
      return Promise.resolve();
    });
    const approvalResponse = makeA2HResponse('AUTHORIZE', true);
    const renderA2HInline = mock(() => {
      callOrder.push('renderA2HInline');
      return Promise.resolve(approvalResponse);
    });
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK, renderA2HInline });
    const engine = new ReplyEngine(adapter);

    const envelope: ReplyEnvelope = {
      message: [
        { text: 'Tests passed. Ready for production.' },
        { intent: 'AUTHORIZE', context: { action: 'deploy-to-production' } },
      ],
    };
    const result = await engine.process(envelope, 'turn_009');

    expect(callOrder).toEqual(['renderChatSDK', 'renderA2HInline']);
    expect(result.responses[0]).toBeNull();
    expect(result.responses[1]).toEqual(approvalResponse);
  });

  test('returns responses array in same order as items', async () => {
    const informMsg: A2HMessage = {
      intent: 'INFORM',
      context: { details: 'System update' },
    };
    const textMsg: ChatSDKMessage = { text: 'Hello' };
    const authMsg: A2HMessage = { intent: 'AUTHORIZE' };
    const authResponse = makeA2HResponse('AUTHORIZE', true);

    const renderA2HInline = mock(() => Promise.resolve(authResponse));
    const adapter = makeAdapter(makeCapabilities(), { renderA2HInline });
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { message: [textMsg, informMsg, authMsg] },
      'turn_010',
    );

    expect(result.responses).toHaveLength(3);
    expect(result.responses[0]).toBeNull();  // Chat SDK text
    expect(result.responses[1]).toBeNull();  // INFORM (fire-and-forget)
    expect(result.responses[2]).toEqual(authResponse);  // AUTHORIZE
  });
});

// ---------------------------------------------------------------------------
// Multiple A2H intents → method 4 (batch form)
// ---------------------------------------------------------------------------

describe('ReplyEngine — multiple A2H intents (method 4)', () => {
  test('batches multiple A2H intents to method 4 and awaits form submission', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { sendFormLink });
    const engine = new ReplyEngine(adapter, { timeoutMs: 500 });

    const msgs: A2HMessage[] = [
      { intent: 'AUTHORIZE', context: { action: 'deploy' } },
      { intent: 'COLLECT', collect: { question: 'Reason?' } },
    ];

    const processPromise = engine.process({ message: msgs }, 'turn_011');

    // Simulate form submission for each sub-key
    setTimeout(() => {
      engine.registry.submit('turn_011_batch_0', makeA2HResponse('AUTHORIZE', true));
      engine.registry.submit('turn_011_batch_1', makeA2HResponse('COLLECT', 'deploy new feature'));
    }, 20);

    const result = await processPromise;

    expect(sendFormLink).toHaveBeenCalledTimes(1);
    // The form URL includes the batch key
    const formUrl = (sendFormLink.mock.calls[0] as [string, unknown])[0] as string;
    expect(formUrl).toContain('turn_011_batch');
    expect((result.responses[0] as A2HResponse).response).toBe(true);
    expect((result.responses[1] as A2HResponse).response).toBe('deploy new feature');
  });

  test('sends Chat SDK items before the batch form', async () => {
    const callOrder: string[] = [];
    const renderChatSDK = mock(() => {
      callOrder.push('chat');
      return Promise.resolve();
    });
    const sendFormLink = mock(() => {
      callOrder.push('form');
      return Promise.resolve();
    });
    const adapter = makeAdapter(makeCapabilities(), { renderChatSDK, sendFormLink });
    const engine = new ReplyEngine(adapter, { timeoutMs: 200 });

    const processPromise = engine.process(
      {
        message: [
          { text: 'Preamble' },
          { intent: 'AUTHORIZE' },
          { intent: 'COLLECT', collect: { question: 'Why?' } },
        ],
      },
      'turn_012',
    );

    setTimeout(() => {
      engine.registry.submit('turn_012_batch_0', makeA2HResponse('AUTHORIZE', true));
      engine.registry.submit('turn_012_batch_1', makeA2HResponse('COLLECT', 'because'));
    }, 20);

    await processPromise;
    expect(callOrder).toEqual(['chat', 'form']);
  });
});

// ---------------------------------------------------------------------------
// Trust layer
// ---------------------------------------------------------------------------

describe('ReplyEngine — trust layer', () => {
  test('forces method 3 for AUTHORIZE even on fully capable channel', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const renderA2HInline = mock(() => Promise.resolve(makeA2HResponse('AUTHORIZE')));
    const adapter = makeAdapter(makeCapabilities(), { sendFormLink, renderA2HInline });
    const engine = new ReplyEngine(adapter, { trustLayerActive: true, timeoutMs: 100 });

    const processPromise = engine.process({ message: { intent: 'AUTHORIZE' } }, 'turn_013');
    setTimeout(() => {
      engine.registry.submit('turn_013', makeA2HResponse('AUTHORIZE', true));
    }, 10);

    await processPromise;
    expect(renderA2HInline).not.toHaveBeenCalled();
    expect(sendFormLink).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe('ReplyEngine — timeout', () => {
  test('throws TimeoutError when blocking intent does not respond in time', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, { timeoutMs: 50 });

    await expect(
      engine.process({ message: { intent: 'AUTHORIZE' } }, 'turn_014'),
    ).rejects.toThrow(TimeoutError);
  });

  test('TimeoutError contains the intent and turnId', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, { timeoutMs: 50 });

    try {
      await engine.process({ message: { intent: 'COLLECT' } }, 'turn_015');
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.intent).toBe('COLLECT');
      expect(te.turnId).toBe('turn_015');
      expect(te.timeoutMs).toBe(50);
    }
  });
});

// ---------------------------------------------------------------------------
// Escalation handler
// ---------------------------------------------------------------------------

describe('ReplyEngine — ESCALATE intent', () => {
  test('calls escalation handler when configured', async () => {
    const escalationResponse = makeA2HResponse('ESCALATE', { operatorId: 'op_001' });
    const escalationHandler = {
      handle: mock(() => Promise.resolve(escalationResponse)),
    };
    const adapter = makeAdapter(makeCapabilities());
    const engine = new ReplyEngine(adapter, { escalationHandler });

    const msg: A2HMessage = { intent: 'ESCALATE', context: { details: 'Critical error' } };
    const result = await engine.process({ message: msg }, 'turn_016');

    expect(escalationHandler.handle).toHaveBeenCalledWith(msg);
    expect(result.responses[0]).toEqual(escalationResponse);
  });

  test('falls back to method 3 (form link) when no escalation handler configured', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(makeCapabilities(), { sendFormLink });
    const engine = new ReplyEngine(adapter, { timeoutMs: 100 });

    const processPromise = engine.process({ message: { intent: 'ESCALATE' } }, 'turn_017');
    setTimeout(() => {
      engine.registry.submit('turn_017', makeA2HResponse('ESCALATE', { operator: 'alice' }));
    }, 10);

    const result = await processPromise;
    expect(sendFormLink).toHaveBeenCalled();
    expect((result.responses[0] as A2HResponse).intent).toBe('ESCALATE');
  });
});

// ---------------------------------------------------------------------------
// ResponseRegistry
// ---------------------------------------------------------------------------

describe('ResponseRegistry (via engine.registry)', () => {
  test('submit resolves the pending promise', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, { timeoutMs: 1000 });

    const processPromise = engine.process({ message: { intent: 'AUTHORIZE' } }, 'reg_001');

    const submitted = engine.registry.submit('reg_001', makeA2HResponse('AUTHORIZE', false));
    expect(submitted).toBe(true);

    const result = await processPromise;
    expect((result.responses[0] as A2HResponse).response).toBe(false);
  });

  test('cancel rejects the pending promise', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, { timeoutMs: 1000 });

    const processPromise = engine.process({ message: { intent: 'AUTHORIZE' } }, 'reg_002');

    engine.registry.cancel('reg_002', new Error('Form expired'));

    await expect(processPromise).rejects.toThrow('Form expired');
  });

  test('submit returns false for unknown key', () => {
    const engine = new ReplyEngine(makeAdapter(makeCapabilities()));
    expect(engine.registry.submit('unknown', makeA2HResponse('AUTHORIZE'))).toBe(false);
  });

  test('form URL uses configured formBaseUrl', async () => {
    const sendFormLink = mock(() => Promise.resolve());
    const adapter = makeAdapter(
      makeCapabilities({ supportsButtons: false }),
      { sendFormLink },
    );
    const engine = new ReplyEngine(adapter, {
      formBaseUrl: 'https://my-instance.example.com/form',
      timeoutMs: 100,
    });

    const processPromise = engine.process({ message: { intent: 'AUTHORIZE' } }, 'turn_018');
    engine.registry.submit('turn_018', makeA2HResponse('AUTHORIZE', true));

    await processPromise;
    const url = (sendFormLink.mock.calls[0] as [string, unknown])[0] as string;
    expect(url).toBe('https://my-instance.example.com/form/turn_018');
  });
});
