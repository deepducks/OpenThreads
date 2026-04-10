/**
 * Integration tests for MongoDBStorageAdapter.
 *
 * Requires a running MongoDB instance. Set TEST_MONGODB_URI to override the
 * default connection string (mongodb://localhost:27017/openthreads_test).
 *
 * Run with:
 *   TEST_MONGODB_URI=mongodb://localhost:27017 bun test tests/integration/
 *
 * Or via Docker Compose:
 *   docker compose -f docker-compose.test.yml up --abort-on-container-exit
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { MongoClient } from 'mongodb';
import { MongoDBStorageAdapter } from '../../src/MongoDBStorageAdapter.js';
import { dropCollections } from '../../src/migrate.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const MONGODB_URI =
  process.env['TEST_MONGODB_URI'] ?? 'mongodb://localhost:27017';
const DB_NAME = 'openthreads_test';

let adapter: MongoDBStorageAdapter;
let client: MongoClient;

beforeAll(async () => {
  adapter = new MongoDBStorageAdapter({ uri: MONGODB_URI, dbName: DB_NAME });
  await adapter.connect();

  // Keep a direct client reference for test teardown.
  client = new MongoClient(MONGODB_URI);
  await client.connect();
});

afterEach(async () => {
  // Clean the database between tests to ensure isolation.
  await dropCollections(client.db(DB_NAME));
  // Re-run connect to recreate indexes after dropping collections.
  await adapter.disconnect();
  await adapter.connect();
});

afterAll(async () => {
  await adapter.disconnect();
  await client.close();
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

describe('channels', () => {
  test('createChannel stores and returns a channel', async () => {
    const channel = await adapter.createChannel({
      channelId: 'slack-main',
      platform: 'slack',
      name: 'Slack Main',
      apiKey: 'ot_ch_sk_test123',
      config: { botToken: 'xoxb-test' },
      active: true,
    });

    expect(channel.channelId).toBe('slack-main');
    expect(channel.platform).toBe('slack');
    expect(channel.createdAt).toBeInstanceOf(Date);
    expect(channel.updatedAt).toBeInstanceOf(Date);
  });

  test('getChannel returns the channel by channelId', async () => {
    await adapter.createChannel({
      channelId: 'tg-bot',
      platform: 'telegram',
      name: 'Telegram Bot',
      apiKey: 'ot_ch_sk_tg',
      config: {},
      active: true,
    });

    const found = await adapter.getChannel('tg-bot');
    expect(found).not.toBeNull();
    expect(found!.platform).toBe('telegram');
  });

  test('getChannel returns null for unknown ID', async () => {
    const found = await adapter.getChannel('does-not-exist');
    expect(found).toBeNull();
  });

  test('listChannels returns all channels sorted by createdAt', async () => {
    await adapter.createChannel({
      channelId: 'ch-1',
      platform: 'slack',
      name: 'Channel 1',
      apiKey: 'ot_ch_sk_1',
      config: {},
      active: true,
    });
    await adapter.createChannel({
      channelId: 'ch-2',
      platform: 'discord',
      name: 'Channel 2',
      apiKey: 'ot_ch_sk_2',
      config: {},
      active: true,
    });

    const channels = await adapter.listChannels();
    expect(channels.length).toBe(2);
  });

  test('updateChannel merges changes', async () => {
    await adapter.createChannel({
      channelId: 'ch-upd',
      platform: 'slack',
      name: 'Old Name',
      apiKey: 'ot_ch_sk_u',
      config: {},
      active: true,
    });

    const updated = await adapter.updateChannel('ch-upd', { name: 'New Name', active: false });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New Name');
    expect(updated!.active).toBe(false);
  });

  test('deleteChannel removes the document', async () => {
    await adapter.createChannel({
      channelId: 'ch-del',
      platform: 'telegram',
      name: 'To Delete',
      apiKey: 'ot_ch_sk_d',
      config: {},
      active: true,
    });

    const deleted = await adapter.deleteChannel('ch-del');
    expect(deleted).toBe(true);

    const found = await adapter.getChannel('ch-del');
    expect(found).toBeNull();
  });

  test('deleteChannel returns false for non-existent channel', async () => {
    const deleted = await adapter.deleteChannel('no-such-channel');
    expect(deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

describe('recipients', () => {
  test('createRecipient stores and returns a recipient', async () => {
    const recipient = await adapter.createRecipient({
      recipientId: 'agent-1',
      name: 'My Agent',
      webhookUrl: 'https://agent.example.com/webhook',
      active: true,
    });

    expect(recipient.recipientId).toBe('agent-1');
    expect(recipient.createdAt).toBeInstanceOf(Date);
  });

  test('getRecipient returns null for unknown ID', async () => {
    const found = await adapter.getRecipient('ghost');
    expect(found).toBeNull();
  });

  test('updateRecipient changes fields', async () => {
    await adapter.createRecipient({
      recipientId: 'r-upd',
      name: 'Old',
      webhookUrl: 'https://old.example.com',
      active: true,
    });

    const updated = await adapter.updateRecipient('r-upd', {
      webhookUrl: 'https://new.example.com',
    });
    expect(updated!.webhookUrl).toBe('https://new.example.com');
  });

  test('deleteRecipient removes the document', async () => {
    await adapter.createRecipient({
      recipientId: 'r-del',
      name: 'To Delete',
      webhookUrl: 'https://delete.example.com',
      active: true,
    });

    expect(await adapter.deleteRecipient('r-del')).toBe(true);
    expect(await adapter.getRecipient('r-del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

describe('threads', () => {
  test('createThread stores and returns a thread', async () => {
    const thread = await adapter.createThread({
      threadId: 'ot_thr_abc123',
      channelId: 'slack-main',
      nativeThreadId: 'T12345',
      targetId: 'C0123',
      isMain: false,
    });

    expect(thread.threadId).toBe('ot_thr_abc123');
    expect(thread.channelId).toBe('slack-main');
  });

  test('getThread returns thread by threadId', async () => {
    await adapter.createThread({
      threadId: 'ot_thr_get',
      channelId: 'ch-1',
      targetId: 'U001',
      isMain: false,
    });

    const found = await adapter.getThread('ot_thr_get');
    expect(found).not.toBeNull();
    expect(found!.targetId).toBe('U001');
  });

  test('getThreadByNative returns thread by channelId + nativeThreadId', async () => {
    await adapter.createThread({
      threadId: 'ot_thr_native',
      channelId: 'slack-main',
      nativeThreadId: 'native-T999',
      targetId: 'C999',
      isMain: false,
    });

    const found = await adapter.getThreadByNative('slack-main', 'native-T999');
    expect(found).not.toBeNull();
    expect(found!.threadId).toBe('ot_thr_native');
  });

  test('getThreadsByTarget returns threads for a target', async () => {
    const base = {
      channelId: 'slack-main',
      targetId: 'C0456',
      isMain: false,
    };
    await adapter.createThread({ ...base, threadId: 'ot_thr_t1' });
    await adapter.createThread({ ...base, threadId: 'ot_thr_t2' });
    await adapter.createThread({
      threadId: 'ot_thr_other',
      channelId: 'slack-main',
      targetId: 'C9999',
      isMain: false,
    });

    const threads = await adapter.getThreadsByTarget('slack-main', 'C0456');
    expect(threads.length).toBe(2);
    expect(threads.every((t) => t.targetId === 'C0456')).toBe(true);
  });

  test('deleteThread returns true and removes document', async () => {
    await adapter.createThread({
      threadId: 'ot_thr_del',
      channelId: 'ch-1',
      targetId: 'U001',
      isMain: false,
    });

    expect(await adapter.deleteThread('ot_thr_del')).toBe(true);
    expect(await adapter.getThread('ot_thr_del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

describe('turns', () => {
  const threadId = 'ot_thr_turns';

  test('createTurn stores and returns a turn', async () => {
    const turn = await adapter.createTurn({
      turnId: 'ot_turn_001',
      threadId,
      inboundMessage: { text: 'Hello!' },
      source: { channelId: 'slack-main', sender: { id: 'U1', name: 'Alice' } },
      replyTo: 'https://openthreads.host/send/channel/slack-main/target/C01/thread/ot_thr_turns',
      timestamp: new Date('2026-01-01T10:00:00Z'),
    });

    expect(turn.turnId).toBe('ot_turn_001');
    expect(turn.createdAt).toBeInstanceOf(Date);
  });

  test('getTurnsByThread returns turns ordered by timestamp', async () => {
    const base = {
      threadId,
      source: { channelId: 'slack-main', sender: { id: 'U1', name: 'Alice' } },
      replyTo: 'https://example.com',
      inboundMessage: { text: 'hi' },
    };

    await adapter.createTurn({ ...base, turnId: 'ot_turn_A', timestamp: new Date('2026-01-01T10:02:00Z') });
    await adapter.createTurn({ ...base, turnId: 'ot_turn_B', timestamp: new Date('2026-01-01T10:01:00Z') });

    const turns = await adapter.getTurnsByThread(threadId);
    expect(turns.length).toBe(2);
    expect(turns[0]!.turnId).toBe('ot_turn_B');
    expect(turns[1]!.turnId).toBe('ot_turn_A');
  });

  test('getTurnsByThread respects before cursor', async () => {
    const base = {
      threadId,
      source: { channelId: 'slack-main', sender: { id: 'U1', name: 'Alice' } },
      replyTo: 'https://example.com',
      inboundMessage: { text: 'hi' },
    };

    const t1 = new Date('2026-01-01T10:00:00Z');
    const t2 = new Date('2026-01-01T10:01:00Z');
    const t3 = new Date('2026-01-01T10:02:00Z');

    await adapter.createTurn({ ...base, turnId: 'ot_turn_C1', timestamp: t1 });
    await adapter.createTurn({ ...base, turnId: 'ot_turn_C2', timestamp: t2 });
    await adapter.createTurn({ ...base, turnId: 'ot_turn_C3', timestamp: t3 });

    const turns = await adapter.getTurnsByThread(threadId, { before: t3 });
    expect(turns.length).toBe(2);
    expect(turns.map((t) => t.turnId)).toEqual(['ot_turn_C1', 'ot_turn_C2']);
  });

  test('updateTurn sets outboundResponse', async () => {
    await adapter.createTurn({
      turnId: 'ot_turn_upd',
      threadId,
      inboundMessage: { text: 'Deploy?' },
      source: { channelId: 'slack-main', sender: { id: 'U1', name: 'Alice' } },
      replyTo: 'https://example.com',
      timestamp: new Date(),
    });

    const updated = await adapter.updateTurn('ot_turn_upd', {
      outboundResponse: { approved: true },
    });
    expect(updated).not.toBeNull();
    expect(updated!.outboundResponse).toEqual({ approved: true });
  });

  test('deleteTurn removes the document', async () => {
    await adapter.createTurn({
      turnId: 'ot_turn_del',
      threadId,
      inboundMessage: { text: 'hi' },
      source: { channelId: 'slack-main', sender: { id: 'U1', name: 'Alice' } },
      replyTo: 'https://example.com',
      timestamp: new Date(),
    });

    expect(await adapter.deleteTurn('ot_turn_del')).toBe(true);
    expect(await adapter.getTurn('ot_turn_del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('routes', () => {
  test('createRoute stores and returns a route', async () => {
    const route = await adapter.createRoute({
      routeId: 'route-1',
      recipientId: 'agent-1',
      criteria: { channelId: 'slack-main', isDM: true },
      active: true,
      priority: 10,
    });

    expect(route.routeId).toBe('route-1');
    expect(route.criteria.isDM).toBe(true);
  });

  test('findMatchingRoutes returns active routes matching criteria', async () => {
    await adapter.createRoute({
      routeId: 'route-slack',
      recipientId: 'agent-1',
      criteria: { channelId: 'slack-main' },
      active: true,
      priority: 5,
    });

    await adapter.createRoute({
      routeId: 'route-inactive',
      recipientId: 'agent-2',
      criteria: { channelId: 'slack-main' },
      active: false,
      priority: 10,
    });

    await adapter.createRoute({
      routeId: 'route-other-channel',
      recipientId: 'agent-3',
      criteria: { channelId: 'discord-main' },
      active: true,
      priority: 5,
    });

    const matches = await adapter.findMatchingRoutes({ channelId: 'slack-main' });
    const matchIds = matches.map((r) => r.routeId);

    expect(matchIds).toContain('route-slack');
    expect(matchIds).not.toContain('route-inactive');
    expect(matchIds).not.toContain('route-other-channel');
  });

  test('findMatchingRoutes returns wildcard routes (no criteria)', async () => {
    await adapter.createRoute({
      routeId: 'route-wildcard',
      recipientId: 'agent-all',
      criteria: {},
      active: true,
      priority: 1,
    });

    const matches = await adapter.findMatchingRoutes({ channelId: 'any-channel' });
    expect(matches.some((r) => r.routeId === 'route-wildcard')).toBe(true);
  });

  test('listRoutes returns all routes sorted by priority desc', async () => {
    await adapter.createRoute({
      routeId: 'route-lo',
      recipientId: 'agent-1',
      criteria: {},
      active: true,
      priority: 1,
    });
    await adapter.createRoute({
      routeId: 'route-hi',
      recipientId: 'agent-2',
      criteria: {},
      active: true,
      priority: 100,
    });

    const routes = await adapter.listRoutes();
    expect(routes[0]!.routeId).toBe('route-hi');
    expect(routes[1]!.routeId).toBe('route-lo');
  });

  test('deleteRoute removes the document', async () => {
    await adapter.createRoute({
      routeId: 'route-del',
      recipientId: 'agent-1',
      criteria: {},
      active: true,
      priority: 0,
    });

    expect(await adapter.deleteRoute('route-del')).toBe(true);
    expect(await adapter.getRoute('route-del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

describe('tokens', () => {
  test('createToken stores and returns a token', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const token = await adapter.createToken({
      tokenId: 'tok-1',
      value: 'ot_tk_e8f2a1',
      channelId: 'slack-main',
      threadId: 'ot_thr_abc123',
      expiresAt,
    });

    expect(token.value).toBe('ot_tk_e8f2a1');
    expect(token.expiresAt).toEqual(expiresAt);
  });

  test('getTokenByValue retrieves the token', async () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    await adapter.createToken({
      tokenId: 'tok-2',
      value: 'ot_tk_xyz',
      channelId: 'slack-main',
      threadId: 'ot_thr_xyz',
      expiresAt,
    });

    const found = await adapter.getTokenByValue('ot_tk_xyz');
    expect(found).not.toBeNull();
    expect(found!.channelId).toBe('slack-main');
  });

  test('getTokenByValue returns null for unknown token', async () => {
    const found = await adapter.getTokenByValue('ot_tk_unknown');
    expect(found).toBeNull();
  });

  test('deleteToken removes the token', async () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    await adapter.createToken({
      tokenId: 'tok-del',
      value: 'ot_tk_del',
      channelId: 'slack-main',
      threadId: 'ot_thr_del',
      expiresAt,
    });

    expect(await adapter.deleteToken('ot_tk_del')).toBe(true);
    expect(await adapter.getTokenByValue('ot_tk_del')).toBeNull();
  });

  test('deleteToken returns false for non-existent token', async () => {
    expect(await adapter.deleteToken('ot_tk_ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('lifecycle', () => {
  test('isConnected returns true after connect', () => {
    expect(adapter.isConnected()).toBe(true);
  });

  test('disconnect and reconnect works', async () => {
    const fresh = new MongoDBStorageAdapter({ uri: MONGODB_URI, dbName: DB_NAME });
    expect(fresh.isConnected()).toBe(false);

    await fresh.connect();
    expect(fresh.isConnected()).toBe(true);

    await fresh.disconnect();
    expect(fresh.isConnected()).toBe(false);
  });
});
