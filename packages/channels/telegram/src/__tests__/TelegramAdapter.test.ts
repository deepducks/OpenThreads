/**
 * Integration-style tests for TelegramAdapter.
 *
 * We inject a mock TelegramApiClient to avoid real HTTP calls while still
 * exercising the adapter's full logic: inbound message handling, outbound
 * sending, A2H inline interactions, and reply-capture flow.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { TelegramAdapter } from '../TelegramAdapter.js';
import type {
  TelegramAdapterConfig,
  TelegramAdapterDeps,
  TelegramUpdate,
} from '../TelegramAdapter.js';
import type { TelegramApiClientLike } from '../TelegramApiClient.js';
import type { InboundEnvelope } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface SentMessage {
  chat_id: string | number;
  text?: string;
  reply_to_message_id?: number;
  reply_markup?: unknown;
  [key: string]: unknown;
}

interface EditedMessage {
  chat_id: string | number;
  message_id: number;
  text?: string;
  [key: string]: unknown;
}

function createMockClient() {
  const sent: SentMessage[] = [];
  const edited: EditedMessage[] = [];
  const answered: { callback_query_id: string }[] = [];
  const webhooks: unknown[] = [];
  let msgCounter = 1000;

  const client: TelegramApiClientLike = {
    setWebhook: async (params) => {
      webhooks.push(params);
      return true;
    },
    deleteWebhook: async () => true,
    sendMessage: async (params) => {
      sent.push(params as SentMessage);
      return { message_id: ++msgCounter, chat: { id: params.chat_id } };
    },
    editMessageText: async (params) => {
      edited.push(params as EditedMessage);
      return { ok: true };
    },
    editMessageReplyMarkup: async () => ({ ok: true }),
    answerCallbackQuery: async (params) => {
      answered.push(params);
      return true;
    },
  };

  return {
    client,
    sent,
    edited,
    answered,
    webhooks,
    get lastMsgId() {
      return msgCounter;
    },
  };
}

function makeAdapter(extraConfig: Partial<TelegramAdapterConfig> = {}) {
  const mock = createMockClient();
  const config: TelegramAdapterConfig = {
    token: 'test:token',
    baseUrl: 'https://ot.example.com',
    ...extraConfig,
  };
  const deps: TelegramAdapterDeps = { client: mock.client };
  const adapter = new TelegramAdapter(config, deps);
  return { adapter, mock };
}

/** Builds a minimal TelegramUpdate for a plain message */
function messageUpdate(
  overrides: Partial<{
    updateId: number;
    messageId: number;
    chatId: number;
    userId: number;
    firstName: string;
    text: string;
    replyToMessageId: number;
    isBot: boolean;
  }> = {},
): TelegramUpdate {
  const o = {
    updateId: 1,
    messageId: 42,
    chatId: 100,
    userId: 999,
    firstName: 'Alice',
    text: 'Hello',
    isBot: false,
    ...overrides,
  };
  return {
    update_id: o.updateId,
    message: {
      message_id: o.messageId,
      from: { id: o.userId, first_name: o.firstName, is_bot: o.isBot },
      chat: { id: o.chatId, type: 'private' },
      date: 1000000,
      text: o.text,
      ...(o.replyToMessageId !== undefined
        ? { reply_to_message: { message_id: o.replyToMessageId } }
        : {}),
    },
  };
}

/** Builds a callback query update */
function callbackUpdate(opts: {
  updateId?: number;
  queryId?: string;
  userId?: number;
  chatId?: number;
  messageId?: number;
  data: string;
}): TelegramUpdate {
  const o = { updateId: 50, queryId: 'cq1', userId: 999, chatId: 100, messageId: 1001, ...opts };
  return {
    update_id: o.updateId,
    callback_query: {
      id: o.queryId,
      from: { id: o.userId },
      message: {
        message_id: o.messageId,
        chat: { id: o.chatId, type: 'private' },
        date: 1000001,
      },
      data: o.data,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramAdapter — initialize()', () => {
  test('calls setWebhook when webhookUrl is provided', async () => {
    const { adapter, mock } = makeAdapter({
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'my-secret',
    });
    await adapter.initialize();
    expect(mock.webhooks.length).toBe(1);
    expect((mock.webhooks[0] as { url: string }).url).toBe('https://example.com/webhook');
    expect((mock.webhooks[0] as { secret_token?: string }).secret_token).toBe('my-secret');
  });

  test('does NOT call setWebhook when webhookUrl is absent', async () => {
    const { adapter, mock } = makeAdapter();
    await adapter.initialize();
    expect(mock.webhooks.length).toBe(0);
  });
});

describe('TelegramAdapter — shutdown()', () => {
  test('resolves without error', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});

describe('TelegramAdapter — capabilities', () => {
  test('threads: false', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.threads).toBe(false);
  });

  test('buttons: true', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.buttons).toBe(true);
  });

  test('selectMenus: false', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.selectMenus).toBe(false);
  });

  test('replyMessages: true', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.replyMessages).toBe(true);
  });

  test('dms: true', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.dms).toBe(true);
  });

  test('fileUpload: true', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.fileUpload).toBe(true);
  });
});

