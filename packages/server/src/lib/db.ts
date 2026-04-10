/**
 * MongoDB singleton + typed collection helpers for OpenThreads server.
 *
 * Uses the core types from @openthreads/core as MongoDB document shapes.
 * All CRUD helpers operate against the shared singleton connection.
 */

import { MongoClient, type Db, type Collection, type Filter, type UpdateFilter } from 'mongodb';
import type { Channel, CreateChannelInput } from '@openthreads/core';
import type { Recipient, CreateRecipientInput } from '@openthreads/core';
import type { Thread, CreateThreadInput } from '@openthreads/core';
import type { Turn, CreateTurnInput } from '@openthreads/core';
import type { Route, CreateRouteInput, RouteCriteria } from '@openthreads/core';
import {
  generateThreadId,
  generateTurnId,
  generateTokenId,
  generateChannelSecretKey,
} from '@openthreads/core';

// Re-export generators for use in route handlers
export { generateThreadId, generateTurnId, generateTokenId, generateChannelSecretKey };

// ─── Token document type ───────────────────────────────────────────────────────

export interface TokenDoc {
  /** Internal unique ID */
  tokenId: string;
  /** The "ot_tk_..." value included in ?token= query param */
  value: string;
  channelId: string;
  threadId: string;
  turnId?: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

// ─── Singleton MongoDB connection ─────────────────────────────────────────────

let _client: MongoClient | null = null;
let _db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (_db) return _db;

  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB ?? 'openthreads';

  _client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });
  await _client.connect();
  _db = _client.db(dbName);
  return _db;
}

export async function disconnectDb(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

// ─── Typed collection accessors ───────────────────────────────────────────────

async function col<T extends object>(name: string): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export async function createChannel(input: CreateChannelInput): Promise<Channel> {
  const doc: Channel = {
    ...input,
    apiKey: input.apiKey ?? generateChannelSecretKey(),
  };
  const coll = await col<Channel>('channels');
  await coll.insertOne(doc as unknown as Channel & { _id?: unknown });
  return doc;
}

export async function getChannel(id: string): Promise<Channel | null> {
  const coll = await col<Channel>('channels');
  return (await coll.findOne({ id } as Filter<Channel>)) as Channel | null;
}

export async function getChannelByApiKey(apiKey: string): Promise<Channel | null> {
  const coll = await col<Channel>('channels');
  return (await coll.findOne({ apiKey } as Filter<Channel>)) as Channel | null;
}

export async function updateChannel(
  id: string,
  updates: Partial<CreateChannelInput>,
): Promise<Channel | null> {
  const coll = await col<Channel>('channels');
  const result = await coll.findOneAndUpdate(
    { id } as Filter<Channel>,
    { $set: updates } as UpdateFilter<Channel>,
    { returnDocument: 'after' },
  );
  return result as Channel | null;
}

export async function deleteChannel(id: string): Promise<boolean> {
  const coll = await col<Channel>('channels');
  const result = await coll.deleteOne({ id } as Filter<Channel>);
  return result.deletedCount === 1;
}

export async function listChannels(): Promise<Channel[]> {
  const coll = await col<Channel>('channels');
  return (await coll.find({}).toArray()) as Channel[];
}

// ─── Recipients ───────────────────────────────────────────────────────────────

export async function createRecipient(input: CreateRecipientInput): Promise<Recipient> {
  const coll = await col<Recipient>('recipients');
  await coll.insertOne(input as unknown as Recipient & { _id?: unknown });
  return input;
}

export async function getRecipient(id: string): Promise<Recipient | null> {
  const coll = await col<Recipient>('recipients');
  return (await coll.findOne({ id } as Filter<Recipient>)) as Recipient | null;
}

export async function updateRecipient(
  id: string,
  updates: Partial<Recipient>,
): Promise<Recipient | null> {
  const coll = await col<Recipient>('recipients');
  const result = await coll.findOneAndUpdate(
    { id } as Filter<Recipient>,
    { $set: updates } as UpdateFilter<Recipient>,
    { returnDocument: 'after' },
  );
  return result as Recipient | null;
}

export async function deleteRecipient(id: string): Promise<boolean> {
  const coll = await col<Recipient>('recipients');
  const result = await coll.deleteOne({ id } as Filter<Recipient>);
  return result.deletedCount === 1;
}

export async function listRecipients(): Promise<Recipient[]> {
  const coll = await col<Recipient>('recipients');
  return (await coll.find({}).toArray()) as Recipient[];
}

// ─── Threads ──────────────────────────────────────────────────────────────────

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const doc: Thread = {
    threadId: input.threadId ?? generateThreadId(),
    channelId: input.channelId,
    nativeThreadId: input.nativeThreadId,
    targetId: input.targetId,
    createdAt: input.createdAt ?? new Date(),
  };
  const coll = await col<Thread>('threads');
  await coll.insertOne(doc as unknown as Thread & { _id?: unknown });
  return doc;
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const coll = await col<Thread>('threads');
  return (await coll.findOne({ threadId } as Filter<Thread>)) as Thread | null;
}

