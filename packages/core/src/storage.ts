import type {
  Channel,
  Recipient,
  Thread,
  Turn,
  Route,
  RouteCriteria,
  Token,
} from './types.js';

// ---------------------------------------------------------------------------
// Pagination / query helpers
// ---------------------------------------------------------------------------

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface TurnQueryOptions extends PageOptions {
  /** Return turns with timestamp strictly before this value (cursor-based pagination). */
  before?: Date;
  /** Return turns with timestamp strictly after this value. */
  after?: Date;
}

// ---------------------------------------------------------------------------
// StorageAdapter
// ---------------------------------------------------------------------------

/**
 * Pluggable persistence interface for OpenThreads.
 *
 * All implementations must be safe for concurrent use.
 * Methods return `null` when a document is not found.
 * Create methods return the persisted document (including server-set timestamps).
 */
export interface StorageAdapter {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Establish a connection to the backing store. */
  connect(): Promise<void>;

  /** Gracefully close the connection. */
  disconnect(): Promise<void>;

  /** Whether the adapter currently has an active connection. */
  isConnected(): boolean;

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  getChannel(channelId: string): Promise<Channel | null>;

  listChannels(options?: PageOptions): Promise<Channel[]>;

  createChannel(
    channel: Omit<Channel, 'createdAt' | 'updatedAt'>,
  ): Promise<Channel>;

  updateChannel(
    channelId: string,
    updates: Partial<Omit<Channel, 'channelId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Channel | null>;

  deleteChannel(channelId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Recipients
  // -------------------------------------------------------------------------

  getRecipient(recipientId: string): Promise<Recipient | null>;

  listRecipients(options?: PageOptions): Promise<Recipient[]>;

  createRecipient(
    recipient: Omit<Recipient, 'createdAt' | 'updatedAt'>,
  ): Promise<Recipient>;

  updateRecipient(
    recipientId: string,
    updates: Partial<Omit<Recipient, 'recipientId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Recipient | null>;

  deleteRecipient(recipientId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  getThread(threadId: string): Promise<Thread | null>;

  /**
   * Find a thread by its native platform thread ID within a channel.
   * Supports the index on `channelId + nativeThreadId`.
   */
  getThreadByNative(
    channelId: string,
    nativeThreadId: string,
  ): Promise<Thread | null>;

  /**
   * Find threads belonging to a specific target (group/user) within a channel.
   * Supports the index on `channelId + targetId`.
   */
  getThreadsByTarget(
    channelId: string,
    targetId: string,
    options?: PageOptions,
  ): Promise<Thread[]>;

  createThread(
    thread: Omit<Thread, 'createdAt' | 'updatedAt'>,
  ): Promise<Thread>;

  updateThread(
    threadId: string,
    updates: Partial<Omit<Thread, 'threadId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Thread | null>;

  deleteThread(threadId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------

  getTurn(turnId: string): Promise<Turn | null>;

  /**
   * List turns belonging to a thread, ordered by `timestamp` ascending.
   * Supports the compound index on `threadId + timestamp`.
   */
  getTurnsByThread(
    threadId: string,
    options?: TurnQueryOptions,
  ): Promise<Turn[]>;

  createTurn(
    turn: Omit<Turn, 'createdAt' | 'updatedAt'>,
  ): Promise<Turn>;

  updateTurn(
    turnId: string,
    updates: Partial<Omit<Turn, 'turnId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Turn | null>;

  deleteTurn(turnId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  getRoute(routeId: string): Promise<Route | null>;

  listRoutes(options?: PageOptions): Promise<Route[]>;

  /**
   * Find all active routes whose criteria match the given context.
   * Results are ordered by `priority` descending.
   */
  findMatchingRoutes(criteria: RouteCriteria): Promise<Route[]>;

  createRoute(
    route: Omit<Route, 'createdAt' | 'updatedAt'>,
  ): Promise<Route>;

  updateRoute(
    routeId: string,
    updates: Partial<Omit<Route, 'routeId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Route | null>;

  deleteRoute(routeId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  /** Look up a token by its value (the ot_tk_... string embedded in URLs). */
  getTokenByValue(value: string): Promise<Token | null>;

  createToken(token: Omit<Token, 'createdAt'>): Promise<Token>;

  /** Revoke a token before its TTL expiry. */
  deleteToken(value: string): Promise<boolean>;
}
