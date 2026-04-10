/**
 * Integration-style tests for SlackAdapter.
 *
 * We inject mock App and WebClient implementations to avoid real HTTP calls
 * while still exercising the adapter's full logic.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { SlackAdapter } from '../SlackAdapter.js';
import type { SlackAdapterConfig } from '../SlackAdapter.js';
import type { InboundEnvelope } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type Handler = (args: Record<string, unknown>) => Promise<void>;

function createMockApp() {
  const handlers: Record<string, Handler> = {};

  return {
    app: {
      message: (handler: Handler) => {
        handlers['message'] = handler;
      },
      event: (name: string, handler: Handler) => {
        handlers[`event:${name}`] = handler;
      },
      command: (name: string, handler: Handler) => {
        handlers[`command:${name}`] = handler;
      },
      action: (name: string, handler: Handler) => {
        handlers[`action:${name}`] = handler;
      },
      start: async (_port?: number) => {},
      stop: async () => {},
    } as unknown as import('@slack/bolt').App,

    /** Trigger a registered handler by event key */
    trigger: async (key: string, args: Record<string, unknown>) => {
      const handler = handlers[key];
      if (!handler) throw new Error(`No handler registered for "${key}"`);
      await handler(args);
    },

    handlers,
  };
}

interface PostedMessage {
  channel: string;
  thread_ts?: string;
  text?: string;
  blocks?: unknown[];
  mrkdwn?: boolean;
}

interface UpdatedMessage {
  channel: string;
  ts: string;
  text?: string;
  blocks?: unknown[];
}

