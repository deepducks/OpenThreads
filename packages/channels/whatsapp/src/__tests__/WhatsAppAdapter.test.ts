/**
 * WhatsApp adapter tests.
 *
 * All tests use a mock Baileys socket injected via `deps.socket` so no real
 * WhatsApp connection is required.
 */

import { describe, test, expect } from 'bun:test';
import { WhatsAppAdapter } from '../WhatsAppAdapter.js';
import { WHATSAPP_CAPABILITIES } from '../types.js';
import type {
  WhatsAppAdapterConfig,
  MockableSocket,
  InboundEnvelope,
  ChannelCapabilities,
} from '../types.js';

// ---------------------------------------------------------------------------
// Mock socket helpers
// ---------------------------------------------------------------------------

interface SentMessage {
  jid: string;
  content: Record<string, unknown>;
  /** The message ID returned by the mock sendMessage call */
  id: string;
}

let msgIdCounter = 1000;

function createMockSocket() {
  const sent: SentMessage[] = [];

  const socket: MockableSocket = {
    sendMessage: async (jid, content) => {
      const id = `msg-${++msgIdCounter}`;
      sent.push({ jid, content, id });
      return { key: { id } };
    },
    end: (_error?: Error) => {
      /* noop */
    },
  };

  return { socket, sent };
}

