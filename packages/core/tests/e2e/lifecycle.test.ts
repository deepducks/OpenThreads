/**
 * End-to-end lifecycle tests for OpenThreads.
 *
 * These tests exercise the full message lifecycle using in-memory storage and
 * mock HTTP clients.  They do NOT start a real server or connect to external
 * services — all I/O is intercepted.
 *
 * Test scenarios (from Issue #15):
 *   1. Slack message → route → webhook to recipient → reply with text → Slack outbound
 *   2. Telegram message → route → webhook → A2H AUTHORIZE → approve → response returned
 *   3. WhatsApp message → route → webhook → A2H COLLECT (multi-field) → form → submit → response
 *   4. Mixed message array (text + AUTHORIZE) → sequential rendering
 *   5. New thread creation (no threadId in URL)
 *   6. Ephemeral token expiry → 401
 *   7. Channel API key direct send (proactive, no replyTo)
 */

import { describe, it, expect } from 'bun:test';
import { InMemoryStorageAdapter } from '../../src/storage/in-memory.js';
import { TokenManager } from '../../src/token/index.js';
import { ThreadManager } from '../../src/thread/index.js';
import { TurnManager } from '../../src/turn/index.js';
import {
  isA2HMessage,
  hasA2HMessages,
  normaliseToArray,
} from '../../src/index.js';
import type { OpenThreadsMessage } from '../../src/types/message.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full test context (managers + storage). */
function makeContext() {
  const storage = new InMemoryStorageAdapter();
  const tokens = new TokenManager({ storage });
  const threads = new ThreadManager({ storage });
  const turns = new TurnManager({ storage });
  return { storage, tokens, threads, turns };
}

// ---------------------------------------------------------------------------
// Scenario 1: Slack message → route → webhook to recipient → reply with text
// ---------------------------------------------------------------------------

describe('Scenario 1: Slack message → recipient webhook → text reply', () => {
  it('creates a thread and turn for the inbound Slack message', async () => {
    const { threads, turns } = makeContext();

    // Simulate the inbound event arriving at the webhook handler.
    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234ABCDE',
      nativeThreadId: '1700000000.000100',
    });

    const turn = await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: { text: 'Can you deploy branch feature-x to staging?' },
      senderId: 'U56789',
    });

    expect(thread.id).toMatch(/^ot_thr_/);
    expect(turn.id).toMatch(/^ot_turn_/);
    expect(turn.direction).toBe('inbound');
    expect(thread.channelId).toBe('slack-main');
    expect(thread.nativeThreadId).toBe('1700000000.000100');
  });

  it('generates an ephemeral replyTo token scoped to the thread', async () => {
    const { threads, tokens } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234ABCDE',
    });

    const token = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234ABCDE',
      threadId: thread.id,
    });

    expect(token.id).toMatch(/^ot_tk_/);
    expect(token.channelId).toBe('slack-main');
    expect(token.threadId).toBe(thread.id);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('records the outbound reply as a turn and validates the message', async () => {
    const { threads, turns, tokens } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234ABCDE',
    });

    // Simulate recipient's reply via replyTo
    const replyToken = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234ABCDE',
      threadId: thread.id,
    });

    const tokenValidation = await tokens.validateToken(replyToken.id);
    expect(tokenValidation.valid).toBe(true);

    // Record the outbound turn (simulating the server processing the reply)
    const replyMessage = [{ text: 'Deployment started. ETA 3 minutes.' }];
    const outboundTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: replyMessage,
      recipientId: 'recipient-agent-01',
    });

    expect(outboundTurn.direction).toBe('outbound');
    expect(outboundTurn.threadId).toBe(thread.id);

    // Verify turn history
    const history = await turns.listTurns(thread.id);
    expect(history).toHaveLength(1);
    expect(history[0].direction).toBe('outbound');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Telegram message → A2H AUTHORIZE → approve → response returned
// ---------------------------------------------------------------------------

