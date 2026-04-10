/**
 * Shared adapter conformance tests.
 *
 * These tests verify that SlackAdapter correctly implements the ChannelAdapter
 * interface contract. Any adapter should be able to pass this suite by
 * providing a factory function and test doubles.
 */
import { describe, test, expect } from 'bun:test';
import { SlackAdapter } from '../SlackAdapter.js';
import type { ChannelAdapter, ChannelCapabilities } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Test doubles (same helpers as SlackAdapter.test.ts)
// ---------------------------------------------------------------------------

type Handler = (args: Record<string, unknown>) => Promise<void>;

function createMockApp() {
  const handlers: Record<string, Handler> = {};
  return {
    app: {
      message: (h: Handler) => { handlers['message'] = h; },
      event: (name: string, h: Handler) => { handlers[`event:${name}`] = h; },
      command: (name: string, h: Handler) => { handlers[`command:${name}`] = h; },
      action: (name: string, h: Handler) => { handlers[`action:${name}`] = h; },
      start: async () => {},
      stop: async () => {},
    } as unknown as import('@slack/bolt').App,
    handlers,
  };
}

function createMockClient() {
  let ts = 5000;
  return {
    client: {
      chat: {
        postMessage: async () => ({ ok: true, ts: `${++ts}.000100` }),
        update: async () => ({ ok: true }),
      },
      users: {
        info: async ({ user }: { user: string }) => ({
          ok: true,
          user: { name: user, real_name: user },
        }),
      },
    } as unknown as import('@slack/web-api').WebClient,
  };
}

function makeAdapter(): ChannelAdapter {
  const mockApp = createMockApp();
  const mockClient = createMockClient();
  return new SlackAdapter(
    { token: 'xoxb-test', signingSecret: 'secret', baseUrl: 'https://ot.example.com' },
    { app: mockApp.app, client: mockClient.client },
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
    const requiredFlags: Array<keyof ChannelCapabilities> = [
      'threads',
      'buttons',
      'selectMenus',
      'replyMessages',
      'dms',
      'fileUpload',
    ];
    for (const flag of requiredFlags) {
      expect(typeof adapter.capabilities[flag]).toBe('boolean');
    }
  });

  test('exposes initialize() method', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.initialize).toBe('function');
  });

  test('exposes shutdown() method', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.shutdown).toBe('function');
  });

  test('exposes onMessage() method', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.onMessage).toBe('function');
  });

  test('exposes send() method', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.send).toBe('function');
  });

  test('exposes sendA2H() method', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.sendA2H).toBe('function');
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
      message: [
        { text: 'item 1' },
        { text: 'item 2' },
      ],
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
        '1234.000001',
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
// Conformance: Slack-specific capability assertions
// ---------------------------------------------------------------------------

describe('SlackAdapter capabilities', () => {
  test('reports threads:true', () => {
    expect(makeAdapter().capabilities.threads).toBe(true);
  });

  test('reports buttons:true', () => {
    expect(makeAdapter().capabilities.buttons).toBe(true);
  });

  test('reports selectMenus:true', () => {
    expect(makeAdapter().capabilities.selectMenus).toBe(true);
  });

  test('reports replyMessages:false (Slack uses threads, not quote-replies)', () => {
    expect(makeAdapter().capabilities.replyMessages).toBe(false);
  });

  test('reports dms:true', () => {
    expect(makeAdapter().capabilities.dms).toBe(true);
  });

  test('reports fileUpload:true', () => {
    expect(makeAdapter().capabilities.fileUpload).toBe(true);
  });
});
