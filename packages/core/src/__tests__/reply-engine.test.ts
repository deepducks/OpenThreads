import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ReplyEngine } from '../engine/reply-engine.js';
import type { ChannelAdapter } from '../adapters/channel-adapter.js';
import type { ChannelCapabilities, A2HMessage, A2HResponse, ReplyContext } from '../types/index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockContext: ReplyContext = {
  channelId: 'slack-main',
  threadId: 'ot_thr_abc123',
  turnId: 'ot_turn_001',
  targetId: 'C0123',
  source: {
    channel: 'slack',
    channelId: 'C0123',
    sender: { id: 'U456', name: 'Alice' },
  },
};

const fullCapabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: true,
  supportsNativeThreads: true,
  supportsReplyMessages: true,
  isDM: false,
};

const noCapabilities: ChannelCapabilities = {
  supportsButtons: false,
  supportsSelectMenus: false,
  supportsNativeThreads: false,
  supportsReplyMessages: false,
  isDM: false,
};

function makeAuthorizeResponse(message: A2HMessage): A2HResponse {
  return {
    intentId: message.id,
    intent: message.intent,
    response: { approved: true },
    respondedAt: new Date(),
  };
}

function makeCollectResponse(message: A2HMessage): A2HResponse {
  return {
    intentId: message.id,
    intent: message.intent,
    response: { text: 'Some collected text' },
    respondedAt: new Date(),
  };
}

function createAdapter(capabilities: ChannelCapabilities = fullCapabilities): {
  adapter: ChannelAdapter;
  renderChatSDK: ReturnType<typeof mock>;
  renderA2HInline: ReturnType<typeof mock>;
  captureResponse: ReturnType<typeof mock>;
  sendFormLink: ReturnType<typeof mock>;
  handleEscalation: ReturnType<typeof mock>;
} {
  const renderChatSDK = mock(async () => {});
  const renderA2HInline = mock(async (msg: A2HMessage) => makeAuthorizeResponse(msg));
  const captureResponse = mock(async (msg: A2HMessage) => makeCollectResponse(msg));
  const sendFormLink = mock(async () => {});
  const handleEscalation = mock(async () => {});

  const adapter: ChannelAdapter = {
    getCapabilities: () => capabilities,
    renderChatSDK,
    renderA2HInline,
    captureResponse,
    sendFormLink,
    handleEscalation,
  };

  return { adapter, renderChatSDK, renderA2HInline, captureResponse, sendFormLink, handleEscalation };
}

// ---------------------------------------------------------------------------
// Chat SDK messages
// ---------------------------------------------------------------------------