describe('TelegramAdapter — send()', () => {
  test('sends a plain text message', async () => {
    const { adapter, mock } = makeAdapter();
    const result = await adapter.send({ channelId: '100', message: { text: 'Hello world' } });
    expect(mock.sent.length).toBe(1);
    expect(mock.sent[0].text).toBe('Hello world');
    expect(result.messageId).toBeDefined();
  });

  test('returns a string messageId', async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.send({ channelId: '100', message: { text: 'Hi' } });
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  test('includes reply_to_message_id when threadId provided', async () => {
    const { adapter, mock } = makeAdapter();
    await adapter.send({ channelId: '100', threadId: '42', message: { text: 'In thread' } });
    expect(mock.sent[0].reply_to_message_id).toBe(42);
  });

  test('sends INFORM intent as plain text', async () => {
    const { adapter, mock } = makeAdapter();
    await adapter.send({
      channelId: '100',
      message: { intent: 'INFORM', id: 'i1', text: 'FYI: task done' },
    });
    expect(mock.sent.length).toBe(1);
    expect(mock.sent[0].text).toBe('FYI: task done');
  });

  test('processes multiple message items sequentially', async () => {
    const { adapter, mock } = makeAdapter();
    await adapter.send({
      channelId: '100',
      message: [{ text: 'first' }, { text: 'second' }],
    });
    expect(mock.sent.length).toBe(2);
    expect(mock.sent[0].text).toBe('first');
    expect(mock.sent[1].text).toBe('second');
  });
});

describe('TelegramAdapter — handleUpdate() — inbound messages', () => {
  test('dispatches to onMessage handler', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate());

    expect(envelopes.length).toBe(1);
    expect(envelopes[0].source.channel).toBe('telegram');
  });

  test('envelope has correct channelId (chat ID)', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ chatId: 777 }));

    expect(envelopes[0].source.channelId).toBe('777');
  });

  test('envelope sender.id is the Telegram user ID', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ userId: 12345 }));

    expect(envelopes[0].source.sender.id).toBe('12345');
  });

  test('envelope sender.name is derived from first_name', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ firstName: 'Bob' }));

    expect(envelopes[0].source.sender.name).toBe('Bob');
  });

  test('envelope message[0].text matches message text', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ text: 'Testing 123' }));

    const msg = envelopes[0].message;
    const items = Array.isArray(msg) ? msg : [msg];
    expect((items[0] as { text: string }).text).toBe('Testing 123');
  });

  test('threadId is messageId for top-level messages', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ messageId: 55 }));

    expect(envelopes[0].threadId).toBe('55');
  });

  test('threadId is reply_to_message_id for reply messages (virtual thread)', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ messageId: 56, replyToMessageId: 40 }));

    expect(envelopes[0].threadId).toBe('40');
  });

  test('does not dispatch when no handler registered', async () => {
    const { adapter } = makeAdapter();
    // No onMessage call — should not throw
    await expect(adapter.handleUpdate(messageUpdate())).resolves.toBeUndefined();
  });

  test('ignores bot messages', async () => {
    const { adapter } = makeAdapter();
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ isBot: true }));

    expect(envelopes.length).toBe(0);
  });

  test('replyTo URL includes chatId and threadId', async () => {
    const { adapter } = makeAdapter({ baseUrl: 'https://ot.example.com' });
    const envelopes: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { envelopes.push(env); });

    await adapter.handleUpdate(messageUpdate({ chatId: 999, messageId: 77 }));

    expect(envelopes[0].replyTo).toContain('/target/999/thread/77');
  });
});