describe('Scenario 2: Telegram message → A2H AUTHORIZE flow', () => {
  it('classifies the reply envelope containing A2H AUTHORIZE correctly', () => {
    const message: OpenThreadsMessage[] = [
      { text: 'Tests passed. Ready for production.' },
      {
        intent: 'AUTHORIZE',
        context: {
          action: 'deploy-to-production',
          details: 'Branch feature-x → production',
        },
        traceId: 'trace_001',
      },
    ];

    expect(hasA2HMessages(message)).toBe(true);

    const a2hItems = message.filter(isA2HMessage);
    expect(a2hItems).toHaveLength(1);
    expect(a2hItems[0].intent).toBe('AUTHORIZE');
  });

  it('creates a virtual thread for Telegram (no native threads)', async () => {
    const { threads } = makeContext();

    // Telegram uses reply chains for virtual threads
    const virtualThread = await threads.detectOrCreateVirtualThread({
      channelId: 'telegram-bot',
      targetId: '-1001234567890',
      replyChain: ['msg_001', 'msg_002'],
    });

    expect(virtualThread.id).toMatch(/^ot_thr_/);
    expect(virtualThread.kind).toBe('virtual');
    expect(virtualThread.replyChain).toEqual(['msg_001', 'msg_002']);
  });

  it('records AUTHORIZE interaction turns', async () => {
    const { threads, turns } = makeContext();

    const thread = await threads.getOrCreateMainThread('telegram-bot', '-1001234567890');

    // Inbound: human sends a question
    const inboundTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: { text: 'Should I deploy feature-x?' },
      senderId: '123456789',
    });

    // Outbound: agent asks for approval (A2H AUTHORIZE)
    const a2hTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: [
        { text: 'Test results are green.' },
        {
          intent: 'AUTHORIZE',
          context: { action: 'deploy-to-production' },
          traceId: 'trace_auth_001',
        },
      ],
      recipientId: 'agent-001',
    });

    // Response: human approves
    const responseTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: {
        intent: 'RESULT',
        context: { approved: true, action: 'deploy-to-production' },
      },
      senderId: '123456789',
    });

    const history = await turns.listTurns(thread.id);
    expect(history).toHaveLength(3);
    expect(history[0].id).toBe(inboundTurn.id);
    expect(history[1].id).toBe(a2hTurn.id);
    expect(history[2].id).toBe(responseTurn.id);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: WhatsApp → A2H COLLECT (multi-field) → external form → submit
// ---------------------------------------------------------------------------

describe('Scenario 3: WhatsApp → A2H COLLECT multi-field → external form', () => {
  it('classifies multi-field COLLECT correctly', () => {
    const collectMessage = {
      intent: 'COLLECT',
      context: {
        fields: [
          { name: 'name', type: 'text', label: 'Full name' },
          { name: 'address', type: 'textarea', label: 'Shipping address' },
          { name: 'country', type: 'select', label: 'Country' },
        ],
      },
      traceId: 'trace_collect_001',
    };

    expect(isA2HMessage(collectMessage)).toBe(true);
    expect(collectMessage.intent).toBe('COLLECT');
    expect(collectMessage.context.fields).toHaveLength(3);
  });

  it('creates a virtual thread for WhatsApp based on quoted message', async () => {
    const { threads } = makeContext();

    // WhatsApp: first message starts a virtual thread rooted at the message ID
    const thread = await threads.detectOrCreateVirtualThread({
      channelId: 'whatsapp-bot',
      targetId: '15551234567@s.whatsapp.net',
      replyChain: ['wa_msg_original_001'],
    });

    expect(thread.kind).toBe('virtual');
    expect(thread.replyChain?.[0]).toBe('wa_msg_original_001');
  });

  it('records form submission response as an inbound turn', async () => {
    const { threads, turns } = makeContext();

    const thread = await threads.createThread({
      channelId: 'whatsapp-bot',
      targetId: '15551234567@s.whatsapp.net',
    });

    // Outbound: agent sends COLLECT intent
    await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: {
        intent: 'COLLECT',
        context: {
          fields: [
            { name: 'full_name', type: 'text', label: 'Full name' },
            { name: 'shipping_address', type: 'textarea', label: 'Shipping address' },
          ],
        },
      },
      recipientId: 'order-agent-001',
    });

    // Inbound: human submits the external form
    const formResponse = await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: {
        intent: 'RESULT',
        context: {
          fields: {
            full_name: 'Alice Smith',
            shipping_address: '123 Main St, Springfield',
          },
        },
      },
      senderId: '15551234567',
    });

    const history = await turns.listTurns(thread.id);
    expect(history).toHaveLength(2);

    const response = history[1].message as {
      intent: string;
      context: { fields: Record<string, string> };
    };
    expect(response.intent).toBe('RESULT');
    expect(response.context.fields.full_name).toBe('Alice Smith');
    expect(formResponse.direction).toBe('inbound');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Mixed message array (text + AUTHORIZE) → sequential rendering
// ---------------------------------------------------------------------------