function createMockClient() {
  const posted: PostedMessage[] = [];
  const updated: UpdatedMessage[] = [];
  let tsCounter = 1000;

  return {
    client: {
      chat: {
        postMessage: async (opts: PostedMessage) => {
          posted.push(opts);
          return { ok: true, ts: `${++tsCounter}.000100` };
        },
        update: async (opts: UpdatedMessage) => {
          updated.push(opts);
          return { ok: true };
        },
      },
      users: {
        info: async ({ user }: { user: string }) => ({
          ok: true,
          user: { id: user, name: `user_${user}`, real_name: `User ${user}` },
        }),
      },
    } as unknown as import('@slack/web-api').WebClient,
    posted,
    updated,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const testConfig: SlackAdapterConfig = {
  token: 'xoxb-test',
  signingSecret: 'test-secret',
  baseUrl: 'https://ot.example.com',
};

function makeAdapter() {
  const mockApp = createMockApp();
  const mockClient = createMockClient();
  const adapter = new SlackAdapter(testConfig, {
    app: mockApp.app,
    client: mockClient.client,
  });
  return { adapter, mockApp, mockClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackAdapter — capabilities', () => {
  test('channelType is "slack"', () => {
    const { adapter } = makeAdapter();
    expect(adapter.channelType).toBe('slack');
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

describe('SlackAdapter — send()', () => {
  test('posts a text message', async () => {
    const { adapter, mockClient } = makeAdapter();
    const result = await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      message: { text: 'Hello, world!' },
    });
    expect(mockClient.posted).toHaveLength(1);
    expect(mockClient.posted[0]?.channel).toBe('C01234');
    expect(mockClient.posted[0]?.text).toBe('Hello, world!');
    expect(result.messageId).toBeDefined();
  });

  test('posts to a thread when threadId is provided', async () => {
    const { adapter, mockClient } = makeAdapter();
    await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      threadId: '9876543210.000001',
      message: { text: 'In a thread' },
    });
    expect(mockClient.posted[0]?.thread_ts).toBe('9876543210.000001');
  });

  test('posts multiple items in sequence', async () => {
    const { adapter, mockClient } = makeAdapter();
    await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      message: [
        { text: 'First message' },
        { text: 'Second message' },
      ],
    });
    expect(mockClient.posted).toHaveLength(2);
  });

  test('sends INFORM A2H items as plain text', async () => {
    const { adapter, mockClient } = makeAdapter();
    await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      message: { intent: 'INFORM', id: 'i1', text: 'Heads up!' },
    });
    expect(mockClient.posted[0]?.text).toBe('Heads up!');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — sendA2H() INFORM', () => {
  test('posts text and returns INFORM response', async () => {
    const { adapter, mockClient } = makeAdapter();
    const response = await adapter.sendA2H('C01234', undefined, {
      intent: 'INFORM',
      id: 'inform-001',
      text: 'Deploy complete.',
    });
    expect(mockClient.posted).toHaveLength(1);
    expect(mockClient.posted[0]?.text).toBe('Deploy complete.');
    expect(response.intentId).toBe('inform-001');
    expect(response.type).toBe('INFORM');
  });

  test('posts to thread when threadId provided', async () => {
    const { adapter, mockClient } = makeAdapter();
    await adapter.sendA2H('C01234', '1234.000001', {
      intent: 'INFORM',
      id: 'inform-002',
      text: 'Step done.',
    });
    expect(mockClient.posted[0]?.thread_ts).toBe('1234.000001');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — sendA2H() AUTHORIZE', () => {
  test('posts a Block Kit message with Approve and Deny buttons', async () => {
    const { adapter, mockClient } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'C01234',
      undefined,
      {
        intent: 'AUTHORIZE',
        id: 'auth-001',
        context: { action: 'deploy-to-production', details: 'Branch feature-x' },
      },
      { timeoutMs: 50 },
    );

    // Message should be posted immediately
    expect(mockClient.posted).toHaveLength(1);
    expect(mockClient.posted[0]?.blocks).toBeDefined();
    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b['type'] === 'actions');
    expect(actionsBlock).toBeDefined();
    const elements = actionsBlock?.['elements'] as Array<Record<string, unknown>>;
    expect(elements.some((e) => e['action_id'] === 'a2h_approve')).toBe(true);
    expect(elements.some((e) => e['action_id'] === 'a2h_deny')).toBe(true);

    // Promise should eventually time out (no one clicks)
    await expect(authPromise).rejects.toThrow('AUTHORIZE timeout');
  });

  test('resolves with approved=true when Approve action fires', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'C01234',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-002', context: { action: 'restart-service' } },
      { timeoutMs: 5000 },
    );

    // Simulate the Approve button click
    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b['type'] === 'actions') as Record<string, unknown>;
    const blockId = actionsBlock?.['block_id'] as string;

    await mockApp.trigger('action:a2h_approve', {
      action: { action_id: 'a2h_approve', value: 'approve', block_id: blockId },
      body: {
        actions: [{ action_id: 'a2h_approve', value: 'approve', block_id: blockId }],
        channel: { id: 'C01234' },
        message: { ts: '1001.000100' },
      },
      ack: async () => {},
    });

    const response = await authPromise;
    expect(response.intentId).toBe('auth-002');
    expect(response.type).toBe('AUTHORIZE');
    expect(response.approved).toBe(true);
  });

  test('resolves with approved=false when Deny action fires', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'C01234',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-003', context: { action: 'delete-database' } },
      { timeoutMs: 5000 },
    );

    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b['type'] === 'actions') as Record<string, unknown>;
    const blockId = actionsBlock?.['block_id'] as string;

    await mockApp.trigger('action:a2h_deny', {
      action: { action_id: 'a2h_deny', value: 'deny', block_id: blockId },
      body: {
        actions: [{ action_id: 'a2h_deny', value: 'deny', block_id: blockId }],
        channel: { id: 'C01234' },
        message: { ts: '1001.000100' },
      },
      ack: async () => {},
    });

    const response = await authPromise;
    expect(response.approved).toBe(false);
  });

  test('updates the original message after resolution', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    const authPromise = adapter.sendA2H(
      'C01234',
      undefined,
      { intent: 'AUTHORIZE', id: 'auth-004', context: { action: 'scale-up' } },
      { timeoutMs: 5000 },
    );

    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const actionsBlock = blocks.find((b) => b['type'] === 'actions') as Record<string, unknown>;
    const blockId = actionsBlock?.['block_id'] as string;

    await mockApp.trigger('action:a2h_approve', {
      action: { action_id: 'a2h_approve', value: 'approve', block_id: blockId },
      body: {
        actions: [{ action_id: 'a2h_approve', value: 'approve', block_id: blockId }],
        channel: { id: 'C01234' },
        message: { ts: '1001.000100' },
      },
      ack: async () => {},
    });

    await authPromise;
    expect(mockClient.updated).toHaveLength(1);
    expect(mockClient.updated[0]?.text).toContain('✅');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — sendA2H() COLLECT (select menu)', () => {
  const collectIntent = {
    intent: 'COLLECT' as const,
    id: 'collect-select-001',
    question: 'Which environment?',
    options: [
      { label: 'Staging', value: 'staging' },
      { label: 'Production', value: 'production' },
    ],
  };

  test('posts a select-menu Block Kit message', async () => {
    const { adapter, mockClient } = makeAdapter();

    const collectPromise = adapter.sendA2H('C01234', undefined, collectIntent, {
      timeoutMs: 50,
    });

    expect(mockClient.posted).toHaveLength(1);
    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const section = blocks.find((b) => b['type'] === 'section') as Record<string, unknown>;
    const accessory = section?.['accessory'] as Record<string, unknown>;
    expect(accessory?.['type']).toBe('static_select');

    await expect(collectPromise).rejects.toThrow('COLLECT select timeout');
  });

  test('resolves with selected value when action fires', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    const collectPromise = adapter.sendA2H('C01234', undefined, collectIntent, {
      timeoutMs: 5000,
    });

    const blocks = mockClient.posted[0]?.blocks as Array<Record<string, unknown>>;
    const section = blocks.find((b) => b['type'] === 'section') as Record<string, unknown>;
    const blockId = section?.['block_id'] as string;

    await mockApp.trigger('action:a2h_collect_select', {
      action: {
        action_id: 'a2h_collect_select',
        block_id: blockId,
        selected_option: { value: 'staging', text: { text: 'Staging' } },
      },
      body: {
        actions: [{ action_id: 'a2h_collect_select', block_id: blockId }],
        channel: { id: 'C01234' },
        message: { ts: '1001.000100' },
      },
      ack: async () => {},
    });

    const response = await collectPromise;
    expect(response.intentId).toBe('collect-select-001');
    expect(response.type).toBe('COLLECT');
    expect(response.response).toBe('staging');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — sendA2H() COLLECT (free-text)', () => {
  test('posts a prompt and resolves when a thread reply arrives', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    const collectPromise = adapter.sendA2H(
      'C01234',
      '9876543210.000001',
      {
        intent: 'COLLECT',
        id: 'collect-text-001',
        question: 'What is the deployment reason?',
      },
      { timeoutMs: 5000 },
    );

    // Adapter posts the question
    expect(mockClient.posted[0]?.text).toContain('What is the deployment reason?');

    // Simulate a thread reply from the human
    await mockApp.trigger('message', {
      message: {
        user: 'U99999',
        text: 'Fixing the auth bug',
        ts: '9876543210.000200',
        thread_ts: '9876543210.000001',
        channel: 'C01234',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    const response = await collectPromise;
    expect(response.intentId).toBe('collect-text-001');
    expect(response.type).toBe('COLLECT');
    expect(response.response).toBe('Fixing the auth bug');
  });

  test('times out when no reply arrives', async () => {
    const { adapter } = makeAdapter();

    const collectPromise = adapter.sendA2H(
      'C01234',
      '1111.000001',
      { intent: 'COLLECT', id: 'collect-text-timeout', question: 'Why?' },
      { timeoutMs: 50 },
    );

    await expect(collectPromise).rejects.toThrow('COLLECT free-text timeout');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — inbound messages', () => {
  test('dispatches a plain message to the registered handler', async () => {
    const { adapter, mockApp } = makeAdapter();

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('message', {
      message: {
        user: 'U12345',
        text: 'Hello bot',
        ts: '1234567890.000100',
        channel: 'C01234',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    expect(received).toHaveLength(1);
    const env = received[0]!;
    expect(env.source.channel).toBe('slack');
    expect(env.source.channelId).toBe('C01234');
    expect(env.source.sender.id).toBe('U12345');
    expect(env.message[0]).toMatchObject({ text: 'Hello bot' });
  });

  test('sets threadId to message ts for top-level messages', async () => {
    const { adapter, mockApp } = makeAdapter();
    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('message', {
      message: {
        user: 'U12345',
        text: 'Top level',
        ts: '1000000001.000100',
        channel: 'C01234',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    expect(received[0]?.threadId).toBe('1000000001.000100');
  });

  test('sets threadId to thread_ts for thread replies', async () => {
    const { adapter, mockApp } = makeAdapter();
    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('message', {
      message: {
        user: 'U12345',
        text: 'Reply in thread',
        ts: '1000000002.000200',
        thread_ts: '1000000001.000100',
        channel: 'C01234',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    expect(received[0]?.threadId).toBe('1000000001.000100');
  });

  test('ignores bot messages', async () => {
    const { adapter, mockApp } = makeAdapter();
    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('message', {
      message: {
        bot_id: 'B999',
        text: 'I am a bot',
        ts: '9999.000100',
        channel: 'C01234',
      },
      ack: async () => {},
    });

    expect(received).toHaveLength(0);
  });

  test('builds correct replyTo URL', async () => {
    const { adapter, mockApp } = makeAdapter();
    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('message', {
      message: {
        user: 'U12345',
        text: 'hi',
        ts: '1234567890.000100',
        channel: 'CABC123',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    expect(received[0]?.replyTo).toContain('https://ot.example.com');
    expect(received[0]?.replyTo).toContain('CABC123');
  });

  test('does NOT dispatch free-text COLLECT capture to message handler', async () => {
    const { adapter, mockClient, mockApp } = makeAdapter();

    // Start a free-text COLLECT — this sets up the thread listener
    const collectPromise = adapter.sendA2H(
      'C01234',
      '9000.000001',
      { intent: 'COLLECT', id: 'ct-dedup', question: 'Your input?' },
      { timeoutMs: 5000 },
    );

    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    // Simulate a thread reply — should resolve the COLLECT, not dispatch
    await mockApp.trigger('message', {
      message: {
        user: 'U12345',
        text: 'My answer',
        ts: '9000.000200',
        thread_ts: '9000.000001',
        channel: 'C01234',
        bot_id: undefined,
      },
      ack: async () => {},
    });

    const response = await collectPromise;
    expect(response.response).toBe('My answer');
    expect(received).toHaveLength(0); // NOT dispatched as a normal message
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — slash commands', () => {
  test('dispatches slash command as inbound envelope', async () => {
    const { adapter, mockApp } = makeAdapter();
    const received: InboundEnvelope[] = [];
    adapter.onMessage(async (env) => { received.push(env); });

    await mockApp.trigger('command:/openthreads', {
      command: {
        user_id: 'U12345',
        user_name: 'alice',
        channel_id: 'C01234',
        text: 'status',
        trigger_id: 'trigger_abc',
      },
      ack: async () => {},
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.message[0]).toMatchObject({ text: 'status' });
    expect(received[0]?.source.sender.id).toBe('U12345');
  });
});

// ---------------------------------------------------------------------------

describe('SlackAdapter — lifecycle', () => {
  test('initialize() and shutdown() complete without error', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.initialize()).resolves.toBeUndefined();
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});