describe('TelegramAdapter — sendA2H() — AUTHORIZE', () => {
  test('sends message with 2-button inline keyboard', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'AUTHORIZE',
      id: 'auth-1',
      context: { action: 'deploy to prod' },
    }, { timeoutMs: 50 });

    // Allow the async send to complete
    await new Promise((r) => setTimeout(r, 5));

    expect(mock.sent.length).toBe(1);
    const kb = (mock.sent[0].reply_markup as {
      inline_keyboard?: { text: string; callback_data: string }[][];
    });
    expect(kb.inline_keyboard?.length).toBe(1);
    expect(kb.inline_keyboard?.[0].length).toBe(2);

    await expect(p).rejects.toThrow(); // timeout
  });

  test('resolves approved=true on ✅ Approve callback', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'AUTHORIZE',
      id: 'auth-2',
      context: { action: 'restart' },
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      chatId: 100, messageId: msgId, data: 'a2h:auth-2:approve',
    }));

    const result = await p;
    expect(result.intentId).toBe('auth-2');
    expect(result.type).toBe('AUTHORIZE');
    expect(result.approved).toBe(true);
  });

  test('resolves approved=false on ❌ Deny callback', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'AUTHORIZE',
      id: 'auth-3',
      context: { action: 'delete db' },
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      chatId: 100, messageId: msgId, data: 'a2h:auth-3:deny',
    }));

    const result = await p;
    expect(result.approved).toBe(false);
  });

  test('edits original message after resolution', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'AUTHORIZE',
      id: 'auth-4',
      context: { action: 'scale up' },
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      chatId: 100, messageId: msgId, data: 'a2h:auth-4:approve',
    }));
    await p;

    expect(mock.edited.length).toBe(1);
    expect(mock.edited[0].text).toContain('Approved');
    expect(mock.edited[0].text).toContain('scale up');
  });

  test('times out and rejects', async () => {
    const { adapter } = makeAdapter();
    await expect(
      adapter.sendA2H('100', undefined, {
        intent: 'AUTHORIZE', id: 'auth-timeout', context: { action: 'x' },
      }, { timeoutMs: 30 }),
    ).rejects.toThrow('AUTHORIZE timeout');
  });

  test('sends with reply_to_message_id when threadId provided', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', '77', {
      intent: 'AUTHORIZE', id: 'auth-5', context: { action: 'y' },
    }, { timeoutMs: 30 });

    await new Promise((r) => setTimeout(r, 5));
    expect(mock.sent[0].reply_to_message_id).toBe(77);
    await expect(p).rejects.toThrow();
  });

  test('answers callback query to clear loading state', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'AUTHORIZE', id: 'auth-6', context: { action: 'z' },
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      queryId: 'qtest', chatId: 100, messageId: msgId, data: 'a2h:auth-6:approve',
    }));
    await p;

    expect(mock.answered.length).toBe(1);
    expect(mock.answered[0].callback_query_id).toBe('qtest');
  });
});

describe('TelegramAdapter — sendA2H() — COLLECT (select)', () => {
  test('sends inline keyboard with one button per option', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'COLLECT',
      id: 'col-1',
      question: 'Pick env',
      options: [
        { label: 'Staging', value: 'staging' },
        { label: 'Production', value: 'prod' },
      ],
    }, { timeoutMs: 30 });

    await new Promise((r) => setTimeout(r, 5));
    const kb = (mock.sent[0].reply_markup as {
      inline_keyboard?: { text: string; callback_data: string }[][];
    });
    // 2 options fit in 1 row of 2
    expect(kb.inline_keyboard?.length).toBe(1);
    expect(kb.inline_keyboard?.[0].length).toBe(2);
    await expect(p).rejects.toThrow();
  });

  test('resolves with selected value', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'COLLECT',
      id: 'col-2',
      question: 'Select region',
      options: [{ label: 'US East', value: 'us-east-1' }],
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      chatId: 100, messageId: msgId, data: 'a2h:col-2:us-east-1',
    }));

    const result = await p;
    expect(result.type).toBe('COLLECT');
    expect(result.response).toBe('us-east-1');
  });

  test('times out when no selection made', async () => {
    const { adapter } = makeAdapter();
    await expect(
      adapter.sendA2H('100', undefined, {
        intent: 'COLLECT', id: 'col-timeout', question: 'Q',
        options: [{ label: 'A', value: 'a' }],
      }, { timeoutMs: 30 }),
    ).rejects.toThrow('COLLECT select timeout');
  });

  test('edits original message with selection result', async () => {
    const { adapter, mock } = makeAdapter();
    const p = adapter.sendA2H('100', undefined, {
      intent: 'COLLECT',
      id: 'col-3',
      question: 'Choose',
      options: [{ label: 'Alpha', value: 'alpha' }],
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const msgId = mock.lastMsgId;

    await adapter.handleUpdate(callbackUpdate({
      chatId: 100, messageId: msgId, data: 'a2h:col-3:alpha',
    }));
    await p;

    expect(mock.edited.length).toBe(1);
    expect(mock.edited[0].text).toContain('alpha');
  });
});