export async function getThreadByNativeId(
  channelId: string,
  nativeThreadId: string,
): Promise<Thread | null> {
  const coll = await col<Thread>('threads');
  return (await coll.findOne({ channelId, nativeThreadId } as Filter<Thread>)) as Thread | null;
}

export async function listThreadsByChannel(
  channelId: string,
  targetId?: string,
): Promise<Thread[]> {
  const coll = await col<Thread>('threads');
  const query: Record<string, unknown> = { channelId };
  if (targetId) query['targetId'] = targetId;
  return (await coll.find(query as Filter<Thread>).sort({ createdAt: -1 }).toArray()) as Thread[];
}

export async function listThreads(options?: {
  channelId?: string;
  targetId?: string;
  search?: string;
  limit?: number;
  skip?: number;
}): Promise<Thread[]> {
  const coll = await col<Thread>('threads');
  const query: Record<string, unknown> = {};
  if (options?.channelId) query['channelId'] = options.channelId;
  if (options?.targetId) query['targetId'] = options.targetId;
  if (options?.search) {
    query['$or'] = [
      { threadId: { $regex: options.search, $options: 'i' } },
      { targetId: { $regex: options.search, $options: 'i' } },
      { channelId: { $regex: options.search, $options: 'i' } },
    ];
  }
  let cursor = coll.find(query as Filter<Thread>).sort({ createdAt: -1 });
  if (options?.skip) cursor = cursor.skip(options.skip);
  if (options?.limit) cursor = cursor.limit(options.limit);
  return (await cursor.toArray()) as Thread[];
}

// ─── Turns ────────────────────────────────────────────────────────────────────

export async function createTurn(input: CreateTurnInput): Promise<Turn> {
  const doc: Turn = {
    turnId: input.turnId ?? generateTurnId(),
    threadId: input.threadId,
    direction: input.direction,
    message: input.message,
    timestamp: input.timestamp ?? new Date(),
  };
  const coll = await col<Turn>('turns');
  await coll.insertOne(doc as unknown as Turn & { _id?: unknown });
  return doc;
}

export async function getTurn(turnId: string): Promise<Turn | null> {
  const coll = await col<Turn>('turns');
  return (await coll.findOne({ turnId } as Filter<Turn>)) as Turn | null;
}

