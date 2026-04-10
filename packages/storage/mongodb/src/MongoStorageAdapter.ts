import {
  MongoClient,
  type Collection,
  type Db,
  type Document,
  type Filter,
  type UpdateFilter,
} from 'mongodb';
import type { StorageAdapter } from '@openthreads/core';
import type {
  Channel,
  ChannelInput,
  Recipient,
  RecipientInput,
  Thread,
  ThreadInput,
  Turn,
  TurnInput,
  Route,
  RouteCriteria,
  RouteInput,
  Token,
  TokenInput,
} from '@openthreads/core';
import {
  ensureChannelsIndexes,
  ensureRecipientsIndexes,
  ensureThreadsIndexes,
  ensureTurnsIndexes,
  ensureRoutesIndexes,
  ensureTokensIndexes,
} from './indexes.js';

export interface MongoStorageAdapterOptions {
  /** MongoDB connection URI (e.g. "mongodb://localhost:27017") */
  uri: string;
  /** Database name to use (default: "openthreads") */
  dbName?: string;
  /** Maximum number of connections in the pool (default: 10) */
  maxPoolSize?: number;
  /** Minimum number of connections in the pool (default: 2) */
  minPoolSize?: number;
  /** Connection timeout in ms (default: 10000) */
  connectTimeoutMS?: number;
  /** Server selection timeout in ms (default: 10000) */
  serverSelectionTimeoutMS?: number;
}

/**
 * MongoDB implementation of the OpenThreads StorageAdapter.
 *
 * Features:
 * - Connection pooling via the native mongodb driver
 * - All required indexes created on connect()
 * - TTL index on tokens.expiresAt for automatic expiry
 * - Graceful shutdown via disconnect()
 */
export class MongoStorageAdapter implements StorageAdapter {
  private client: MongoClient;
  private db: Db | null = null;
  private readonly dbName: string;
  private connected = false;

