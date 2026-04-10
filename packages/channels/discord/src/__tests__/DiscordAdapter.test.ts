/**
 * Integration-style tests for DiscordAdapter.
 *
 * We inject mock Client implementations to avoid real HTTP/WebSocket calls
 * while still exercising the adapter's full logic.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DiscordAdapter } from '../DiscordAdapter.js';
import type { DiscordAdapterConfig, DiscordClientLike, DiscordMessageLike } from '../DiscordAdapter.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => Promise<void> | void;

function createMockClient() {
  const eventHandlers: Record<string, EventHandler> = {};
  const sentMessages: Array<{
    channelId: string;
    content?: string;
    embeds?: unknown[];
    components?: unknown[];
  }> = [];
  const updatedMessages: Array<{
    embeds?: unknown[];
    components?: unknown[];
  }> = [];
  let msgIdCounter = 1000;

  const channels = new Map<string, {
    id: string;
    send: (opts: { content?: string; embeds?: unknown[]; components?: unknown[] }) => Promise<DiscordMessageLike>;
    isThread?: () => boolean;
    parentId?: string;
  }>();

  function makeChannel(id: string, isThread = false, parentId?: string) {
    const ch = {
      id,
      isThread: () => isThread,
      parentId,
      send: async (opts: { content?: string; embeds?: unknown[]; components?: unknown[] }) => {
        sentMessages.push({ channelId: id, ...opts });
        const msgId = `${++msgIdCounter}`;
        return {
          id: msgId,
          edit: async (editOpts: { content?: string; embeds?: unknown[]; components?: unknown[] }) => {
            updatedMessages.push(editOpts);
            return { id: msgId } as DiscordMessageLike;
          },
        } as DiscordMessageLike;
      },
    };
    channels.set(id, ch);
    return ch;
  }

  // Seed a default channel and a default thread
  makeChannel('CH-001');
  makeChannel('THREAD-001', true, 'CH-001');

  const client: DiscordClientLike = {
    login: async () => 'token',
    destroy: () => {},
    on: (event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[event] = handler as EventHandler;
      return client;
    },
    channels: {
      fetch: async (id: string) => channels.get(id) ?? null,
    },
    application: null,
  };

  /** Trigger a registered Discord event by name */
  const emit = async (event: string, ...args: unknown[]) => {
    const handler = eventHandlers[event];
    if (!handler) throw new Error(`No handler registered for "${event}"`);
    await handler(...args);
  };

  return { client, emit, sentMessages, updatedMessages, makeChannel };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const testConfig: DiscordAdapterConfig = {
  token: 'Bot test-token',
  baseUrl: 'https://ot.example.com',
};

function makeAdapter() {
  const mock = createMockClient();
  const adapter = new DiscordAdapter(testConfig, { client: mock.client });
  return { adapter, ...mock };
}

// ---------------------------------------------------------------------------
// Tests — capabilities
// ---------------------------------------------------------------------------

