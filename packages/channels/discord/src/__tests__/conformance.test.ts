/**
 * Shared adapter conformance tests for DiscordAdapter.
 *
 * Verifies the adapter correctly implements the ChannelAdapter interface
 * contract without relying on Discord-specific details.
 */
import { describe, test, expect } from 'bun:test';
import { DiscordAdapter } from '../DiscordAdapter.js';
import type { DiscordClientLike } from '../DiscordAdapter.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function createMockClient(): DiscordClientLike {
  let msgId = 9000;
  const channels = new Map<string, {
    id: string;
    isThread: () => boolean;
    send: (opts: unknown) => Promise<{ id: string; edit: () => Promise<{ id: string }> }>;
  }>();

  channels.set('C01234', {
    id: 'C01234',
    isThread: () => false,
    send: async () => ({ id: `${++msgId}`, edit: async () => ({ id: `${msgId}` }) }),
  });
  channels.set('T01234', {
    id: 'T01234',
    isThread: () => true,
    send: async () => ({ id: `${++msgId}`, edit: async () => ({ id: `${msgId}` }) }),
  });

  return {
    login: async () => 'token',
    destroy: () => {},
    on: function (this: DiscordClientLike) { return this; },
    channels: {
      fetch: async (id: string) => channels.get(id) ?? null,
    },
    application: null,
  };
}

function makeAdapter() {
  return new DiscordAdapter(
    { token: 'Bot test-token', baseUrl: 'https://ot.example.com' },
    { client: createMockClient() },
  );
}

// ---------------------------------------------------------------------------
// Conformance: interface shape
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — interface', () => {
  test('has channelType string property', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.channelType).toBe('string');
    expect(adapter.channelType.length).toBeGreaterThan(0);
  });

  test('has capabilities object with all required flags', () => {
    const adapter = makeAdapter();
    const requiredFlags = [
      'threads',
      'buttons',
      'selectMenus',
      'replyMessages',
      'dms',
      'fileUpload',
    ] as const;
    for (const flag of requiredFlags) {
      expect(typeof adapter.capabilities[flag]).toBe('boolean');
    }
  });

  test('exposes initialize() method', () => {
    expect(typeof makeAdapter().initialize).toBe('function');
  });

  test('exposes shutdown() method', () => {
    expect(typeof makeAdapter().shutdown).toBe('function');
  });

  test('exposes onMessage() method', () => {
    expect(typeof makeAdapter().onMessage).toBe('function');
  });

  test('exposes send() method', () => {
    expect(typeof makeAdapter().send).toBe('function');
  });

  test('exposes sendA2H() method', () => {
    expect(typeof makeAdapter().sendA2H).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Conformance: send() contract
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — send()', () => {
  test('returns a SendResult with messageId', async () => {
    const adapter = makeAdapter();
    const result = await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      message: { text: 'conformance test' },
    });
    expect(result).toBeDefined();
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  test('accepts a MessageItem array in message field', async () => {
    const adapter = makeAdapter();
    const result = await adapter.send({
      channelId: 'C01234',
      targetId: 'U5678',
      message: [{ text: 'item 1' }, { text: 'item 2' }],
    });
    expect(result.messageId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Conformance: sendA2H() contract
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — sendA2H()', () => {
  test('INFORM returns response with correct intentId and type', async () => {
    const adapter = makeAdapter();
    const response = await adapter.sendA2H('C01234', undefined, {
      intent: 'INFORM',
      id: 'conform-inform-001',
      text: 'Test notification',
    });
    expect(response.intentId).toBe('conform-inform-001');
    expect(response.type).toBe('INFORM');
  });

  test('AUTHORIZE times out and rejects when no interaction occurs', async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.sendA2H(
        'C01234',
        undefined,
        { intent: 'AUTHORIZE', id: 'conform-auth-001', context: { action: 'test' } },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow();
  });

  test('COLLECT (select) times out and rejects when no selection made', async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.sendA2H(
        'C01234',
        undefined,
        {
          intent: 'COLLECT',
          id: 'conform-collect-001',
          question: 'Pick one',
          options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow();
  });

  test('COLLECT (free-text) times out and rejects when no reply arrives', async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.sendA2H(
        'C01234',
        'T01234',
        { intent: 'COLLECT', id: 'conform-freetext-001', question: 'Tell me why' },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Conformance: onMessage() contract
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — onMessage()', () => {
  test('accepts a handler function without error', () => {
    const adapter = makeAdapter();
    expect(() => {
      adapter.onMessage(async () => {});
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Discord-specific capability assertions
// ---------------------------------------------------------------------------

describe('DiscordAdapter capabilities', () => {
  test('reports threads:true (Discord threads / forum channels)', () => {
    expect(makeAdapter().capabilities.threads).toBe(true);
  });

  test('reports buttons:true (Discord button components)', () => {
    expect(makeAdapter().capabilities.buttons).toBe(true);
  });

  test('reports selectMenus:true (Discord StringSelectMenu)', () => {
    expect(makeAdapter().capabilities.selectMenus).toBe(true);
  });

  test('reports replyMessages:false (Discord uses threads, not quote-replies)', () => {
    expect(makeAdapter().capabilities.replyMessages).toBe(false);
  });

  test('reports dms:true', () => {
    expect(makeAdapter().capabilities.dms).toBe(true);
  });

  test('reports fileUpload:true', () => {
    expect(makeAdapter().capabilities.fileUpload).toBe(true);
  });
});
