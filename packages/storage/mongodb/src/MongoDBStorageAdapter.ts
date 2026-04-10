import {
  MongoClient,
  ObjectId,
  type Db,
  type Collection,
  type MongoClientOptions,
  type Filter,
} from 'mongodb';
import type {
  StorageAdapter,
  Channel,
  Recipient,
  Thread,
  Turn,
  Route,
  RouteCriteria,
  Token,
  PageOptions,
  TurnQueryOptions,
} from '@openthreads/core';

import {
  type ChannelDoc,
  type RecipientDoc,
  type ThreadDoc,
  type TurnDoc,
  type RouteDoc,
  type TokenDoc,
  channelFromDoc,
  recipientFromDoc,
  threadFromDoc,
  turnFromDoc,
  routeFromDoc,
  tokenFromDoc,
} from './collections.js';
import { ensureIndexes } from './indexes.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MongoDBStorageAdapterOptions {
  /**
   * MongoDB connection URI.
   * @example "mongodb://localhost:27017/openthreads"
   */
  uri: string;
  /**
   * Database name. Defaults to the database in the URI, or "openthreads".
   */
  dbName?: string;
  /**
   * Additional MongoClient options.
   */
  clientOptions?: MongoClientOptions;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * MongoDB implementation of the OpenThreads `StorageAdapter` interface.
 *
 * Features:
 * - Native MongoDB connection pooling via MongoClient.
 * - Graceful shutdown via `disconnect()`.
 * - All required indexes (unique, compound, TTL) ensured on `connect()`.
 * - Thread-safe: MongoClient is designed for concurrent use.
 */
export class MongoDBStorageAdapter implements StorageAdapter {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private db: Db | null = null;
  private connected = false;

