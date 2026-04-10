import type { Channel, ChannelInput } from '../types/channel.js';
import type { Recipient, RecipientInput } from '../types/recipient.js';
import type { Thread, ThreadInput } from '../types/thread.js';
import type { Turn, TurnInput } from '../types/turn.js';
import type { Route, RouteCriteria, RouteInput } from '../types/route.js';
import type { Token, TokenInput } from '../types/token.js';

/**
 * StorageAdapter — the abstract persistence interface for OpenThreads.
 *
 * Implementations must handle all CRUD operations for the six core collections:
 * channels, recipients, threads, turns, routes, and tokens.
 *
 * The default implementation is @openthreads/storage-mongodb.
 * Users can supply alternative implementations (Postgres, SQLite, etc.)
 * by creating a package that implements this interface.
 */
export interface StorageAdapter {
  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Establish the connection to the underlying storage. */
  connect(): Promise<void>;

  /** Gracefully close the connection and release all resources. */
  disconnect(): Promise<void>;

  /** Check whether the storage backend is reachable. */
  ping(): Promise<boolean>;

  // ─── Channels ─────────────────────────────────────────────────────────────

  createChannel(input: ChannelInput): Promise<Channel>;
  getChannel(channelId: string): Promise<Channel | null>;
  getChannelByApiKey(apiKey: string): Promise<Channel | null>;
  updateChannel(channelId: string, updates: Partial<ChannelInput>): Promise<Channel | null>;
  deleteChannel(channelId: string): Promise<boolean>;
  listChannels(filter?: { active?: boolean; type?: string }): Promise<Channel[]>;

  // ─── Recipients ───────────────────────────────────────────────────────────

  createRecipient(input: RecipientInput): Promise<Recipient>;
  getRecipient(recipientId: string): Promise<Recipient | null>;
  updateRecipient(recipientId: string, updates: Partial<RecipientInput>): Promise<Recipient | null>;
  deleteRecipient(recipientId: string): Promise<boolean>;
  listRecipients(filter?: { active?: boolean }): Promise<Recipient[]>;

  // ─── Threads ──────────────────────────────────────────────────────────────

  createThread(input: ThreadInput): Promise<Thread>;
  getThread(threadId: string): Promise<Thread | null>;
  /** Look up a thread by its native platform thread ID within a channel. */
  getThreadByNativeId(channelId: string, nativeThreadId: string): Promise<Thread | null>;
  /** Get or create the "main thread" for a channel+target pair. */
  getMainThread(channelId: string, targetId: string): Promise<Thread | null>;
  updateThread(threadId: string, updates: Partial<ThreadInput>): Promise<Thread | null>;
  deleteThread(threadId: string): Promise<boolean>;
  listThreadsByChannel(channelId: string, limit?: number, offset?: number): Promise<Thread[]>;

  // ─── Turns ────────────────────────────────────────────────────────────────

  createTurn(input: TurnInput): Promise<Turn>;
  getTurn(turnId: string): Promise<Turn | null>;
  /** Return all turns for a thread, ordered by timestamp ascending. */
  getTurnsForThread(threadId: string, limit?: number, offset?: number): Promise<Turn[]>;
  updateTurn(turnId: string, updates: Partial<TurnInput>): Promise<Turn | null>;

  // ─── Routes ───────────────────────────────────────────────────────────────

  createRoute(input: RouteInput): Promise<Route>;
  getRoute(routeId: string): Promise<Route | null>;
  /**
   * Find all active routes that could match the given criteria.
   * Returns results ordered by priority (ascending).
   */
  findMatchingRoutes(criteria: Partial<RouteCriteria>): Promise<Route[]>;
  updateRoute(routeId: string, updates: Partial<RouteInput>): Promise<Route | null>;
  deleteRoute(routeId: string): Promise<boolean>;
  listRoutes(filter?: { active?: boolean; recipientId?: string }): Promise<Route[]>;

  // ─── Tokens ───────────────────────────────────────────────────────────────

  createToken(input: TokenInput): Promise<Token>;
  getTokenByValue(value: string): Promise<Token | null>;
  /**
   * Mark a token as used. Returns false if the token was already used
   * or does not exist.
   */
  consumeToken(value: string): Promise<boolean>;
  deleteExpiredTokens(): Promise<number>;
}
