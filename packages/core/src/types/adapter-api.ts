/**
 * Adapter API types — the concrete message and envelope types used by channel adapter
 * implementations (SlackAdapter, TelegramAdapter, etc.).
 *
 * These complement the abstract interfaces in interfaces/channel-adapter.ts and
 * provide the building blocks for the adapter-level API:
 *   initialize / shutdown / onMessage / send / sendA2H
 */

import type { A2HIntentMessage } from './a2h.js';

/**
 * A single item in an outbound envelope message array.
 * Either a plain text/media message (Chat SDK style) or an A2H intent.
 */
export type MessageItem = { text: string; [key: string]: unknown } | A2HIntentMessage;

/**
 * Inbound envelope — delivered to the message handler when a human sends a message.
 * Flows FROM the channel adapter TO the OpenThreads routing layer.
 */
export interface InboundEnvelope {
  /** OpenThreads thread identifier (ot_thr_* or platform message ID for virtual threads) */
  threadId: string;
  /** OpenThreads turn identifier */
  turnId: string;
  /** Pre-authenticated URL for the recipient system to POST a reply */
  replyTo: string;
  /** Channel and sender context */
  source: {
    /** Platform identifier (e.g., "slack", "telegram") */
    channel: string;
    /** Platform-native chat/channel ID */
    channelId: string;
    /** The human sender */
    sender: {
      /** Platform-native user ID */
      id: string;
      /** Display name */
      name?: string;
    };
    /** Raw platform event payload, for adapter-specific use */
    raw?: unknown;
  };
  /** The message content */
  message: MessageItem | MessageItem[];
}

/**
 * Outbound envelope — passed to `adapter.send()` to deliver a message to a human.
 * Flows FROM the OpenThreads routing layer TO the channel adapter.
 */
export interface OutboundEnvelope {
  /** Platform-native chat/channel ID */
  channelId: string;
  /** Platform-native target user or group ID (optional — may be encoded in channelId) */
  targetId?: string;
  /** Platform-native thread or message ID to reply within */
  threadId?: string;
  /** The message(s) to send */
  message: MessageItem | MessageItem[];
}

/**
 * Result returned by `adapter.send()`.
 */
export interface SendResult {
  /** Platform-native ID of the sent message */
  messageId: string;
  /** Platform-native thread ID (equals messageId for message-starts-thread platforms) */
  threadId?: string;
}

/**
 * Response from a blocking A2H interaction.
 * Returned by `adapter.sendA2H()` after the human responds.
 */
export interface A2HResponse {
  /** The id of the A2H intent that was resolved */
  intentId: string;
  /** The type of the resolved intent */
  type: 'INFORM' | 'AUTHORIZE' | 'COLLECT' | 'ESCALATE';
  /** For AUTHORIZE: whether the action was approved (`true`) or denied (`false`) */
  approved?: boolean;
  /** For COLLECT: the collected response text or selected option value */
  response?: string;
}

/**
 * Handler invoked when a new message arrives from a human via the channel.
 * Registered with `adapter.onMessage(handler)`.
 */
export type MessageHandler = (envelope: InboundEnvelope) => Promise<void>;

/**
 * Options for `adapter.sendA2H()`.
 */
export interface A2HSendOptions {
  /**
   * How long to wait for the human's response before timing out (ms).
   * Default is adapter-specific (typically 24h).
   */
  timeoutMs?: number;
}
