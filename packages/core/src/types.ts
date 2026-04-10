/**
 * Core data model types for OpenThreads.
 *
 * OpenThreads abstracts communication channels (Slack, Discord, Telegram, etc.)
 * into a unified ingress/egress interface with native human-in-the-loop support.
 */

// ─── Channel ────────────────────────────────────────────────────────────────

/**
 * A registered external messaging channel (e.g. a Slack bot, a Telegram bot).
 * Channels are the inbound interface — they surface human messages to OpenThreads.
 */
export interface Channel {
  /** Unique identifier for this channel registration */
  id: string;
  /** Human-readable name */
  name: string;
  /** Platform type (e.g. "slack", "discord", "telegram", "whatsapp") */
  platform: string;
  /** Whether this channel is currently active */
  enabled: boolean;
  /** Platform-specific configuration (tokens, webhook secrets, etc.) */
  config: Record<string, unknown>;
  /** API key issued to recipients for direct outbound sends */
  apiKey?: string;
}

// ─── Recipient ───────────────────────────────────────────────────────────────

/**
 * An external system (agent, API, service) that consumes routed messages.
 * Recipients are the outbound interface — OpenThreads delivers standardised
 * envelopes to them via HTTP webhooks.
 */
export interface Recipient {
  /** Unique identifier for this recipient */
  id: string;
  /** Human-readable name */
  name: string;
  /** Outbound webhook URL */
  url: string;
  /** Optional extra HTTP headers sent with every outbound request */
  headers?: Record<string, string>;
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * Criteria used to match an inbound message against a route.
 * All defined fields must match (AND semantics).
 * String fields support glob/wildcard patterns (* and ?).
 * Undefined fields are treated as "match everything" (wildcard).
 */
export interface RouteCriteria {
  /**
   * Channel ID(s) or glob pattern(s) to match.
   * An array is matched with OR semantics (any pattern may match).
   */
  channel?: string | string[];

  /**
   * Target (group or user) ID(s) or glob pattern(s) to match.
   * An array is matched with OR semantics.
   */
  target?: string | string[];

  /**
   * Sender ID(s) or glob pattern(s) to match.
   * An array is matched with OR semantics.
   */
  sender?: string | string[];

  /**
   * Content glob pattern(s) to match against message text.
   * An array is matched with OR semantics.
   */
  content?: string | string[];

  /**
   * When defined, only match messages that are (true) or are not (false) in a thread.
   */
  isThread?: boolean;

  /**
   * When defined, only match messages that do (true) or do not (false) mention the bot.
   */
  isMention?: boolean;

  /**
   * When defined, only match messages that are (true) or are not (false) direct messages.
   */
  isDM?: boolean;
}

/**
 * A routing rule that maps inbound messages matching its criteria to one or
 * more recipients (fan-out).  Routes are evaluated in descending priority order.
 */
export interface Route {
  /** Unique identifier for this route */
  id: string;
  /** Human-readable name */
  name: string;
  /** When false the route is skipped entirely during matching */
  enabled: boolean;
  /**
   * Numeric priority.  Higher values are matched first.
   * Routes with equal priority maintain their original order.
   */
  priority: number;
  /** Criteria that an inbound message must satisfy for this route to match */
  criteria: RouteCriteria;
  /**
   * One or more recipients that receive the message when this route matches.
   * All recipients receive the message (fan-out).
   */
  recipients: Recipient[];
}

// ─── InboundMessage ──────────────────────────────────────────────────────────

/**
 * Metadata about an incoming message from a channel.
 * This is the input to the route-matching engine.
 */
export interface InboundMessage {
  /** The ID of the channel the message arrived on */
  channel: string;
  /** The group or user target within the channel (e.g. Slack channel ID, user ID) */
  target: string;
  /** The sender's identifier (user ID or username) */
  sender: string;
  /** The textual content of the message */
  content: string;
  /** True when the message is inside a thread */
  isThread: boolean;
  /** True when the bot/account was explicitly mentioned in the message */
  isMention: boolean;
  /** True when the message arrived as a direct/private message */
  isDM: boolean;
}

// ─── Thread / Turn ───────────────────────────────────────────────────────────

/**
 * A conversation thread managed by OpenThreads.
 * Maps to a native thread on platforms that support it, or to a virtual
 * reply-chain on platforms that don't.
 */
export interface Thread {
  /** OpenThreads-assigned thread identifier (e.g. "ot_thr_abc123") */
  threadId: string;
  /** The channel this thread belongs to */
  channelId: string;
  /** The group or user target this thread belongs to */
  target: string;
  /** Platform-native thread reference (if any) */
  nativeThreadId?: string;
  /** ISO 8601 timestamp of thread creation */
  createdAt: string;
}

/**
 * A single sender-message → recipient-response cycle within a thread.
 */
export interface Turn {
  /** OpenThreads-assigned turn identifier (e.g. "ot_turn_001") */
  turnId: string;
  /** The thread this turn belongs to */
  threadId: string;
  /** ISO 8601 timestamp of turn creation */
  createdAt: string;
  /** Ephemeral reply URL scoped to this turn */
  replyTo: string;
}