  constructor(options: MongoDBStorageAdapterOptions) {
    this.client = new MongoClient(options.uri, {
      // Sensible defaults for production use.
      maxPoolSize: 10,
      minPoolSize: 2,
      connectTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      serverSelectionTimeoutMS: 10_000,
      ...options.clientOptions,
    });
    this.dbName = options.dbName ?? 'openthreads';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await ensureIndexes(this.db);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.db = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Collection accessors (private helpers)
  // -------------------------------------------------------------------------

  private col<T extends object>(name: string): Collection<T> {
    if (!this.db) throw new Error('MongoDBStorageAdapter: not connected');
    return this.db.collection<T>(name);
  }

  private get channels(): Collection<ChannelDoc> {
    return this.col<ChannelDoc>('channels');
  }

  private get recipients(): Collection<RecipientDoc> {
    return this.col<RecipientDoc>('recipients');
  }

  private get threads(): Collection<ThreadDoc> {
    return this.col<ThreadDoc>('threads');
  }

  private get turns(): Collection<TurnDoc> {
    return this.col<TurnDoc>('turns');
  }

  private get routes(): Collection<RouteDoc> {
    return this.col<RouteDoc>('routes');
  }

  private get tokens(): Collection<TokenDoc> {
    return this.col<TokenDoc>('tokens');
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  async getChannel(channelId: string): Promise<Channel | null> {
    const doc = await this.channels.findOne({ channelId });
    return doc ? channelFromDoc(doc) : null;
  }

  async listChannels(options: PageOptions = {}): Promise<Channel[]> {
    const { limit = 100, offset = 0 } = options;
    const docs = await this.channels
      .find({})
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(channelFromDoc);
  }

  async createChannel(
    channel: Omit<Channel, 'createdAt' | 'updatedAt'>,
  ): Promise<Channel> {
    const now = new Date();
    const doc: ChannelDoc = {
      _id: new ObjectId(),
      ...channel,
      createdAt: now,
      updatedAt: now,
    };
    await this.channels.insertOne(doc);
    return channelFromDoc(doc);
  }

  async updateChannel(
    channelId: string,
    updates: Partial<Omit<Channel, 'channelId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Channel | null> {
    const now = new Date();
    const result = await this.channels.findOneAndUpdate(
      { channelId },
      { $set: { ...updates, updatedAt: now } },
      { returnDocument: 'after' },
    );
    return result ? channelFromDoc(result) : null;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const result = await this.channels.deleteOne({ channelId });
    return result.deletedCount === 1;
  }

  // -------------------------------------------------------------------------
  // Recipients
  // -------------------------------------------------------------------------

  async getRecipient(recipientId: string): Promise<Recipient | null> {
    const doc = await this.recipients.findOne({ recipientId });
    return doc ? recipientFromDoc(doc) : null;
  }

  async listRecipients(options: PageOptions = {}): Promise<Recipient[]> {
    const { limit = 100, offset = 0 } = options;
    const docs = await this.recipients
      .find({})
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(recipientFromDoc);
  }

  async createRecipient(
    recipient: Omit<Recipient, 'createdAt' | 'updatedAt'>,
  ): Promise<Recipient> {
    const now = new Date();
    const doc: RecipientDoc = {
      _id: new ObjectId(),
      ...recipient,
      createdAt: now,
      updatedAt: now,
    };
    await this.recipients.insertOne(doc);
    return recipientFromDoc(doc);
  }

  async updateRecipient(
    recipientId: string,
    updates: Partial<
      Omit<Recipient, 'recipientId' | 'createdAt' | 'updatedAt'>
    >,
  ): Promise<Recipient | null> {
    const now = new Date();
    const result = await this.recipients.findOneAndUpdate(
      { recipientId },
      { $set: { ...updates, updatedAt: now } },
      { returnDocument: 'after' },
    );
    return result ? recipientFromDoc(result) : null;
  }

  async deleteRecipient(recipientId: string): Promise<boolean> {
    const result = await this.recipients.deleteOne({ recipientId });
    return result.deletedCount === 1;
  }

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  async getThread(threadId: string): Promise<Thread | null> {
    const doc = await this.threads.findOne({ threadId });
    return doc ? threadFromDoc(doc) : null;
  }

  async getThreadByNative(
    channelId: string,
    nativeThreadId: string,
  ): Promise<Thread | null> {
    const doc = await this.threads.findOne({ channelId, nativeThreadId });
    return doc ? threadFromDoc(doc) : null;
  }

  async getThreadsByTarget(
    channelId: string,
    targetId: string,
    options: PageOptions = {},
  ): Promise<Thread[]> {
    const { limit = 100, offset = 0 } = options;
    const docs = await this.threads
      .find({ channelId, targetId })
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(threadFromDoc);
  }

  async createThread(
    thread: Omit<Thread, 'createdAt' | 'updatedAt'>,
  ): Promise<Thread> {
    const now = new Date();
    const doc: ThreadDoc = {
      _id: new ObjectId(),
      ...thread,
      createdAt: now,
      updatedAt: now,
    };
    await this.threads.insertOne(doc);
    return threadFromDoc(doc);
  }

  async updateThread(
    threadId: string,
    updates: Partial<Omit<Thread, 'threadId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Thread | null> {
    const now = new Date();
    const result = await this.threads.findOneAndUpdate(
      { threadId },
      { $set: { ...updates, updatedAt: now } },
      { returnDocument: 'after' },
    );
    return result ? threadFromDoc(result) : null;
  }

  async deleteThread(threadId: string): Promise<boolean> {
    const result = await this.threads.deleteOne({ threadId });
    return result.deletedCount === 1;
  }

  // -------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------

  async getTurn(turnId: string): Promise<Turn | null> {
    const doc = await this.turns.findOne({ turnId });
    return doc ? turnFromDoc(doc) : null;
  }

  async getTurnsByThread(
    threadId: string,
    options: TurnQueryOptions = {},
  ): Promise<Turn[]> {
    const { limit = 50, offset = 0, before, after } = options;

    const filter: Filter<TurnDoc> = { threadId };
    if (before || after) {
      filter.timestamp = {};
      if (before) filter.timestamp.$lt = before;
      if (after) filter.timestamp.$gt = after;
    }

    const docs = await this.turns
      .find(filter)
      .sort({ timestamp: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(turnFromDoc);
  }

  async createTurn(
    turn: Omit<Turn, 'createdAt' | 'updatedAt'>,
  ): Promise<Turn> {
    const now = new Date();
    const doc: TurnDoc = {
      _id: new ObjectId(),
      ...turn,
      createdAt: now,
      updatedAt: now,
    };
    await this.turns.insertOne(doc);
    return turnFromDoc(doc);
  }

  async updateTurn(
    turnId: string,
    updates: Partial<Omit<Turn, 'turnId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Turn | null> {
    const now = new Date();
    const result = await this.turns.findOneAndUpdate(
      { turnId },
      { $set: { ...updates, updatedAt: now } },
      { returnDocument: 'after' },
    );
    return result ? turnFromDoc(result) : null;
  }

  async deleteTurn(turnId: string): Promise<boolean> {
    const result = await this.turns.deleteOne({ turnId });
    return result.deletedCount === 1;
  }

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  async getRoute(routeId: string): Promise<Route | null> {
    const doc = await this.routes.findOne({ routeId });
    return doc ? routeFromDoc(doc) : null;
  }

  async listRoutes(options: PageOptions = {}): Promise<Route[]> {
    const { limit = 100, offset = 0 } = options;
    const docs = await this.routes
      .find({})
      .sort({ priority: -1, createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(routeFromDoc);
  }

  async findMatchingRoutes(criteria: RouteCriteria): Promise<Route[]> {
    // For each criteria field in the incoming context, a route matches if:
    //  (a) the route has that field set to the matching value, OR
    //  (b) the route does NOT have that field set (wildcard / catch-all).
    //
    // We achieve (a) and (b) by querying with { $in: [value, null] }.
    // MongoDB treats a missing field as null in an $in query.
    const criteriaFilter: Record<string, unknown> = {};

    if (criteria.channelId !== undefined) {
      criteriaFilter['criteria.channelId'] = { $in: [criteria.channelId, null] };
    }
    if (criteria.targetId !== undefined) {
      criteriaFilter['criteria.targetId'] = { $in: [criteria.targetId, null] };
    }
    if (criteria.senderId !== undefined) {
      criteriaFilter['criteria.senderId'] = { $in: [criteria.senderId, null] };
    }
    if (criteria.threadId !== undefined) {
      criteriaFilter['criteria.threadId'] = { $in: [criteria.threadId, null] };
    }
    if (criteria.isDM !== undefined) {
      criteriaFilter['criteria.isDM'] = { $in: [criteria.isDM, null] };
    }
    if (criteria.mentionOnly !== undefined) {
      criteriaFilter['criteria.mentionOnly'] = { $in: [criteria.mentionOnly, null] };
    }

    const docs = await this.routes
      .find({ active: true, ...criteriaFilter } as Filter<RouteDoc>)
      .sort({ priority: -1 })
      .toArray();

    // Post-process contentPattern (regex) — cannot be efficiently indexed.
    const routes = docs.map(routeFromDoc);
    return routes.filter((route) => {
      if (!route.criteria.contentPattern) return true;
      if (criteria.contentPattern === undefined) return false;
      const regex = new RegExp(route.criteria.contentPattern, 'i');
      return regex.test(criteria.contentPattern);
    });
  }

  async createRoute(
    route: Omit<Route, 'createdAt' | 'updatedAt'>,
  ): Promise<Route> {
    const now = new Date();
    const doc: RouteDoc = {
      _id: new ObjectId(),
      ...route,
      createdAt: now,
      updatedAt: now,
    };
    await this.routes.insertOne(doc);
    return routeFromDoc(doc);
  }

  async updateRoute(
    routeId: string,
    updates: Partial<Omit<Route, 'routeId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Route | null> {
    const now = new Date();
    const result = await this.routes.findOneAndUpdate(
      { routeId },
      { $set: { ...updates, updatedAt: now } },
      { returnDocument: 'after' },
    );
    return result ? routeFromDoc(result) : null;
  }

  async deleteRoute(routeId: string): Promise<boolean> {
    const result = await this.routes.deleteOne({ routeId });
    return result.deletedCount === 1;
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  async getTokenByValue(value: string): Promise<Token | null> {
    const doc = await this.tokens.findOne({ value });
    return doc ? tokenFromDoc(doc) : null;
  }

  async createToken(token: Omit<Token, 'createdAt'>): Promise<Token> {
    const doc: TokenDoc = {
      _id: new ObjectId(),
      ...token,
      createdAt: new Date(),
    };
    await this.tokens.insertOne(doc);
    return tokenFromDoc(doc);
  }

  async deleteToken(value: string): Promise<boolean> {
    const result = await this.tokens.deleteOne({ value });
    return result.deletedCount === 1;
  }
}
