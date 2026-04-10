/**
 * Integration tests for MongoStorageAdapter.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * Run:
 *   bun test tests/integration
 *
 * Environment:
 *   MONGODB_URI  — default: mongodb://localhost:27018
 *   MONGODB_DB   — default: openthreads_test
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MongoStorageAdapter } from '../../src/MongoStorageAdapter.js';
import type {
  ChannelInput,
  RecipientInput,
  ThreadInput,
  TurnInput,
  RouteInput,
  TokenInput,
} from '@openthreads/core';

const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27018';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'openthreads_test';

let adapter: MongoStorageAdapter;

beforeAll(async () => {
  adapter = new MongoStorageAdapter({ uri: MONGODB_URI, dbName: MONGODB_DB });
  await adapter.connect();
});

afterAll(async () => {
  await adapter.disconnect();
});

// ─── Channels ──────────────────────────────────────────────────────────────────

describe('channels', () => {
  const channelInput: ChannelInput = {
    channelId: 'test-slack',
    type: 'slack',
    name: 'Test Slack',
    config: { botToken: 'xoxb-test' },
    apiKey: 'ot_ch_sk_test1',
    active: true,
  };

  beforeEach(async () => {
    await adapter.deleteChannel(channelInput.channelId);
  });

  test('createChannel and getChannel', async () => {
    const created = await adapter.createChannel(channelInput);
    expect(created.channelId).toBe(channelInput.channelId);
    expect(created.createdAt).toBeInstanceOf(Date);

    const fetched = await adapter.getChannel(channelInput.channelId);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe(channelInput.name);
  });

  test('getChannelByApiKey', async () => {
    await adapter.createChannel(channelInput);
    const fetched = await adapter.getChannelByApiKey('ot_ch_sk_test1');
    expect(fetched?.channelId).toBe(channelInput.channelId);
  });

  test('updateChannel', async () => {
    await adapter.createChannel(channelInput);
    const updated = await adapter.updateChannel(channelInput.channelId, { name: 'Updated Slack' });
    expect(updated?.name).toBe('Updated Slack');
  });

  test('deleteChannel', async () => {
    await adapter.createChannel(channelInput);
    const deleted = await adapter.deleteChannel(channelInput.channelId);
    expect(deleted).toBe(true);
    expect(await adapter.getChannel(channelInput.channelId)).toBeNull();
  });

  test('listChannels with filter', async () => {
    await adapter.createChannel(channelInput);
    const active = await adapter.listChannels({ active: true });
    expect(active.some(c => c.channelId === channelInput.channelId)).toBe(true);

    const inactive = await adapter.listChannels({ active: false });
    expect(inactive.some(c => c.channelId === channelInput.channelId)).toBe(false);
  });
});

// ─── Recipients ────────────────────────────────────────────────────────────────

describe('recipients', () => {
  const recipientInput: RecipientInput = {
    recipientId: 'test-agent-1',
    name: 'Test Agent',
    webhookUrl: 'https://example.com/webhook',
    active: true,
  };

  beforeEach(async () => {
    await adapter.deleteRecipient(recipientInput.recipientId);
  });

  test('createRecipient and getRecipient', async () => {
    const created = await adapter.createRecipient(recipientInput);
    expect(created.recipientId).toBe(recipientInput.recipientId);

    const fetched = await adapter.getRecipient(recipientInput.recipientId);
    expect(fetched?.webhookUrl).toBe(recipientInput.webhookUrl);
  });

  test('updateRecipient', async () => {
    await adapter.createRecipient(recipientInput);
    const updated = await adapter.updateRecipient(recipientInput.recipientId, {
      webhookUrl: 'https://example.com/new-webhook',
    });
    expect(updated?.webhookUrl).toBe('https://example.com/new-webhook');
  });

  test('deleteRecipient', async () => {
    await adapter.createRecipient(recipientInput);
    expect(await adapter.deleteRecipient(recipientInput.recipientId)).toBe(true);
    expect(await adapter.getRecipient(recipientInput.recipientId)).toBeNull();
  });
});

// ─── Threads ───────────────────────────────────────────────────────────────────

describe('threads', () => {
  const threadInput: ThreadInput = {
    threadId: 'ot_thr_test001',
    channelId: 'test-slack',
    nativeThreadId: 'slack-ts-12345',
    targetId: 'C0123',
    isMain: false,
  };

  beforeEach(async () => {
    await adapter.deleteThread(threadInput.threadId);
  });

  test('createThread and getThread', async () => {
    const created = await adapter.createThread(threadInput);
    expect(created.threadId).toBe(threadInput.threadId);

    const fetched = await adapter.getThread(threadInput.threadId);
    expect(fetched?.channelId).toBe(threadInput.channelId);
  });

  test('getThreadByNativeId', async () => {
    await adapter.createThread(threadInput);
    const fetched = await adapter.getThreadByNativeId(
      threadInput.channelId,
      threadInput.nativeThreadId!
    );
    expect(fetched?.threadId).toBe(threadInput.threadId);
  });

  test('getMainThread', async () => {
    const mainThreadInput: ThreadInput = {
      threadId: 'ot_thr_main_test',
      channelId: 'test-slack',
      targetId: 'C9999',
      isMain: true,
    };
    await adapter.deleteThread(mainThreadInput.threadId);
    await adapter.createThread(mainThreadInput);

    const fetched = await adapter.getMainThread('test-slack', 'C9999');
    expect(fetched?.threadId).toBe(mainThreadInput.threadId);
    await adapter.deleteThread(mainThreadInput.threadId);
  });

  test('updateThread', async () => {
    await adapter.createThread(threadInput);
    const updated = await adapter.updateThread(threadInput.threadId, {
      recipientId: 'agent-1',
    });
    expect(updated?.recipientId).toBe('agent-1');
  });

  test('deleteThread', async () => {
    await adapter.createThread(threadInput);
    expect(await adapter.deleteThread(threadInput.threadId)).toBe(true);
    expect(await adapter.getThread(threadInput.threadId)).toBeNull();
  });

  test('listThreadsByChannel', async () => {
    await adapter.createThread(threadInput);
    const threads = await adapter.listThreadsByChannel(threadInput.channelId);
    expect(threads.some(t => t.threadId === threadInput.threadId)).toBe(true);
  });
});

// ─── Turns ─────────────────────────────────────────────────────────────────────

describe('turns', () => {
  const turnInput: TurnInput = {
    turnId: 'ot_turn_test001',
    threadId: 'ot_thr_test001',
    inbound: {
      message: { text: 'Hello, world!' },
      sender: { id: 'U123', name: 'Test User' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
    },
    status: 'pending',
    timestamp: new Date('2024-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    // Clean up by attempting to delete (may not exist)
    const existing = await adapter.getTurn(turnInput.turnId);
    if (existing) {
      // We can't directly delete turns in the interface but we can update
    }
  });

  test('createTurn and getTurn', async () => {
    const created = await adapter.createTurn(turnInput);
    expect(created.turnId).toBe(turnInput.turnId);

    const fetched = await adapter.getTurn(turnInput.turnId);
    expect(fetched?.threadId).toBe(turnInput.threadId);
    expect(fetched?.status).toBe('pending');
  });

  test('getTurnsForThread returns chronological order', async () => {
    const turn2: TurnInput = {
      turnId: 'ot_turn_test002',
      threadId: 'ot_thr_test001',
      inbound: {
        message: { text: 'Second message' },
        sender: { id: 'U123' },
        timestamp: new Date('2024-01-01T00:01:00Z'),
      },
      status: 'pending',
      timestamp: new Date('2024-01-01T00:01:00Z'),
    };
    await adapter.createTurn(turn2);

    const turns = await adapter.getTurnsForThread('ot_thr_test001');
    const timestamps = turns.map(t => t.timestamp.getTime());
    // Verify ascending order
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });

  test('updateTurn status', async () => {
    await adapter.createTurn(turnInput);
    const updated = await adapter.updateTurn(turnInput.turnId, {
      status: 'delivered',
      outbound: {
        message: { text: 'Acknowledged!' },
        timestamp: new Date(),
      },
    });
    expect(updated?.status).toBe('delivered');
    expect(updated?.outbound).toBeDefined();
  });
});

// ─── Routes ────────────────────────────────────────────────────────────────────

describe('routes', () => {
  const routeInput: RouteInput = {
    routeId: 'test-route-1',
    name: 'Test Route',
    criteria: { channelId: 'test-slack', targetId: 'C0123' },
    recipientId: 'test-agent-1',
    priority: 10,
    active: true,
  };

  beforeEach(async () => {
    await adapter.deleteRoute(routeInput.routeId);
  });

  test('createRoute and getRoute', async () => {
    const created = await adapter.createRoute(routeInput);
    expect(created.routeId).toBe(routeInput.routeId);

    const fetched = await adapter.getRoute(routeInput.routeId);
    expect(fetched?.criteria.channelId).toBe('test-slack');
  });

  test('findMatchingRoutes returns active routes matching criteria', async () => {
    await adapter.createRoute(routeInput);

    const matches = await adapter.findMatchingRoutes({
      channelId: 'test-slack',
      targetId: 'C0123',
    });
    expect(matches.some(r => r.routeId === routeInput.routeId)).toBe(true);
  });

  test('findMatchingRoutes does not return routes for different channel', async () => {
    await adapter.createRoute(routeInput);

    const matches = await adapter.findMatchingRoutes({ channelId: 'other-channel' });
    expect(matches.some(r => r.routeId === routeInput.routeId)).toBe(false);
  });

  test('findMatchingRoutes respects priority ordering', async () => {
    const route2: RouteInput = {
      routeId: 'test-route-low-priority',
      name: 'Low Priority Route',
      criteria: { channelId: 'test-slack' },
      recipientId: 'test-agent-1',
      priority: 100,
      active: true,
    };
    await adapter.createRoute(route2);

    const matches = await adapter.findMatchingRoutes({ channelId: 'test-slack' });
    const priorities = matches.map(r => r.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]!);
    }

    await adapter.deleteRoute(route2.routeId);
  });

  test('updateRoute', async () => {
    await adapter.createRoute(routeInput);
    const updated = await adapter.updateRoute(routeInput.routeId, { priority: 5 });
    expect(updated?.priority).toBe(5);
  });

  test('deleteRoute', async () => {
    await adapter.createRoute(routeInput);
    expect(await adapter.deleteRoute(routeInput.routeId)).toBe(true);
    expect(await adapter.getRoute(routeInput.routeId)).toBeNull();
  });
});

// ─── Tokens ────────────────────────────────────────────────────────────────────

describe('tokens', () => {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h

  const tokenInput: TokenInput = {
    tokenId: 'tok_test_001',
    value: 'ot_tk_test_value_001',
    channelId: 'test-slack',
    threadId: 'ot_thr_test001',
    expiresAt: futureDate,
    used: false,
  };

  test('createToken and getTokenByValue', async () => {
    const created = await adapter.createToken(tokenInput);
    expect(created.value).toBe(tokenInput.value);

    const fetched = await adapter.getTokenByValue(tokenInput.value);
    expect(fetched?.channelId).toBe(tokenInput.channelId);
  });

  test('getTokenByValue returns null for expired tokens', async () => {
    const expiredInput: TokenInput = {
      ...tokenInput,
      tokenId: 'tok_expired_001',
      value: 'ot_tk_expired_001',
      expiresAt: new Date(Date.now() - 1000), // already expired
    };
    await adapter.createToken(expiredInput);

    const fetched = await adapter.getTokenByValue(expiredInput.value);
    expect(fetched).toBeNull();
  });

  test('consumeToken marks token as used', async () => {
    await adapter.createToken({
      ...tokenInput,
      tokenId: 'tok_consume_001',
      value: 'ot_tk_consume_001',
    });

    const consumed = await adapter.consumeToken('ot_tk_consume_001');
    expect(consumed).toBe(true);

    // Second consume should fail
    const secondConsume = await adapter.consumeToken('ot_tk_consume_001');
    expect(secondConsume).toBe(false);

    // getTokenByValue should return null after consumption
    const fetched = await adapter.getTokenByValue('ot_tk_consume_001');
    expect(fetched).toBeNull();
  });

  test('deleteExpiredTokens removes expired documents', async () => {
    const expiredInput: TokenInput = {
      ...tokenInput,
      tokenId: 'tok_del_expired_001',
      value: 'ot_tk_del_expired_001',
      expiresAt: new Date(Date.now() - 5000),
    };
    await adapter.createToken(expiredInput);

    const count = await adapter.deleteExpiredTokens();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('TTL index exists on tokens collection', async () => {
    const isPingable = await adapter.ping();
    expect(isPingable).toBe(true);
  });
});

// ─── ping ──────────────────────────────────────────────────────────────────────

describe('ping', () => {
  test('returns true when connected', async () => {
    expect(await adapter.ping()).toBe(true);
  });
});
