import type { Channel, CreateChannelInput } from '../types/channel.js';
import type { Recipient, CreateRecipientInput } from '../types/recipient.js';
import type { Thread, CreateThreadInput } from '../types/thread.js';
import type { Turn, CreateTurnInput } from '../types/turn.js';
import type { Route, CreateRouteInput, RouteCriteria } from '../types/route.js';
import type { Token } from '../types/envelope.js';

/**
 * CRUD operations for a given entity type.
 */
export interface CrudOperations<T, TCreate = T> {
  create(input: TCreate): Promise<T>;
  getById(id: string): Promise<T | null>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  list(): Promise<T[]>;
}

/**
 * Thread-specific storage operations (extends basic CRUD with domain queries).
 */
export interface ThreadOperations {
  create(input: CreateThreadInput): Promise<Thread>;
  getById(threadId: string): Promise<Thread | null>;
  /** Look up a thread by its native platform thread ID within a channel */
  getByNativeId(channelId: string, nativeThreadId: string): Promise<Thread | null>;
  /** List all threads belonging to a channel */
  listByChannel(channelId: string): Promise<Thread[]>;
}

/**
 * Turn-specific storage operations.
 */
export interface TurnOperations {
  create(input: CreateTurnInput): Promise<Turn>;
  /** List all turns for a given thread, ordered by timestamp ascending */
  listByThread(threadId: string): Promise<Turn[]>;
}

/**
 * Route-specific storage operations (extends basic CRUD with matching logic).
 */
export interface RouteOperations extends CrudOperations<Route, CreateRouteInput> {
  /**
   * Find all enabled routes whose criteria match the given incoming message criteria.
   * Results are ordered by priority (ascending).
   */
  match(criteria: RouteCriteria): Promise<Route[]>;
}

/**
 * Token storage input for creating an ephemeral reply token.
 */
export interface CreateTokenInput {
  threadId: string;
  /** Time-to-live in seconds. Defaults to 86400 (24h) if not specified. */
  ttl?: number;
}

/**
 * Token-specific storage operations.
 */
export interface TokenOperations {
  /** Create an ephemeral token scoped to a thread with the given TTL */
  create(input: CreateTokenInput): Promise<Token>;
  /** Validate a token string — returns the token record if valid, null if expired/revoked/unknown */
  validate(tokenId: string): Promise<Token | null>;
  /** Revoke a token, preventing future use */
  revoke(tokenId: string): Promise<boolean>;
}

/**
 * Abstract storage adapter interface.
 *
 * Every persistence implementation (MongoDB, Postgres, SQLite, in-memory, etc.)
 * must implement this interface. The interface is intentionally fully abstract —
 * no implementation details leak through.
 *
 * @example
 * ```ts
 * import type { StorageAdapter } from '@openthreads/core';
 *
 * class MongoStorageAdapter implements StorageAdapter {
 *   // ...
 * }
 * ```
 */
export interface StorageAdapter {
  /** Channel CRUD operations */
  channels: CrudOperations<Channel, CreateChannelInput>;
  /** Recipient CRUD operations */
  recipients: CrudOperations<Recipient, CreateRecipientInput>;
  /** Thread domain operations */
  threads: ThreadOperations;
  /** Turn domain operations */
  turns: TurnOperations;
  /** Route CRUD + match operations */
  routes: RouteOperations;
  /** Ephemeral token lifecycle operations */
  tokens: TokenOperations;
}

/**
 * Factory pattern for pluggable storage adapter instantiation.
 *
 * Storage packages (e.g., @openthreads/storage-mongodb) export a class
 * implementing this interface, allowing the server to instantiate adapters
 * from configuration without compile-time dependencies.
 *
 * @example
 * ```ts
 * import type { StorageAdapterFactory } from '@openthreads/core';
 *
 * export class MongoStorageAdapterFactory implements StorageAdapterFactory {
 *   async create(config: MongoConfig): Promise<StorageAdapter> {
 *     return new MongoStorageAdapter(config);
 *   }
 * }
 * ```
 */
export interface StorageAdapterFactory<TConfig = unknown> {
  /**
   * Instantiate and return a ready-to-use StorageAdapter from the given config.
   * Implementations should establish any connections needed here.
   */
  create(config: TConfig): Promise<StorageAdapter>;
}