export async function listTurnsByThread(threadId: string): Promise<Turn[]> {
  const coll = await col<Turn>('turns');
  return (await coll
    .find({ threadId } as Filter<Turn>)
    .sort({ timestamp: 1 })
    .toArray()) as Turn[];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function createRoute(input: CreateRouteInput): Promise<Route> {
  const coll = await col<Route>('routes');
  await coll.insertOne(input as unknown as Route & { _id?: unknown });
  return input;
}

export async function getRoute(id: string): Promise<Route | null> {
  const coll = await col<Route>('routes');
  return (await coll.findOne({ id } as Filter<Route>)) as Route | null;
}

export async function updateRoute(id: string, updates: Partial<Route>): Promise<Route | null> {
  const coll = await col<Route>('routes');
  const result = await coll.findOneAndUpdate(
    { id } as Filter<Route>,
    { $set: updates } as UpdateFilter<Route>,
    { returnDocument: 'after' },
  );
  return result as Route | null;
}

export async function deleteRoute(id: string): Promise<boolean> {
  const coll = await col<Route>('routes');
  const result = await coll.deleteOne({ id } as Filter<Route>);
  return result.deletedCount === 1;
}

export async function listRoutes(): Promise<Route[]> {
  const coll = await col<Route>('routes');
  return (await coll.find({}).sort({ priority: 1 }).toArray()) as Route[];
}

export async function findMatchingRoutes(criteria: Partial<RouteCriteria>): Promise<Route[]> {
  const coll = await col<Route>('routes');
  const conditions: Record<string, unknown>[] = [
    { $or: [{ enabled: true }, { enabled: { $exists: false } }] },
  ];

  if (criteria.channelId) {
    conditions.push({
      $or: [
        { 'criteria.channelId': criteria.channelId },
        { 'criteria.channelId': { $exists: false } },
      ],
    });
  }

  if (criteria.isDm !== undefined) {
    conditions.push({
      $or: [
        { 'criteria.isDm': criteria.isDm },
        { 'criteria.isDm': { $exists: false } },
      ],
    });
  }

  if (criteria.isMention !== undefined) {
    conditions.push({
      $or: [
        { 'criteria.isMention': criteria.isMention },
        { 'criteria.isMention': { $exists: false } },
      ],
    });
  }

  if (criteria.senderId) {
    conditions.push({
      $or: [
        { 'criteria.senderId': criteria.senderId },
        { 'criteria.senderId': { $exists: false } },
      ],
    });
  }

  const query = conditions.length > 1 ? { $and: conditions } : conditions[0];
  return (await coll
    .find(query as Filter<Route>)
    .sort({ priority: 1 })
    .toArray()) as Route[];
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface CreateTokenOptions {
  channelId: string;
  threadId: string;
  turnId?: string;
  /** TTL in seconds (default: from env or 86400) */
  ttlSeconds?: number;
}

export async function createEphemeralToken(options: CreateTokenOptions): Promise<TokenDoc> {
  const ttl = options.ttlSeconds ?? Number(process.env.REPLY_TOKEN_TTL ?? 86400);
  const value = generateTokenId();
  const doc: TokenDoc = {
    tokenId: value,
    value,
    channelId: options.channelId,
    threadId: options.threadId,
    turnId: options.turnId,
    expiresAt: new Date(Date.now() + ttl * 1000),
    used: false,
    createdAt: new Date(),
  };

  const coll = await col<TokenDoc>('tokens');
  await coll.insertOne(doc as unknown as TokenDoc & { _id?: unknown });
  return doc;
}

export async function getValidToken(value: string): Promise<TokenDoc | null> {
  const coll = await col<TokenDoc>('tokens');
  return (await coll.findOne({
    value,
    used: false,
    expiresAt: { $gt: new Date() },
  } as Filter<TokenDoc>)) as TokenDoc | null;
}

export async function consumeToken(value: string): Promise<boolean> {
  const coll = await col<TokenDoc>('tokens');
  const result = await coll.updateOne(
    { value, used: false, expiresAt: { $gt: new Date() } } as Filter<TokenDoc>,
    { $set: { used: true } } as UpdateFilter<TokenDoc>,
  );
  return result.modifiedCount === 1;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ChannelOverride {
  tokenTtlSeconds?: number;
  trustLayerEnabled?: boolean;
}

export interface AppSettings {
  tokenTtlSeconds: number;
  trustLayerEnabled: boolean;
  perChannelOverrides: Record<string, ChannelOverride>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  tokenTtlSeconds: 86400,
  trustLayerEnabled: false,
  perChannelOverrides: {},
};

interface SettingsDoc extends AppSettings {
  name: string;
}

export async function getSettings(): Promise<AppSettings> {
  const coll = await col<SettingsDoc>('settings');
  const doc = await coll.findOne({ name: 'global' } as Filter<SettingsDoc>);
  if (!doc) return { ...DEFAULT_SETTINGS };
  return {
    tokenTtlSeconds: doc.tokenTtlSeconds ?? DEFAULT_SETTINGS.tokenTtlSeconds,
    trustLayerEnabled: doc.trustLayerEnabled ?? DEFAULT_SETTINGS.trustLayerEnabled,
    perChannelOverrides: doc.perChannelOverrides ?? {},
  };
}

export async function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  const coll = await col<SettingsDoc>('settings');
  await coll.updateOne(
    { name: 'global' } as Filter<SettingsDoc>,
    { $set: updates, $setOnInsert: { name: 'global' } } as UpdateFilter<SettingsDoc>,
    { upsert: true },
  );
  return getSettings();
}

// ─── Ensure indexes ───────────────────────────────────────────────────────────

export async function ensureIndexes(): Promise<void> {
  const db = await getDb();

  await Promise.all([
    db.collection('channels').createIndexes([
      { key: { id: 1 }, unique: true, name: 'channels_id_unique' },
      { key: { apiKey: 1 }, sparse: true, unique: true, name: 'channels_apiKey_unique' },
    ]),
    db.collection('recipients').createIndexes([
      { key: { id: 1 }, unique: true, name: 'recipients_id_unique' },
    ]),
    db.collection('threads').createIndexes([
      { key: { threadId: 1 }, unique: true, name: 'threads_threadId_unique' },
      { key: { channelId: 1, nativeThreadId: 1 }, name: 'threads_channelId_nativeThreadId' },
      { key: { channelId: 1, targetId: 1 }, name: 'threads_channelId_targetId' },
    ]),
    db.collection('turns').createIndexes([
      { key: { turnId: 1 }, unique: true, name: 'turns_turnId_unique' },
      { key: { threadId: 1, timestamp: 1 }, name: 'turns_threadId_timestamp' },
    ]),
    db.collection('routes').createIndexes([
      { key: { id: 1 }, unique: true, name: 'routes_id_unique' },
      { key: { priority: 1 }, name: 'routes_priority' },
    ]),
    db.collection('tokens').createIndexes([
      { key: { value: 1 }, unique: true, name: 'tokens_value_unique' },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'tokens_expiresAt_ttl' },
    ]),
  ]);
}
