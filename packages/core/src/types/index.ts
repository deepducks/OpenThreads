/**
 * Core types for OpenThreads token, thread, and turn management.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** An ephemeral token issued alongside a replyTo URL, scoped to a specific thread. */
export interface TokenRecord {
  /** Token identifier with `ot_tk_` prefix. */
  id: string;
  /** The channel this token is scoped to. */
  channelId: string;
  /** The target (group or user) this token is scoped to. */
  targetId: string;
  /** The thread this token is scoped to. */
  threadId: string;
  /** Absolute expiry date. After this the token is considered invalid. */
  expiresAt: Date;
  /** When the token was explicitly revoked. If set, token is invalid. */
  revokedAt?: Date;
  createdAt: Date;
}

/** A channel-scoped API key for direct sending outside a replyTo context. */
export interface ChannelApiKeyRecord {
  /** Key identifier with `ot_ch_sk_` prefix. */
  id: string;
  /** The channel this key grants access to. */
  channelId: string;
  /** When the key was explicitly revoked. If set, key is invalid. */
  revokedAt?: Date;
  createdAt: Date;
}

export type TokenValidationResult =
  | { valid: true; token: TokenRecord }
  | { valid: false; reason: 'not_found' | 'expired' | 'revoked'; token?: TokenRecord };

export type ChannelApiKeyValidationResult =
  | { valid: true; key: ChannelApiKeyRecord }
  | { valid: false; reason: 'not_found' | 'revoked' | 'channel_mismatch'; key?: ChannelApiKeyRecord };

// ---------------------------------------------------------------------------
// Thread types
// ---------------------------------------------------------------------------

export type ThreadKind =
  /** 1:1 mapping with the platform's native thread (Slack thread, Discord forum post). */
  | 'native'
  /** Virtual thread built from a reply chain when the platform has no native threads. */
  | 'virtual'
  /** The implicit "main" thread that catches all messages outside explicit threads. */
  | 'main';

/** A conversation thread managed by OpenThreads. */
export interface ThreadRecord {
  /** Thread identifier with `ot_thr_` prefix. */
  id: string;
  /** The channel this thread lives in. */
  channelId: string;
  /** Target (group ID, user ID, channel name) within the channel. */
  targetId?: string;
  /** Platform-native thread identifier, when the channel has native thread support. */
  nativeThreadId?: string;
  /** How this thread was created. */
  kind: ThreadKind;
  /**
   * For virtual threads: the ordered list of native message IDs that form the
   * reply chain. The first element is the root message.
   */
  replyChain?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateThreadOptions {
  channelId: string;
  targetId?: string;
  /** Provide when the platform has native thread support. */
  nativeThreadId?: string;
}

export interface CreateVirtualThreadOptions {
  channelId: string;
  targetId?: string;
  /**
   * Ordered list of native message IDs that form the reply chain.
   * Must have at least one element (the root message).
   */
  replyChain: [string, ...string[]];
}

// ---------------------------------------------------------------------------
// Turn types
// ---------------------------------------------------------------------------

export type TurnDirection = 'inbound' | 'outbound';

/** A single sender-message → recipient-response cycle within a thread. */
export interface TurnRecord {
  /** Turn identifier with `ot_turn_` prefix. */
  id: string;
  /** The thread this turn belongs to. */
  threadId: string;
  /**
   * `inbound`  — message received from a sender (human → OpenThreads).
   * `outbound` — message sent to a recipient (OpenThreads → external system / channel).
   */
  direction: TurnDirection;
  /** Raw message payload (Chat SDK object, A2H intent, or arbitrary JSON). */
  message: unknown;
  /** Identifier of the human sender (when direction = 'inbound'). */
  senderId?: string;
  /** Identifier of the external recipient (when direction = 'outbound'). */
  recipientId?: string;
  createdAt: Date;
}

export interface CreateTurnOptions {
  threadId: string;
  direction: TurnDirection;
  message: unknown;
  senderId?: string;
  recipientId?: string;
}

// ---------------------------------------------------------------------------
// Storage adapter interface
// ---------------------------------------------------------------------------

/**
 * Abstract persistence interface.  All token, thread, and turn managers depend
 * on this interface — swap the concrete implementation (MongoDB, Postgres, …)
 * without touching business logic.
 */
export interface StorageAdapter {
  // ------ Token operations -----------------------------------------------

  /** Persist or update a token record. */
  saveToken(token: TokenRecord): Promise<void>;
  /** Look up a token by its ID. Returns `null` when not found. */
  getToken(tokenId: string): Promise<TokenRecord | null>;
  /** Permanently delete a token record. */
  deleteToken(tokenId: string): Promise<void>;

  // ------ Channel API key operations -------------------------------------

  /** Persist or update a channel API key record. */
  saveChannelApiKey(key: ChannelApiKeyRecord): Promise<void>;
  /** Look up a channel API key by its ID. Returns `null` when not found. */
  getChannelApiKey(keyId: string): Promise<ChannelApiKeyRecord | null>;
  /** Permanently delete a channel API key record. */
  deleteChannelApiKey(keyId: string): Promise<void>;

  // ------ Thread operations ----------------------------------------------

  /** Persist or update a thread record. */
  saveThread(thread: ThreadRecord): Promise<void>;
  /** Look up a thread by its OpenThreads ID. Returns `null` when not found. */
  getThread(threadId: string): Promise<ThreadRecord | null>;
  /**
   * Look up a thread by the platform's native thread ID within a channel.
   * Returns `null` when not found.
   */
  getThreadByNativeId(channelId: string, nativeThreadId: string): Promise<ThreadRecord | null>;
  /**
   * Look up the "main" thread for a (channel, target) pair.
   * Returns `null` when not found.
   */
  getMainThread(channelId: string, targetId: string): Promise<ThreadRecord | null>;
  /**
   * Look up threads by channel + target.
   * Returns an empty array when none are found.
   */
  getThreadsByChannelAndTarget(channelId: string, targetId: string): Promise<ThreadRecord[]>;

  // ------ Turn operations ------------------------------------------------

  /** Persist or update a turn record. */
  saveTurn(turn: TurnRecord): Promise<void>;
  /** Look up a turn by its ID. Returns `null` when not found. */
  getTurn(turnId: string): Promise<TurnRecord | null>;
  /**
   * Return all turns for a thread in chronological order (oldest first).
   */
  listTurnsByThread(threadId: string): Promise<TurnRecord[]>;
}