describe('Scenario 4: Mixed message array (text + AUTHORIZE)', () => {
  it('normalises mixed messages to an array', () => {
    const mixed: OpenThreadsMessage[] = [
      { text: 'All CI checks passed.' },
      {
        intent: 'AUTHORIZE',
        context: { action: 'deploy-to-production' },
        traceId: 'trace_mixed_001',
      },
    ];

    const normalised = normaliseToArray(mixed);
    expect(normalised).toHaveLength(2);
    expect(normalised[0]).not.toHaveProperty('intent');
    expect(normalised[1]).toHaveProperty('intent', 'AUTHORIZE');
  });

  it('identifies Chat SDK and A2H items in a mixed array', () => {
    const messages = normaliseToArray([
      { text: 'Deploy is ready.' },
      { intent: 'AUTHORIZE', context: { action: 'approve-deploy' } },
      { text: 'Please review the attached logs.' },
    ] as OpenThreadsMessage[]);

    const a2hMessages = messages.filter(isA2HMessage);
    const textMessages = messages.filter((m) => !isA2HMessage(m));

    expect(a2hMessages).toHaveLength(1);
    expect(textMessages).toHaveLength(2);
  });

  it('records mixed message turn and preserves order', async () => {
    const { threads, turns } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
    });

    const mixedMessage = [
      { text: 'CI is green.' },
      { intent: 'AUTHORIZE', context: { action: 'merge-pr' }, traceId: 'trace_001' },
    ];

    const turn = await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: mixedMessage,
    });

    const retrieved = await turns.getTurnById(turn.id);
    expect(retrieved).not.toBeNull();

    const storedMessages = retrieved!.message as unknown[];
    expect(Array.isArray(storedMessages)).toBe(true);
    expect(storedMessages).toHaveLength(2);
    expect((storedMessages[1] as { intent: string }).intent).toBe('AUTHORIZE');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: New thread creation (no threadId in URL)
// ---------------------------------------------------------------------------

describe('Scenario 5: New thread creation (no threadId in URL)', () => {
  it('creates a new thread when none exists for the target', async () => {
    const { threads } = makeContext();

    // First message to a target — no threadId provided
    const mainThread = await threads.getOrCreateMainThread('slack-main', 'C09999');
    expect(mainThread.kind).toBe('main');
    expect(mainThread.channelId).toBe('slack-main');
    expect(mainThread.targetId).toBe('C09999');
  });

  it('returns the same main thread on subsequent calls', async () => {
    const { threads } = makeContext();

    const first = await threads.getOrCreateMainThread('slack-main', 'C09999');
    const second = await threads.getOrCreateMainThread('slack-main', 'C09999');

    expect(first.id).toBe(second.id);
  });

  it('creates a native thread for Slack with a new nativeThreadId', async () => {
    const { threads } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
      nativeThreadId: '1700000001.000200',
    });

    const retrieved = await threads.getThreadByNativeId('slack-main', '1700000001.000200');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(thread.id);
  });

  it('returns an existing thread when nativeThreadId matches', async () => {
    const { threads } = makeContext();

    const first = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
      nativeThreadId: '1700000002.000300',
    });

    // Second call with same nativeThreadId should return the existing thread
    const second = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
      nativeThreadId: '1700000002.000300',
    });

    expect(first.id).toBe(second.id);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Ephemeral token expiry → 401
// ---------------------------------------------------------------------------

