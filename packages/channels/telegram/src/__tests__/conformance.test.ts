/**
 * Shared adapter conformance tests — Telegram.
 *
 * These tests verify that TelegramAdapter correctly implements the ChannelAdapter
 * interface contract. Any adapter should be able to pass a similar suite.
 */
import { describe, test, expect } from 'bun:test';
import { TelegramAdapter } from '../TelegramAdapter.js';
import type { TelegramApiClientLike } from '../TelegramApiClient.js';
import type { ChannelAdapter, ChannelCapabilities } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeMockClient(): TelegramApiClientLike {
  let msgCounter = 5000;
  return {
    setWebhook: async () => true,
    deleteWebhook: async () => true,
    sendMessage: async () => ({ message_id: ++msgCounter }),
    editMessageText: async () => ({ ok: true }),
    editMessageReplyMarkup: async () => ({ ok: true }),
    answerCallbackQuery: async () => true,
  };
}

function makeAdapter(): ChannelAdapter {
  return new TelegramAdapter(
    { token: 'test:conformance', baseUrl: 'https://ot.example.com' },
    { client: makeMockClient() },
  );
}

// ---------------------------------------------------------------------------
// Conformance: interface shape
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — interface (Telegram)', () => {
  test('has channelType string property', () => {
    const adapter = makeAdapter();
    expect(typeof adapter.channelType).toBe('string');
    expect(adapter.channelType).toBe('telegram');
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

describe('ChannelAdapter conformance — send() (Telegram)', () => {
  test('returns a SendResult with messageId', async () => {
    const adapter = makeAdapter();
    const result = await adapter.send({
      channelId: '100',
      message: { text: 'conformance test' },
    });
    expect(result).toBeDefined();
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  test('accepts a MessageItem array', async () => {
    const adapter = makeAdapter();
    const result = await adapter.send({
      channelId: '100',
      message: [{ text: 'item 1' }, { text: 'item 2' }],
    });
    expect(result.messageId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Conformance: sendA2H() contract
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — sendA2H() (Telegram)', () => {
  test('INFORM returns response with correct intentId and type', async () => {
    const adapter = makeAdapter();
    const response = await adapter.sendA2H('100', undefined, {
      intent: 'INFORM',
      id: 'conform-inform-001',
      text: 'Test notification',
    });
    expect(response.intentId).toBe('conform-inform-001');
    expect(response.type).toBe('INFORM');
  });

  test('AUTHORIZE times out and rejects when no interaction', async () => {
    const adapter = makeAdapter();
    await expect(
      adapter.sendA2H(
        '100',
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
        '100',
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
        '100',
        '1234',
        { intent: 'COLLECT', id: 'conform-freetext-001', question: 'Tell me why' },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Conformance: onMessage() contract
// ---------------------------------------------------------------------------

describe('ChannelAdapter conformance — onMessage() (Telegram)', () => {
  test('accepts a handler function without error', () => {
    const adapter = makeAdapter();
    expect(() => {
      adapter.onMessage(async () => {});
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Telegram-specific capability assertions
// ---------------------------------------------------------------------------

describe('TelegramAdapter capabilities (conformance)', () => {
  test('threads: false — no native thread support', () => {
    expect(makeAdapter().capabilities.threads).toBe(false);
  });

  test('buttons: true — inline keyboards supported', () => {
    expect(makeAdapter().capabilities.buttons).toBe(true);
  });

  test('selectMenus: false — no dropdown menus in Telegram', () => {
    expect(makeAdapter().capabilities.selectMenus).toBe(false);
  });

  test('replyMessages: true — reply chains supported', () => {
    expect(makeAdapter().capabilities.replyMessages).toBe(true);
  });

  test('dms: true — private chats supported', () => {
    expect(makeAdapter().capabilities.dms).toBe(true);
  });

  test('fileUpload: true — Telegram supports media', () => {
    expect(makeAdapter().capabilities.fileUpload).toBe(true);
  });
});