describe('TelegramAdapter — sendA2H() — COLLECT (free-text)', () => {
  test('resolves when a reply to the COLLECT message arrives', async () => {
    const { adapter, mock } = makeAdapter();
    adapter.onMessage(async () => {}); // Register to avoid no-op path

    const p = adapter.sendA2H('100', undefined, {
      intent: 'COLLECT',
      id: 'ft-1',
      question: 'What is your name?',
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const collectMsgId = mock.lastMsgId;

    // Simulate a reply to the COLLECT message
    await adapter.handleUpdate(messageUpdate({
      messageId: collectMsgId + 1,
      chatId: 100,
      userId: 42,
      firstName: 'Dave',
      text: 'Dave Smith',
      replyToMessageId: collectMsgId,
    }));

    const result = await p;
    expect(result.type).toBe('COLLECT');
    expect(result.response).toBe('Dave Smith');
  });

  test('intercepted reply is NOT dispatched to onMessage handler', async () => {
    const { adapter, mock } = makeAdapter();
    const dispatched: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { dispatched.push(env); });

    const p = adapter.sendA2H('100', undefined, {
      intent: 'COLLECT', id: 'ft-2', question: 'Color?',
    }, { timeoutMs: 2000 });

    await new Promise((r) => setTimeout(r, 5));
    const collectMsgId = mock.lastMsgId;

    await adapter.handleUpdate(messageUpdate({
      messageId: collectMsgId + 1,
      chatId: 100,
      text: 'Blue',
      replyToMessageId: collectMsgId,
    }));
    await p;

    // The reply was consumed by COLLECT — handler should NOT see it
    expect(dispatched.length).toBe(0);
  });

  test('times out when no reply arrives', async () => {
    const { adapter } = makeAdapter();
    await expect(
      adapter.sendA2H('100', undefined, {
        intent: 'COLLECT', id: 'ft-timeout', question: 'Tell me',
      }, { timeoutMs: 30 }),
    ).rejects.toThrow('COLLECT free-text timeout');
  });
});

describe('TelegramAdapter — sendA2H() — INFORM', () => {
  test('sends message and resolves immediately', async () => {
    const { adapter, mock } = makeAdapter();
    const result = await adapter.sendA2H('100', undefined, {
      intent: 'INFORM', id: 'inf-1', text: 'Task completed!',
    });
    expect(mock.sent.length).toBe(1);
    expect(mock.sent[0].text).toBe('Task completed!');
    expect(result.intentId).toBe('inf-1');
    expect(result.type).toBe('INFORM');
  });

  test('resolves without blocking', async () => {
    const { adapter } = makeAdapter();
    // No timeout — INFORM must resolve immediately
    const result = await Promise.race([
      adapter.sendA2H('100', undefined, { intent: 'INFORM', id: 'inf-2', text: 'Hi' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 100)),
    ]);
    expect(result.type).toBe('INFORM');
  });
});

describe('TelegramAdapter — callback with unknown intentId', () => {
  test('is silently ignored', async () => {
    const { adapter, mock } = makeAdapter();
    adapter.onMessage(async () => {});

    // Callback for an intentId that was never registered
    await expect(
      adapter.handleUpdate(callbackUpdate({ data: 'a2h:nonexistent:approve' })),
    ).resolves.toBeUndefined();

    // Nothing should have been sent or edited
    expect(mock.edited.length).toBe(0);
  });
});