  constructor(private readonly options: MongoStorageAdapterOptions) {
    this.dbName = options.dbName ?? 'openthreads';
    this.client = new MongoClient(options.uri, {
      maxPoolSize: options.maxPoolSize ?? 10,
      minPoolSize: options.minPoolSize ?? 2,
      connectTimeoutMS: options.connectTimeoutMS ?? 10_000,
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.ensureAllIndexes();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.db = null;
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    try {
      await this.getDb().command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Channels ──────────────────────────────────────────────────────────────

  async createChannel(input: ChannelInput): Promise<Channel> {
    const now = new Date();
    const doc: Channel = { ...input, createdAt: now, updatedAt: now };
    await this.channels().insertOne(doc as unknown as Document);
    return doc;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    return (await this.channels().findOne(
      { channelId } as Filter<Document>
    )) as Channel | null;
  }

  async getChannelByApiKey(apiKey: string): Promise<Channel | null> {
    return (await this.channels().findOne(
      { apiKey } as Filter<Document>
    )) as Channel | null;
  }

  async updateChannel(channelId: string, updates: Partial<ChannelInput>): Promise<Channel | null> {
    const result = await this.channels().findOneAndUpdate(
      { channelId } as Filter<Document>,
      { $set: { ...updates, updatedAt: new Date() } } as UpdateFilter<Document>,
      { returnDocument: 'after' }
    );
    return result as Channel | null;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const result = await this.channels().deleteOne({ channelId } as Filter<Document>);
    return result.deletedCount === 1;
  }

  async listChannels(filter?: { active?: boolean; type?: string }): Promise<Channel[]> {
    const query: Record<string, unknown> = {};
    if (filter?.active !== undefined) query['active'] = filter.active;
    if (filter?.type !== undefined) query['type'] = filter.type;
    return (await this.channels().find(query as Filter<Document>).toArray()) as Channel[];
  }

  // ─── Recipients ────────────────────────────────────────────────────────────

  async createRecipient(input: RecipientInput): Promise<Recipient> {
    const now = new Date();
    const doc: Recipient = { ...input, createdAt: now, updatedAt: now };
    await this.recipients().insertOne(doc as unknown as Document);
    return doc;
  }

  async getRecipient(recipientId: string): Promise<Recipient | null> {
    return (await this.recipients().findOne(
      { recipientId } as Filter<Document>
    )) as Recipient | null;
  }

  async updateRecipient(
    recipientId: string,
    updates: Partial<RecipientInput>
  ): Promise<Recipient | null> {
    const result = await this.recipients().findOneAndUpdate(
      { recipientId } as Filter<Document>,
      { $set: { ...updates, updatedAt: new Date() } } as UpdateFilter<Document>,
      { returnDocument: 'after' }
    );
    return result as Recipient | null;
  }

  async deleteRecipient(recipientId: string): Promise<boolean> {
    const result = await this.recipients().deleteOne({ recipientId } as Filter<Document>);
    return result.deletedCount === 1;
  }

  async listRecipients(filter?: { active?: boolean }): Promise<Recipient[]> {
    const query: Record<string, unknown> = {};
    if (filter?.active !== undefined) query['active'] = filter.active;
    return (await this.recipients().find(query as Filter<Document>).toArray()) as Recipient[];
  }

  // ─── Threads ───────────────────────────────────────────────────────────────

  async createThread(input: ThreadInput): Promise<Thread> {
    const now = new Date();
    const doc: Thread = { ...input, createdAt: now, updatedAt: now };
    await this.threads().insertOne(doc as unknown as Document);
    return doc;
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return (await this.threads().findOne(
      { threadId } as Filter<Document>
    )) as Thread | null;
  }

  async getThreadByNativeId(channelId: string, nativeThreadId: string): Promise<Thread | null> {
    return (await this.threads().findOne(
      { channelId, nativeThreadId } as Filter<Document>
    )) as Thread | null;
  }

  async getMainThread(channelId: string, targetId: string): Promise<Thread | null> {
    return (await this.threads().findOne(
      { channelId, targetId, isMain: true } as Filter<Document>
    )) as Thread | null;
  }

  async updateThread(threadId: string, updates: Partial<ThreadInput>): Promise<Thread | null> {
    const result = await this.threads().findOneAndUpdate(
      { threadId } as Filter<Document>,
      { $set: { ...updates, updatedAt: new Date() } } as UpdateFilter<Document>,
      { returnDocument: 'after' }
    );
    return result as Thread | null;
  }

  async deleteThread(threadId: string): Promise<boolean> {
    const result = await this.threads().deleteOne({ threadId } as Filter<Document>);
    return result.deletedCount === 1;
  }

  async listThreadsByChannel(
    channelId: string,
    limit = 50,
    offset = 0
  ): Promise<Thread[]> {
    return (await this.threads()
      .find({ channelId } as Filter<Document>)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()) as Thread[];
  }

  // ─── Turns ─────────────────────────────────────────────────────────────────

  async createTurn(input: TurnInput): Promise<Turn> {
    const now = new Date();
    const doc: Turn = { ...input, createdAt: now, updatedAt: now };
    await this.turns().insertOne(doc as unknown as Document);
    return doc;
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    return (await this.turns().findOne(
      { turnId } as Filter<Document>
    )) as Turn | null;
  }

  async getTurnsForThread(threadId: string, limit = 100, offset = 0): Promise<Turn[]> {
    return (await this.turns()
      .find({ threadId } as Filter<Document>)
      .sort({ timestamp: 1 })
      .skip(offset)
      .limit(limit)
      .toArray()) as Turn[];
  }

  async updateTurn(turnId: string, updates: Partial<TurnInput>): Promise<Turn | null> {
    const result = await this.turns().findOneAndUpdate(
      { turnId } as Filter<Document>,
      { $set: { ...updates, updatedAt: new Date() } } as UpdateFilter<Document>,
      { returnDocument: 'after' }
    );
    return result as Turn | null;
  }

  // ─── Routes ────────────────────────────────────────────────────────────────

  async createRoute(input: RouteInput): Promise<Route> {
    const now = new Date();
    const doc: Route = { ...input, createdAt: now, updatedAt: now };
    await this.routes().insertOne(doc as unknown as Document);
    return doc;
  }

  async getRoute(routeId: string): Promise<Route | null> {
    return (await this.routes().findOne(
      { routeId } as Filter<Document>
    )) as Route | null;
  }

  async findMatchingRoutes(criteria: Partial<RouteCriteria>): Promise<Route[]> {
    // Build a query that matches routes where each defined criteria field matches.
    // A route field being undefined/absent means "match any" (not stored = wildcard).
    const conditions: Filter<Document>[] = [{ active: true }];

    const criteriaFields = [
      'channelId',
      'channelType',
      'targetId',
      'threadId',
      'senderId',
      'isDM',
    ] as const;

    for (const field of criteriaFields) {
      const value = criteria[field];
      if (value !== undefined) {
        // Match routes that either explicitly match this value OR have no criteria for this field
        conditions.push({
          $or: [
            { [`criteria.${field}`]: value },
            { [`criteria.${field}`]: { $exists: false } },
            { [`criteria.${field}`]: null },
          ],
        } as unknown as Filter<Document>);
      }
    }

    return (await this.routes()
      .find({ $and: conditions } as Filter<Document>)
      .sort({ priority: 1 })
      .toArray()) as Route[];
  }

  async updateRoute(routeId: string, updates: Partial<RouteInput>): Promise<Route | null> {
    const result = await this.routes().findOneAndUpdate(
      { routeId } as Filter<Document>,
      { $set: { ...updates, updatedAt: new Date() } } as UpdateFilter<Document>,
      { returnDocument: 'after' }
    );
    return result as Route | null;
  }

  async deleteRoute(routeId: string): Promise<boolean> {
    const result = await this.routes().deleteOne({ routeId } as Filter<Document>);
    return result.deletedCount === 1;
  }

  async listRoutes(filter?: { active?: boolean; recipientId?: string }): Promise<Route[]> {
    const query: Record<string, unknown> = {};
    if (filter?.active !== undefined) query['active'] = filter.active;
    if (filter?.recipientId !== undefined) query['recipientId'] = filter.recipientId;
    return (await this.routes()
      .find(query as Filter<Document>)
      .sort({ priority: 1 })
      .toArray()) as Route[];
  }

  // ─── Tokens ────────────────────────────────────────────────────────────────

  async createToken(input: TokenInput): Promise<Token> {
    const doc: Token = { ...input, createdAt: new Date() };
    await this.tokens().insertOne(doc as unknown as Document);
    return doc;
  }

  async getTokenByValue(value: string): Promise<Token | null> {
    return (await this.tokens().findOne(
      { value, used: false, expiresAt: { $gt: new Date() } } as Filter<Document>
    )) as Token | null;
  }

  async consumeToken(value: string): Promise<boolean> {
    const result = await this.tokens().updateOne(
      { value, used: false, expiresAt: { $gt: new Date() } } as Filter<Document>,
      { $set: { used: true } } as UpdateFilter<Document>
    );
    return result.modifiedCount === 1;
  }

  async deleteExpiredTokens(): Promise<number> {
    const result = await this.tokens().deleteMany(
      { expiresAt: { $lte: new Date() } } as Filter<Document>
    );
    return result.deletedCount;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getDb(): Db {
    if (!this.db) {
      throw new Error(
        'MongoStorageAdapter: not connected. Call connect() before using the adapter.'
      );
    }
    return this.db;
  }

  private channels(): Collection {
    return this.getDb().collection('channels');
  }

  private recipients(): Collection {
    return this.getDb().collection('recipients');
  }

  private threads(): Collection {
    return this.getDb().collection('threads');
  }

  private turns(): Collection {
    return this.getDb().collection('turns');
  }

  private routes(): Collection {
    return this.getDb().collection('routes');
  }

  private tokens(): Collection {
    return this.getDb().collection('tokens');
  }

  private async ensureAllIndexes(): Promise<void> {
    const db = this.getDb();
    await Promise.all([
      ensureChannelsIndexes(db.collection('channels')),
      ensureRecipientsIndexes(db.collection('recipients')),
      ensureThreadsIndexes(db.collection('threads')),
      ensureTurnsIndexes(db.collection('turns')),
      ensureRoutesIndexes(db.collection('routes')),
      ensureTokensIndexes(db.collection('tokens')),
    ]);
  }
}