describe('DiscordAdapter — capabilities', () => {
  test('channelType is "discord"', () => {
    const { adapter } = makeAdapter();
    expect(adapter.channelType).toBe('discord');
  });

  test('reports correct capabilities', () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities).toEqual({
      threads: true,
      buttons: true,
      selectMenus: true,
      replyMessages: false,
      dms: true,
      fileUpload: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — send()
// ---------------------------------------------------------------------------

describe('DiscordAdapter — send()', () => {
  test('posts a text message to the channel', async () => {
    const { adapter, sentMessages } = makeAdapter();
    const result = await adapter.send({
      channelId: 'CH-001',
      targetId: 'U5678',
      message: { text: 'Hello, Discord!' },
    });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toBe('Hello, Discord!');
    expect(result.messageId).toBeDefined();
  });

  test('posts to a thread when threadId is provided', async () => {
    const { adapter, sentMessages } = makeAdapter();
    await adapter.send({
      channelId: 'CH-001',
      targetId: 'U5678',
      threadId: 'THREAD-001',
      message: { text: 'In a thread' },
    });
    expect(sentMessages[0]?.channelId).toBe('THREAD-001');
  });

  test('posts multiple items in sequence', async () => {
    const { adapter, sentMessages } = makeAdapter();
    await adapter.send({
      channelId: 'CH-001',
      targetId: 'U5678',
      message: [
        { text: 'First message' },
        { text: 'Second message' },
      ],
    });
    expect(sentMessages).toHaveLength(2);
  });

  test('sends INFORM A2H items as embeds', async () => {
    const { adapter, sentMessages } = makeAdapter();
    await adapter.send({
      channelId: 'CH-001',
      targetId: 'U5678',
      message: { intent: 'INFORM', id: 'i1', text: 'Heads up!' },
    });
    expect(sentMessages[0]?.embeds).toBeDefined();
    expect(sentMessages[0]?.embeds).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — sendA2H() INFORM
// ---------------------------------------------------------------------------

describe('DiscordAdapter — sendA2H() INFORM', () => {
  test('posts embed and returns INFORM response', async () => {
    const { adapter, sentMessages } = makeAdapter();
    const response = await adapter.sendA2H('CH-001', undefined, {
      intent: 'INFORM',
      id: 'inform-001',
      text: 'Deploy complete.',
    });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.embeds).toBeDefined();
    expect(response.intentId).toBe('inform-001');
    expect(response.type).toBe('INFORM');
  });

  test('posts to thread when threadId provided', async () => {
    const { adapter, sentMessages } = makeAdapter();
    await adapter.sendA2H('CH-001', 'THREAD-001', {
      intent: 'INFORM',
      id: 'inform-002',
      text: 'Step done.',
    });
    expect(sentMessages[0]?.channelId).toBe('THREAD-001');
  });
});

// ---------------------------------------------------------------------------
// Tests — sendA2H() AUTHORIZE
// ---------------------------------------------------------------------------

describe('DiscordAdapter — sendA2H() AUTHORIZE', () => {
  test('posts an embed with Approve and Deny buttons', async () => {
    const { adapter, sentMessages } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'CH-001',
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-001',
        context: { action: 'deploy-to-production', details: 'Branch feature-x' },
      },
      { timeoutMs: 50 },
    );

    // Message should be posted immediately
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.embeds).toBeDefined();
    expect(sentMessages[0]?.components).toBeDefined();
    const components = sentMessages[0]?.components as Array<{ type: number; components: Array<{ custom_id: string }> }>;
    const row = components?.[0];
    expect(row?.type).toBe(1); // ActionRow
    const btns = row?.components ?? [];
    expect(btns.some((b) => b.custom_id === 'a2h_approve_auth-001')).toBe(true);
    expect(btns.some((b) => b.custom_id === 'a2h_deny_auth-001')).toBe(true);

    // Times out when nobody clicks
    await expect(authPromise).rejects.toThrow('AUTHORIZE timeout');
  });

  test('resolves with approved=true when Approve button fires', async () => {
    const { adapter, emit } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'CH-001',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-002', context: { action: 'restart-service' } },
      { timeoutMs: 5000 },
    );

    // Simulate the Approve button click
    await emit('interactionCreate', {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isChatInputCommand: () => false,
      customId: 'a2h_approve_auth-002',
      update: async (opts: unknown) => { /* captured */ void opts; },
    });

    const response = await authPromise;
    expect(response.intentId).toBe('auth-002');
    expect(response.type).toBe('AUTHORIZE');
    expect(response.approved).toBe(true);
  });

  test('resolves with approved=false when Deny button fires', async () => {
    const { adapter, emit } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'CH-001',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-003', context: { action: 'delete-database' } },
      { timeoutMs: 5000 },
    );

    await emit('interactionCreate', {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isChatInputCommand: () => false,
      customId: 'a2h_deny_auth-003',
      update: async () => {},
    });

    const response = await authPromise;
    expect(response.approved).toBe(false);
  });

  test('updates the original message after approval (no components remain)', async () => {
    const { adapter, emit, updatedMessages, sentMessages } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'CH-001',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-004', context: { action: 'scale-up' } },
      { timeoutMs: 5000 },
    );

    const updated: Array<{ embeds?: unknown[]; components?: unknown[] }> = [];

    await emit('interactionCreate', {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isChatInputCommand: () => false,
      customId: 'a2h_approve_auth-004',
      update: async (opts: { embeds?: unknown[]; components?: unknown[] }) => {
        updated.push(opts);
      },
    });

    await authPromise;
    expect(updated).toHaveLength(1);
    expect(updated[0]?.components).toEqual([]);
    // Embed title should show Approved
    const embed = updated[0]?.embeds?.[0] as { title?: string } | undefined;
    expect(embed?.title).toContain('✅');
  });
});

// ---------------------------------------------------------------------------
// Tests — sendA2H() COLLECT (select menu)
// ---------------------------------------------------------------------------

describe('DiscordAdapter — sendA2H() COLLECT (select menu)', () => {
  const collectIntent = {
    intent: 'COLLECT' as const,
    id: 'collect-select-001',
    question: 'Which environment?',
    options: [
      { label: 'Staging', value: 'staging' },
      { label: 'Production', value: 'production' },
    ],
  };

  test('posts an embed with a select menu', async () => {
    const { adapter, sentMessages } = makeAdapter();

    const collectPromise = adapter.sendA2H('CH-001', undefined, collectIntent, {
      timeoutMs: 50,
    });

    expect(sentMessages).toHaveLength(1);
    const components = sentMessages[0]?.components as Array<{ type: number; components: Array<{ type: number; custom_id: string }> }>;
    const row = components?.[0];
    expect(row?.type).toBe(1); // ActionRow
    const select = row?.components?.[0];
    expect(select?.type).toBe(3); // StringSelect
    expect(select?.custom_id).toBe('a2h_collect_select_collect-select-001');

    await expect(collectPromise).rejects.toThrow('COLLECT select timeout');
  });

  test('resolves with selected value when select interaction fires', async () => {
    const { adapter, emit } = makeAdapter();

    const collectPromise = adapter.sendA2H('CH-001', undefined, collectIntent, {
      timeoutMs: 5000,
    });

    await emit('interactionCreate', {
      isButton: () => false,
      isStringSelectMenu: () => true,
      isChatInputCommand: () => false,
      customId: 'a2h_collect_select_collect-select-001',
      values: ['staging'],
      update: async () => {},
    });

    const response = await collectPromise;
    expect(response.intentId).toBe('collect-select-001');
    expect(response.type).toBe('COLLECT');
    expect(response.response).toBe('staging');
  });
});

// ---------------------------------------------------------------------------
// Tests — sendA2H() COLLECT (free-text)
// ---------------------------------------------------------------------------

describe('DiscordAdapter — sendA2H() COLLECT (free-text)', () => {
  test('posts a prompt and resolves when a thread message arrives', async () => {
    const { adapter, sentMessages, emit, makeChannel } = makeAdapter();

    // The thread is CH-001 scoped (threadId = 'THREAD-001', parentId = 'CH-001')
    const collectPromise = adapter.sendA2H(
      'CH-001',
      'THREAD-001',
      {
        intent: 'COLLECT',
        id: 'collect-text-001',
        question: 'What is the deployment reason?',
      },
      { timeoutMs: 5000 },
    );

    // Adapter posts the question
    expect(sentMessages[0]?.content).toContain('What is the deployment reason?');

    // Simulate a message from a user in that thread
    await emit('messageCreate', {
      id: 'msg-999',
      content: 'Fixing the auth bug',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'THREAD-001',
      channel: { id: 'THREAD-001', isThread: () => true, parentId: 'CH-001' },
    });

    const response = await collectPromise;
    expect(response.intentId).toBe('collect-text-001');
    expect(response.type).toBe('COLLECT');
    expect(response.response).toBe('Fixing the auth bug');
  });

  test('times out when no reply arrives', async () => {
    const { adapter } = makeAdapter();

    const collectPromise = adapter.sendA2H(
      'CH-001',
      'THREAD-001',
      { intent: 'COLLECT', id: 'collect-text-timeout', question: 'Why?' },
      { timeoutMs: 50 },
    );

    await expect(collectPromise).rejects.toThrow('COLLECT free-text timeout');
  });
});

// ---------------------------------------------------------------------------
// Tests — inbound messages
// ---------------------------------------------------------------------------

describe('DiscordAdapter — inbound messages', () => {
  test('dispatches a plain message to the registered handler', async () => {
    const { adapter, emit } = makeAdapter();

    const received: unknown[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await emit('messageCreate', {
      id: 'msg-100',
      content: 'Hello bot',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'CH-001',
      channel: { id: 'CH-001', isThread: () => false },
    });

    expect(received).toHaveLength(1);
    const env = received[0] as {
      source: { channel: string; channelId: string; sender: { id: string } };
      message: Array<{ text: string }>;
    };
    expect(env.source.channel).toBe('discord');
    expect(env.source.channelId).toBe('CH-001');
    expect(env.source.sender.id).toBe('U12345');
    expect(env.message[0]).toMatchObject({ text: 'Hello bot' });
  });

  test('uses channel ID as threadId for top-level messages', async () => {
    const { adapter, emit } = makeAdapter();
    const received: Array<{ threadId: string }> = [];
    adapter.onMessage(async (env) => { received.push(env as { threadId: string }); });

    await emit('messageCreate', {
      id: 'msg-200',
      content: 'Top level',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'CH-001',
      channel: { id: 'CH-001', isThread: () => false },
    });

    // For top-level messages (not a thread), threadId = messageId
    expect(received[0]?.threadId).toBe('msg-200');
  });

  test('uses thread channel ID as threadId for thread messages', async () => {
    const { adapter, emit } = makeAdapter();
    const received: Array<{ threadId: string }> = [];
    adapter.onMessage(async (env) => { received.push(env as { threadId: string }); });

    await emit('messageCreate', {
      id: 'msg-300',
      content: 'In a thread',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'THREAD-001',
      channel: { id: 'THREAD-001', isThread: () => true, parentId: 'CH-001' },
    });

    // For thread messages, threadId = Discord thread channel ID
    expect(received[0]?.threadId).toBe('THREAD-001');
  });

  test('ignores bot messages', async () => {
    const { adapter, emit } = makeAdapter();
    const received: unknown[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await emit('messageCreate', {
      id: 'msg-bot',
      content: 'I am a bot',
      author: { id: 'B999', username: 'mybot', bot: true },
      channelId: 'CH-001',
      channel: { id: 'CH-001', isThread: () => false },
    });

    expect(received).toHaveLength(0);
  });

  test('builds correct replyTo URL', async () => {
    const { adapter, emit } = makeAdapter();
    const received: Array<{ replyTo: string }> = [];
    adapter.onMessage(async (env) => { received.push(env as { replyTo: string }); });

    await emit('messageCreate', {
      id: 'msg-400',
      content: 'hi',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'CH-001',
      channel: { id: 'CH-001', isThread: () => false },
    });

    expect(received[0]?.replyTo).toContain('https://ot.example.com');
    expect(received[0]?.replyTo).toContain('CH-001');
  });

  test('does NOT dispatch free-text COLLECT capture to message handler', async () => {
    const { adapter, emit } = makeAdapter();

    // Start a free-text COLLECT — this sets up the thread listener
    const collectPromise = adapter.sendA2H(
      'CH-001',
      'THREAD-001',
      { intent: 'COLLECT', id: 'ct-dedup', question: 'Your input?' },
      { timeoutMs: 5000 },
    );

    const received: unknown[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    // Simulate a message in that thread — should resolve COLLECT, not dispatch
    await emit('messageCreate', {
      id: 'msg-500',
      content: 'My answer',
      author: { id: 'U12345', username: 'alice', bot: false },
      channelId: 'THREAD-001',
      channel: { id: 'THREAD-001', isThread: () => true, parentId: 'CH-001' },
    });

    const response = await collectPromise;
    expect(response.response).toBe('My answer');
    expect(received).toHaveLength(0); // NOT dispatched as a normal message
  });
});

// ---------------------------------------------------------------------------
// Tests — slash commands
// ---------------------------------------------------------------------------

describe('DiscordAdapter — slash commands', () => {
  test('dispatches slash command as inbound envelope', async () => {
    const { adapter, emit } = makeAdapter();
    const received: unknown[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await emit('interactionCreate', {
      isButton: () => false,
      isStringSelectMenu: () => false,
      isChatInputCommand: () => true,
      commandName: 'openthreads',
      channelId: 'CH-001',
      user: { id: 'U12345', username: 'alice' },
      options: { getString: () => 'status' },
      reply: async () => {},
    });

    expect(received).toHaveLength(1);
    const env = received[0] as { message: Array<{ text: string }>; source: { sender: { id: string } } };
    expect(env.message[0]).toMatchObject({ text: 'status' });
    expect(env.source.sender.id).toBe('U12345');
  });
});

// ---------------------------------------------------------------------------
// Tests — lifecycle
// ---------------------------------------------------------------------------

describe('DiscordAdapter — lifecycle', () => {
  test('initialize() and shutdown() complete without error', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.initialize()).resolves.toBeUndefined();
    expect(() => adapter.shutdown()).not.toThrow();
  });
});