/**
 * Yield to the microtask queue so that async operations inside the adapter
 * (e.g., the form-link send) have a chance to complete before we read `sent`.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const testConfig: WhatsAppAdapterConfig = {
  sessionDir: '/tmp/wa-test-session',
  baseUrl: 'https://ot.example.com',
};

function makeAdapter() {
  const { socket, sent } = createMockSocket();
  const adapter = new WhatsAppAdapter(testConfig, { socket });
  return { adapter, socket, sent };
}

async function initializedAdapter() {
  const mocks = makeAdapter();
  await mocks.adapter.initialize();
  return mocks;
}

// ---------------------------------------------------------------------------
// Utilities: simulate inbound messages
// ---------------------------------------------------------------------------

function makeTextMessage(jid: string, text: string, msgId?: string): unknown {
  return {
    key: { remoteJid: jid, id: msgId ?? `in-${Date.now()}`, fromMe: false },
    message: { conversation: text },
    pushName: 'Test User',
  };
}

function makeExtendedTextMessage(
  jid: string,
  text: string,
  quotedId?: string,
  msgId?: string,
): unknown {
  return {
    key: { remoteJid: jid, id: msgId ?? `in-${Date.now()}`, fromMe: false },
    message: {
      extendedTextMessage: {
        text,
        ...(quotedId
          ? { contextInfo: { stanzaId: quotedId, participant: jid } }
          : {}),
      },
    },
    pushName: 'Test User',
  };
}

function makeButtonResponse(jid: string, buttonId: string, msgId?: string): unknown {
  return {
    key: { remoteJid: jid, id: msgId ?? `btn-${Date.now()}`, fromMe: false },
    message: {
      buttonsResponseMessage: {
        selectedButtonId: buttonId,
        selectedDisplayText: buttonId,
        type: 1,
      },
    },
    pushName: 'Test User',
  };
}

function makeImageMessage(jid: string, caption?: string, msgId?: string): unknown {
  return {
    key: { remoteJid: jid, id: msgId ?? `in-${Date.now()}`, fromMe: false },
    message: {
      imageMessage: { caption: caption ?? '', mimetype: 'image/jpeg', jpegThumbnail: '' },
    },
    pushName: 'Test User',
  };
}

// ---------------------------------------------------------------------------
// Conformance: interface shape
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter conformance — interface', () => {
  test('channelType is "whatsapp"', () => {
    const { adapter } = makeAdapter();
    expect(adapter.channelType).toBe('whatsapp');
  });

  test('capabilities has all required flags', () => {
    const { adapter } = makeAdapter();
    const flags: Array<keyof ChannelCapabilities> = [
      'threads',
      'buttons',
      'selectMenus',
      'replyMessages',
      'dms',
      'fileUpload',
    ];
    for (const flag of flags) {
      expect(typeof adapter.capabilities[flag]).toBe('boolean');
    }
  });

  test('exposes initialize() method', () => {
    const { adapter } = makeAdapter();
    expect(typeof adapter.initialize).toBe('function');
  });

  test('exposes shutdown() method', () => {
    const { adapter } = makeAdapter();
    expect(typeof adapter.shutdown).toBe('function');
  });

  test('exposes onMessage() method', () => {
    const { adapter } = makeAdapter();
    expect(typeof adapter.onMessage).toBe('function');
  });

  test('exposes send() method', () => {
    const { adapter } = makeAdapter();
    expect(typeof adapter.send).toBe('function');
  });

  test('exposes sendA2H() method', () => {
    const { adapter } = makeAdapter();
    expect(typeof adapter.sendA2H).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — capabilities', () => {
  test('threads:false (no native thread support)', () => {
    expect(WHATSAPP_CAPABILITIES.threads).toBe(false);
  });

  test('buttons:true (limited — max 3)', () => {
    expect(WHATSAPP_CAPABILITIES.buttons).toBe(true);
  });

  test('selectMenus:false', () => {
    expect(WHATSAPP_CAPABILITIES.selectMenus).toBe(false);
  });

  test('replyMessages:true (quoted replies)', () => {
    expect(WHATSAPP_CAPABILITIES.replyMessages).toBe(true);
  });

  test('dms:true', () => {
    expect(WHATSAPP_CAPABILITIES.dms).toBe(true);
  });

  test('fileUpload:true', () => {
    expect(WHATSAPP_CAPABILITIES.fileUpload).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — lifecycle', () => {
  test('initialize() with injected socket does not throw', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.initialize()).resolves.toBeUndefined();
  });

  test('send() throws before initialize()', async () => {
    const { adapter } = makeAdapter();
    await expect(
      adapter.send({ channelId: 'jid@s.whatsapp.net', targetId: 'jid@s.whatsapp.net', message: { text: 'hi' } }),
    ).rejects.toThrow('not initialised');
  });

  test('shutdown() after initialize() does not throw', async () => {
    const { adapter } = await initializedAdapter();
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — send()', () => {
  test('sends a plain text message', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    await adapter.send({ channelId: jid, targetId: jid, message: { text: 'Hello, World!' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.jid).toBe(jid);
    expect((sent[0]?.content as { text: string })['text']).toBe('Hello, World!');
  });

  test('returns a SendResult with messageId', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    const result = await adapter.send({ channelId: jid, targetId: jid, message: { text: 'hi' } });
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  test('sends multiple messages in sequence', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    await adapter.send({
      channelId: jid,
      targetId: jid,
      message: [{ text: 'First' }, { text: 'Second' }],
    });
    expect(sent).toHaveLength(2);
    expect((sent[0]?.content as { text: string })['text']).toBe('First');
    expect((sent[1]?.content as { text: string })['text']).toBe('Second');
  });

  test('sends INFORM A2H item as plain text', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    await adapter.send({
      channelId: jid,
      targetId: jid,
      message: { intent: 'INFORM', id: 'info-1', text: 'Deployment complete.' },
    });
    expect(sent).toHaveLength(1);
    expect((sent[0]?.content as { text: string })['text']).toBe('Deployment complete.');
  });
});

// ---------------------------------------------------------------------------
// sendA2H() — INFORM
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — sendA2H() INFORM', () => {
  test('sends text and returns INFORM response', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    const response = await adapter.sendA2H(jid, undefined, {
      intent: 'INFORM',
      id: 'inform-001',
      text: 'All systems operational.',
    });
    expect(sent).toHaveLength(1);
    expect(response.intentId).toBe('inform-001');
    expect(response.type).toBe('INFORM');
  });
});

// ---------------------------------------------------------------------------
// sendA2H() — AUTHORIZE (method 1: buttons)
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — sendA2H() AUTHORIZE with buttons', () => {
  test('sends a button message with Approve and Deny when no options given', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-001', context: { action: 'deploy-to-prod' } },
      { timeoutMs: 50 },
    );

    // Yield so the async button send completes
    await flushMicrotasks();

    // Verify button message was sent
    expect(sent).toHaveLength(1);
    const content = sent[0]?.content as Record<string, unknown>;
    expect(Array.isArray(content['buttons'])).toBe(true);
    const buttons = content['buttons'] as Array<{ buttonId: string; buttonText: { displayText: string } }>;
    expect(buttons.some((b) => b.buttonId.endsWith(':approve'))).toBe(true);
    expect(buttons.some((b) => b.buttonId.endsWith(':deny'))).toBe(true);

    // Promise should time out when no one responds
    await expect(authPromise).rejects.toThrow('AUTHORIZE timeout');
  });

  test('resolves approved=true when Approve button is pressed', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-002', context: { action: 'restart-service' } },
      { timeoutMs: 5000 },
    );

    // Yield so the pending capture is registered before simulating the button click
    await flushMicrotasks();

    // Simulate button click
    await adapter.handleIncomingMessages([
      makeButtonResponse(jid, 'auth-002:approve'),
    ]);

    const response = await authPromise;
    expect(response.intentId).toBe('auth-002');
    expect(response.type).toBe('AUTHORIZE');
    expect(response.approved).toBe(true);
  });

  test('resolves approved=false when Deny button is pressed', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-003', context: { action: 'delete-database' } },
      { timeoutMs: 5000 },
    );

    // Yield so the pending capture is registered
    await flushMicrotasks();

    await adapter.handleIncomingMessages([
      makeButtonResponse(jid, 'auth-003:deny'),
    ]);

    const response = await authPromise;
    expect(response.approved).toBe(false);
  });

  test('sends custom option buttons when options ≤3', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-004',
        context: { action: 'select-tier' },
        options: [
          { label: 'Basic', value: 'basic' },
          { label: 'Pro', value: 'pro' },
          { label: 'Enterprise', value: 'enterprise' },
        ],
      },
      { timeoutMs: 50 },
    );

    // Yield so the async button send completes
    await flushMicrotasks();

    const content = sent[0]?.content as Record<string, unknown>;
    const buttons = content['buttons'] as Array<{ buttonId: string; buttonText: { displayText: string } }>;
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.buttonText.displayText)).toEqual(['Basic', 'Pro', 'Enterprise']);

    await expect(authPromise).rejects.toThrow('AUTHORIZE timeout');
  });

  test('resolves with custom option value when button is pressed', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-005',
        context: { action: 'pick-region' },
        options: [
          { label: 'US East', value: 'us-east' },
          { label: 'EU West', value: 'eu-west' },
        ],
      },
      { timeoutMs: 5000 },
    );

    // Yield so the pending capture is registered
    await flushMicrotasks();

    await adapter.handleIncomingMessages([
      makeButtonResponse(jid, 'auth-005:eu-west'),
    ]);

    const response = await authPromise;
    expect(response.response).toBe('eu-west');
  });
});

// ---------------------------------------------------------------------------
// sendA2H() — AUTHORIZE (method 3: external form, >3 options)
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — sendA2H() AUTHORIZE >3 options (method 3)', () => {
  test('sends a form link message and times out', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-006',
        context: { action: 'choose-region' },
        options: [
          { label: 'US', value: 'us' },
          { label: 'EU', value: 'eu' },
          { label: 'APAC', value: 'apac' },
          { label: 'LATAM', value: 'latam' }, // 4th option → method 3
        ],
      },
      { timeoutMs: 50 },
    );

    // Yield so the async form-link send can complete
    await flushMicrotasks();

    // Should send a text message with a form link, not buttons
    expect(sent).toHaveLength(1);
    const content = sent[0]?.content as Record<string, unknown>;
    expect(typeof content['text']).toBe('string');
    expect(content['buttons']).toBeUndefined();
    expect(content['text'] as string).toContain('openthreads.host/form');

    await expect(authPromise).rejects.toThrow('AUTHORIZE timeout');
  });

  test('resolves via quoted reply when human replies to the form message', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-007',
        context: { action: 'approve-budget' },
        options: Array.from({ length: 5 }, (_, i) => ({ label: `Option ${i + 1}`, value: `opt${i + 1}` })),
      },
      { timeoutMs: 5000 },
    );

    // Yield so the form-link send completes and the pending capture is registered
    await flushMicrotasks();

    // Get the ID of the form-link message that was just sent
    const formMsgId = sent[0]?.id ?? '';
    expect(formMsgId).not.toBe('');

    // Simulate a quoted reply to that message
    await adapter.handleIncomingMessages([
      makeExtendedTextMessage(jid, 'approve', formMsgId),
    ]);

    const response = await authPromise;
    expect(response.type).toBe('AUTHORIZE');
    expect(response.response).toBe('approve');
    expect(response.approved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sendA2H() — COLLECT (method 3)
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — sendA2H() COLLECT (method 3)', () => {
  test('sends a form link message and times out', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const collectPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'COLLECT', id: 'collect-001', question: 'What is your shipping address?' },
      { timeoutMs: 50 },
    );

    // Yield so the async form-link send can complete
    await flushMicrotasks();

    expect(sent).toHaveLength(1);
    const content = sent[0]?.content as Record<string, unknown>;
    expect(content['text'] as string).toContain('openthreads.host/form');
    expect(content['text'] as string).toContain('shipping address');

    await expect(collectPromise).rejects.toThrow('COLLECT timeout');
  });

  test('resolves via quoted-reply capture (method 2 fallback)', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const collectPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'COLLECT', id: 'collect-002', question: 'Enter a value' },
      { timeoutMs: 5000 },
    );

    // Yield so the form-link send completes and pending capture is registered
    await flushMicrotasks();

    // The form-link message was sent — get its ID from the sent array
    const formMsgId = sent[0]?.id ?? '';

    await adapter.handleIncomingMessages([
      makeExtendedTextMessage(jid, 'my-value', formMsgId),
    ]);

    const response = await collectPromise;
    expect(response.intentId).toBe('collect-002');
    expect(response.type).toBe('COLLECT');
    expect(response.response).toBe('my-value');
  });

  test('uses custom formBaseUrl when provided', async () => {
    const { adapter, sent } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const collectPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'COLLECT', id: 'collect-003', question: 'Email?' },
      { timeoutMs: 50, formBaseUrl: 'https://custom.example.com/a2h' },
    );

    // Yield so the form-link send completes
    await flushMicrotasks();

    const text = (sent[0]?.content as Record<string, unknown>)['text'] as string;
    expect(text).toContain('custom.example.com/a2h/collect-003');

    await expect(collectPromise).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter — inbound messages', () => {
  test('dispatches a text message to the registered handler', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => {
      received.push(env);
    });

    await adapter.handleIncomingMessages([makeTextMessage(jid, 'Hello, bot!')]);

    expect(received).toHaveLength(1);
    expect(received[0]?.source.channel).toBe('whatsapp');
    expect(received[0]?.source.channelId).toBe(jid);
    expect(received[0]?.message[0]).toEqual({ text: 'Hello, bot!' });
  });

  test('sets threadId to the message ID when no quoted context', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    const msgId = 'root-msg-001';
    await adapter.handleIncomingMessages([makeTextMessage(jid, 'Hi', msgId)]);

    expect(received[0]?.threadId).toBe(msgId);
  });

  test('sets threadId to the quoted message ID (virtual thread via reply chain)', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    const rootMsgId = 'root-001';
    await adapter.handleIncomingMessages([
      makeExtendedTextMessage(jid, 'This is a reply', rootMsgId),
    ]);

    // threadId should be the root message ID (quoted parent)
    expect(received[0]?.threadId).toBe(rootMsgId);
  });

  test('includes a replyTo URL in the inbound envelope', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    await adapter.handleIncomingMessages([makeTextMessage(jid, 'test')]);

    expect(received[0]?.replyTo).toContain('https://ot.example.com');
    expect(received[0]?.replyTo).toContain('whatsapp');
  });

  test('ignores messages sent by the bot itself (fromMe=true)', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    await adapter.handleIncomingMessages([
      {
        key: { remoteJid: jid, id: 'self-msg', fromMe: true },
        message: { conversation: 'I sent this' },
        pushName: 'Bot',
      },
    ]);

    expect(received).toHaveLength(0);
  });

  test('dispatches image message with caption as text', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    await adapter.handleIncomingMessages([makeImageMessage(jid, 'Check this out')]);

    expect(received[0]?.message[0]).toEqual({ text: 'Check this out' });
  });

  test('dispatches image message without caption as "[image]"', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    await adapter.handleIncomingMessages([makeImageMessage(jid, undefined)]);

    expect(received[0]?.message[0]).toEqual({ text: '[image]' });
  });

  test('ignores messages with empty text content (no dispatch)', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '9876543210@s.whatsapp.net';

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    // Message with no recognisable text content
    await adapter.handleIncomingMessages([
      {
        key: { remoteJid: jid, id: 'empty', fromMe: false },
        message: { reactionMessage: { text: '👍', key: {} } },
        pushName: 'User',
      },
    ]);

    expect(received).toHaveLength(0);
  });

  test('does not dispatch A2H button responses as inbound messages', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';

    // Start an AUTHORIZE so there is a pending capture
    const authPromise = adapter.sendA2H(
      jid,
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-99', context: { action: 'test' } },
      { timeoutMs: 5000 },
    );

    // Yield so the pending capture is registered
    await flushMicrotasks();

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => received.push(env));

    // Simulate the button click — should resolve the A2H promise, NOT dispatch inbound
    await adapter.handleIncomingMessages([makeButtonResponse(jid, 'auth-99:approve')]);

    await authPromise; // should resolve
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// onMessage() contract
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter conformance — onMessage()', () => {
  test('accepts a handler function without error', async () => {
    const { adapter } = await initializedAdapter();
    expect(() => {
      adapter.onMessage(async () => {});
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// send() conformance
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter conformance — send()', () => {
  test('returns a SendResult with messageId', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    const result = await adapter.send({ channelId: jid, targetId: jid, message: { text: 'conform' } });
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  test('accepts a MessageItem array', async () => {
    const { adapter } = await initializedAdapter();
    const jid = '1234567890@s.whatsapp.net';
    const result = await adapter.send({
      channelId: jid,
      targetId: jid,
      message: [{ text: 'one' }, { text: 'two' }],
    });
    expect(result.messageId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sendA2H() conformance
// ---------------------------------------------------------------------------

describe('WhatsAppAdapter conformance — sendA2H()', () => {
  test('INFORM returns response with intentId and type', async () => {
    const { adapter } = await initializedAdapter();
    const response = await adapter.sendA2H(
      '1234567890@s.whatsapp.net',
      undefined,
      { intent: 'INFORM', id: 'conform-inform-001', text: 'Notify' },
    );
    expect(response.intentId).toBe('conform-inform-001');
    expect(response.type).toBe('INFORM');
  });

  test('AUTHORIZE times out and rejects', async () => {
    const { adapter } = await initializedAdapter();
    await expect(
      adapter.sendA2H(
        '1234567890@s.whatsapp.net',
        undefined,
        { intent: 'AUTHORIZE', id: 'conform-auth-001', context: { action: 'test' } },
        { timeoutMs: 30 },
      ),
    ).rejects.toThrow();
  });

  test('COLLECT times out and rejects', async () => {
    const { adapter } = await initializedAdapter();
    await expect(
      adapter.sendA2H(
        '1234567890@s.whatsapp.net',
        undefined,
        { intent: 'COLLECT', id: 'conform-collect-001', question: 'What is your name?' },
        { timeoutMs: 30 },
      ),
    ).rejects.toThrow();
  });
});