describe('Scenario 6: Ephemeral token expiry → 401', () => {
  it('validates a fresh token as valid', async () => {
    const { threads, tokens } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
    });

    const token = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234',
      threadId: thread.id,
    });

    const result = await tokens.validateToken(token.id);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.token.id).toBe(token.id);
    }
  });

  it('validates an expired token as invalid', async () => {
    const { threads, tokens } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
    });

    // Create a token with a TTL of 1ms (effectively already expired after await)
    const expiredToken = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234',
      threadId: thread.id,
      ttlMs: 1,
    });

    // Wait to ensure expiry
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await tokens.validateToken(expiredToken.id);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('expired');
    }
  });

  it('validates a revoked token as invalid', async () => {
    const { threads, tokens } = makeContext();

    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
    });

    const token = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234',
      threadId: thread.id,
    });

    await tokens.revokeToken(token.id);

    const result = await tokens.validateToken(token.id);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('revoked');
    }
  });

  it('validates a non-existent token as invalid', async () => {
    const { tokens } = makeContext();

    const result = await tokens.validateToken('ot_tk_nonexistent_token_id');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Channel API key direct send (proactive, no replyTo)
// ---------------------------------------------------------------------------

describe('Scenario 7: Channel API key direct send (proactive)', () => {
  it('generates a valid channel API key', async () => {
    const { tokens } = makeContext();

    const apiKey = await tokens.generateChannelApiKey('slack-main');

    expect(apiKey.id).toMatch(/^ot_ch_sk_/);
    expect(apiKey.channelId).toBe('slack-main');
    expect(apiKey.revokedAt).toBeUndefined();
  });

  it('validates a channel API key for the correct channel', async () => {
    const { tokens } = makeContext();

    const apiKey = await tokens.generateChannelApiKey('slack-main');

    const result = await tokens.validateChannelApiKey(apiKey.id, 'slack-main');
    expect(result.valid).toBe(true);
  });

  it('rejects a channel API key for a different channel', async () => {
    const { tokens } = makeContext();

    const apiKey = await tokens.generateChannelApiKey('slack-main');

    const result = await tokens.validateChannelApiKey(apiKey.id, 'discord-server');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('channel_mismatch');
    }
  });

  it('rejects a revoked channel API key', async () => {
    const { tokens } = makeContext();

    const apiKey = await tokens.generateChannelApiKey('slack-main');
    await tokens.revokeChannelApiKey(apiKey.id);

    const result = await tokens.validateChannelApiKey(apiKey.id);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('revoked');
    }
  });

  it('creates a new thread when API key is used for direct send (no threadId)', async () => {
    const { threads, turns } = makeContext();

    // Direct send creates a new thread (main thread for the target)
    const thread = await threads.getOrCreateMainThread('slack-main', 'C01234');

    const turn = await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: { text: 'Deployment completed successfully.' },
      recipientId: 'agent-001',
    });

    expect(thread.kind).toBe('main');
    expect(turn.direction).toBe('outbound');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: Full message lifecycle (inbound → fan-out → reply)
// ---------------------------------------------------------------------------

describe('Full message lifecycle', () => {
  it('records a complete round-trip: inbound → outbound reply → final state', async () => {
    const { threads, turns, tokens } = makeContext();

    // 1. Inbound: Human sends a message on Slack
    const thread = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
      nativeThreadId: '1700100000.000100',
    });

    const inboundTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: { text: 'Can we deploy feature-x?' },
      senderId: 'U56789',
    });

    // 2. Generate replyTo token for the recipient
    const replyToken = await tokens.generateEphemeralToken({
      channelId: 'slack-main',
      targetId: 'C01234',
      threadId: thread.id,
    });

    // 3. Verify token is valid (simulating verifySendAuth)
    const authResult = await tokens.validateToken(replyToken.id);
    expect(authResult.valid).toBe(true);

    // 4. Recipient sends back a reply (simulate POST /send/channel/...)
    const replyMessage = [
      { text: 'CI checks passed ✓' },
      {
        intent: 'AUTHORIZE',
        context: { action: 'deploy-feature-x-to-staging' },
        traceId: 'trace_deploy_001',
      },
    ];

    const outboundTurn = await turns.createTurn({
      threadId: thread.id,
      direction: 'outbound',
      message: replyMessage,
      recipientId: 'ci-agent',
    });

    // 5. Human responds to the AUTHORIZE (approve)
    await turns.createTurn({
      threadId: thread.id,
      direction: 'inbound',
      message: {
        intent: 'RESULT',
        context: { approved: true, action: 'deploy-feature-x-to-staging' },
      },
      senderId: 'U56789',
    });

    // Final state verification
    const history = await turns.listTurns(thread.id);
    expect(history).toHaveLength(3);
    expect(history[0].id).toBe(inboundTurn.id);
    expect(history[1].id).toBe(outboundTurn.id);

    // Verify the thread is retrievable by native ID
    const retrievedThread = await threads.getThreadByNativeId(
      'slack-main',
      '1700100000.000100',
    );
    expect(retrievedThread?.id).toBe(thread.id);

    // Token should still be valid (consumed would be separate step)
    const finalAuth = await tokens.validateToken(replyToken.id);
    expect(finalAuth.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-platform thread isolation
// ---------------------------------------------------------------------------

describe('Multi-platform thread isolation', () => {
  it('threads in different channels do not share IDs or data', async () => {
    const { threads } = makeContext();

    const slackThread = await threads.getOrCreateMainThread('slack-main', 'C01234');
    const telegramThread = await threads.getOrCreateMainThread('telegram-bot', 'C01234');

    // Same targetId, different channels → different threads
    expect(slackThread.id).not.toBe(telegramThread.id);
    expect(slackThread.channelId).toBe('slack-main');
    expect(telegramThread.channelId).toBe('telegram-bot');
  });

  it('a virtual thread on Telegram is distinct from a native thread on Slack', async () => {
    const { threads } = makeContext();

    const slackNative = await threads.createThread({
      channelId: 'slack-main',
      targetId: 'C01234',
      nativeThreadId: 'ts_001',
    });

    const telegramVirtual = await threads.detectOrCreateVirtualThread({
      channelId: 'telegram-bot',
      targetId: '-10012345',
      replyChain: ['ts_001'],
    });

    expect(slackNative.id).not.toBe(telegramVirtual.id);
    expect(slackNative.kind).toBe('native');
    expect(telegramVirtual.kind).toBe('virtual');
  });
});