describe('ReplyEngine — Chat SDK messages', () => {
  it('renders a single text message via Chat SDK', async () => {
    const { adapter, renderChatSDK } = createAdapter();
    const engine = new ReplyEngine(adapter);

    const result = await engine.process({ text: 'Deploy started. ETA 3 minutes.' }, mockContext);

    expect(result.success).toBe(true);
    expect(renderChatSDK.mock.calls).toHaveLength(1);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0]).toBeNull();
  });

  it('renders multiple Chat SDK messages in order', async () => {
    const { adapter, renderChatSDK } = createAdapter();
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      [{ text: 'Step 1 done.' }, { text: 'Step 2 done.' }],
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(renderChatSDK.mock.calls).toHaveLength(2);
    expect(result.responses).toHaveLength(2);
    expect(result.responses.every((r) => r === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A2H — INFORM
// ---------------------------------------------------------------------------

describe('ReplyEngine — INFORM', () => {
  it('renders INFORM as a plain text message (fire-and-forget)', async () => {
    const { adapter, renderChatSDK } = createAdapter();
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { intent: 'INFORM', context: { details: 'Deploy complete' } },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(renderChatSDK.mock.calls).toHaveLength(1);
    expect(result.responses[0]).toBeNull();
  });

  it('uses action as fallback text when details is missing', async () => {
    const { adapter, renderChatSDK } = createAdapter();
    const engine = new ReplyEngine(adapter);

    await engine.process(
      { intent: 'INFORM', context: { action: 'backup-started' } },
      mockContext,
    );

    const call = renderChatSDK.mock.calls[0];
    expect((call[0] as { text: string }).text).toBe('backup-started');
  });
});

// ---------------------------------------------------------------------------
// A2H — AUTHORIZE
// ---------------------------------------------------------------------------

describe('ReplyEngine — AUTHORIZE', () => {
  it('uses inline rendering (method 1) when channel supports buttons', async () => {
    const { adapter, renderA2HInline, sendFormLink } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { intent: 'AUTHORIZE', context: { action: 'deploy-to-production' } },
      mockContext,
    );

    expect(renderA2HInline.mock.calls).toHaveLength(1);
    expect(sendFormLink.mock.calls).toHaveLength(0);
    expect(result.responses[0]).not.toBeNull();
    expect(result.responses[0]?.intent).toBe('AUTHORIZE');
  });

  it('uses external form (method 3) when channel has no button support', async () => {
    const { adapter, renderA2HInline, sendFormLink } = createAdapter(noCapabilities);
    const engine = new ReplyEngine(adapter);

    await engine.process({ intent: 'AUTHORIZE' }, mockContext);

    expect(sendFormLink.mock.calls).toHaveLength(1);
    expect(renderA2HInline.mock.calls).toHaveLength(0);
  });

  it('uses external form (method 3) when trust layer is active', async () => {
    const { adapter, renderA2HInline, sendFormLink } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter, { trustLayerActive: true });

    await engine.process({ intent: 'AUTHORIZE' }, mockContext);

    expect(sendFormLink.mock.calls).toHaveLength(1);
    expect(renderA2HInline.mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A2H — COLLECT
// ---------------------------------------------------------------------------

describe('ReplyEngine — COLLECT free-text', () => {
  it('uses text capture (method 2) with thread mode on capable channels', async () => {
    const { adapter, captureResponse, sendFormLink } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { intent: 'COLLECT', fields: [{ id: 'reason', label: 'Why?', type: 'text' }] },
      mockContext,
    );

    expect(captureResponse.mock.calls).toHaveLength(1);
    expect(captureResponse.mock.calls[0][1]).toBe('thread');
    expect(sendFormLink.mock.calls).toHaveLength(0);
    expect(result.responses[0]?.intent).toBe('COLLECT');
  });

  it('falls back to method 3 when no capture mode is available', async () => {
    const { adapter, captureResponse, sendFormLink } = createAdapter(noCapabilities);
    const engine = new ReplyEngine(adapter);

    await engine.process(
      { intent: 'COLLECT', fields: [{ id: 'answer', label: 'Answer', type: 'text' }] },
      mockContext,
    );

    expect(sendFormLink.mock.calls).toHaveLength(1);
    expect(captureResponse.mock.calls).toHaveLength(0);
  });
});

describe('ReplyEngine — COLLECT closed options', () => {
  it('uses inline rendering (method 1) for select fields on capable channels', async () => {
    const { adapter, renderA2HInline } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    await engine.process(
      {
        intent: 'COLLECT',
        fields: [
          {
            id: 'env',
            label: 'Environment',
            type: 'select',
            options: [
              { value: 'staging', label: 'Staging' },
              { value: 'prod', label: 'Production' },
            ],
          },
        ],
      },
      mockContext,
    );

    expect(renderA2HInline.mock.calls).toHaveLength(1);
  });
});

describe('ReplyEngine — COLLECT multiple fields', () => {
  it('always uses external form (method 3)', async () => {
    const { adapter, sendFormLink, renderA2HInline } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    await engine.process(
      {
        intent: 'COLLECT',
        fields: [
          { id: 'name', label: 'Name', type: 'text' },
          { id: 'email', label: 'Email', type: 'text' },
        ],
      },
      mockContext,
    );

    expect(sendFormLink.mock.calls).toHaveLength(1);
    expect(renderA2HInline.mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A2H — ESCALATE
// ---------------------------------------------------------------------------

describe('ReplyEngine — ESCALATE', () => {
  it('delegates to handleEscalation and returns null response', async () => {
    const { adapter, handleEscalation } = createAdapter();
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      { intent: 'ESCALATE', context: { action: 'escalate-to-oncall' } },
      mockContext,
    );

    expect(handleEscalation.mock.calls).toHaveLength(1);
    expect(result.responses[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mixed array (text + AUTHORIZE)
// ---------------------------------------------------------------------------

describe('ReplyEngine — mixed array', () => {
  it('sends text first, then renders AUTHORIZE inline', async () => {
    const { adapter, renderChatSDK, renderA2HInline } = createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      [
        { text: 'Tests passed. Ready for production.' },
        { intent: 'AUTHORIZE', context: { action: 'deploy-to-production', details: 'branch feature-x → production' } },
      ],
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(renderChatSDK.mock.calls).toHaveLength(1);
    expect(renderA2HInline.mock.calls).toHaveLength(1);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0]).toBeNull();       // Chat SDK slot
    expect(result.responses[1]).not.toBeNull();   // AUTHORIZE response
    expect(result.responses[1]?.intent).toBe('AUTHORIZE');
  });
});

// ---------------------------------------------------------------------------
// Method 4 — batch form (multiple A2H intents)
// ---------------------------------------------------------------------------

describe('ReplyEngine — multiple A2H intents (method 4)', () => {
  it('sends a single form link when there are 2+ A2H intents', async () => {
    const { adapter, sendFormLink, renderA2HInline, captureResponse } =
      createAdapter(fullCapabilities);
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      [
        { intent: 'AUTHORIZE', context: { action: 'approve-budget' } },
        { intent: 'COLLECT', fields: [{ id: 'comment', label: 'Comment', type: 'text' }] },
      ],
      mockContext,
    );

    // Both A2H items should go to forms, not inline
    expect(sendFormLink.mock.calls.length).toBeGreaterThan(0);
    expect(renderA2HInline.mock.calls).toHaveLength(0);
    expect(captureResponse.mock.calls).toHaveLength(0);
    expect(result.responses).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Form URL generation
// ---------------------------------------------------------------------------

describe('ReplyEngine — form URL', () => {
  it('generates the form URL from turnId', async () => {
    const { adapter, sendFormLink } = createAdapter(noCapabilities);
    const engine = new ReplyEngine(adapter, {
      formBaseUrl: 'https://openthreads.example.com/form',
    });

    await engine.process({ intent: 'AUTHORIZE' }, mockContext);

    expect(sendFormLink.mock.calls).toHaveLength(1);
    const formUrl = sendFormLink.mock.calls[0][0] as string;
    expect(formUrl).toBe(`https://openthreads.example.com/form/${mockContext.turnId}`);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('ReplyEngine — error handling', () => {
  it('captures errors without aborting other items', async () => {
    const renderChatSDK = mock(async () => {
      throw new Error('Slack API error');
    });
    const adapter: ChannelAdapter = {
      getCapabilities: () => fullCapabilities,
      renderChatSDK,
      renderA2HInline: mock(async (msg: A2HMessage) => makeAuthorizeResponse(msg)),
      captureResponse: mock(async (msg: A2HMessage) => makeCollectResponse(msg)),
      sendFormLink: mock(async () => {}),
      handleEscalation: mock(async () => {}),
    };
    const engine = new ReplyEngine(adapter);

    const result = await engine.process(
      [
        { text: 'This will fail' },
        { intent: 'AUTHORIZE' },
      ],
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toContain('Slack API error');
    // AUTHORIZE should still have been processed
    expect(result.responses[1]).not.toBeNull();
  });
});
