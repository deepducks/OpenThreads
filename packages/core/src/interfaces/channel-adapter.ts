import type {
  InboundEnvelope,
  OutboundEnvelope,
  SendResult,
  A2HResponse,
  MessageHandler,
  A2HSendOptions,
} from '../types/adapter-api.js';
import type { A2HIntentMessage } from '../types/a2h.js';

export type { InboundEnvelope, OutboundEnvelope, SendResult, A2HResponse, MessageHandler, A2HSendOptions };

/**
 * Platform capability flags. Adapters report what their platform supports
 * so the Reply Engine can choose the appropriate rendering method (1-4).
 */
export interface ChannelCapabilities {
  /** Whether the platform supports native threads (Slack threads, Discord forum threads) */
  threads: boolean;
  /** Whether the platform supports interactive button components */
  buttons: boolean;
  /** Whether the platform supports select/dropdown menu components */
  selectMenus: boolean;
  /** Whether the platform supports replying to a specific message (reply chains) */
  replyMessages: boolean;
  /** Whether the platform supports direct messages */
  dms: boolean;
  /** Whether the platform supports file/media uploads */
  fileUpload: boolean;
}

/**
 * Configuration passed to `register()` when setting up a channel adapter.
 * The actual shape is adapter-specific; this is the minimum required surface.
 */
export interface ChannelConfig {
  /** The OpenThreads channel ID this adapter instance represents */
  channelId: string;
  /** Arbitrary adapter-specific configuration (tokens, webhook secrets, etc.) */
  [key: string]: unknown;
}

/**
 * The rendered output of a platform-specific message.
 * Shape is platform-dependent (Slack Block Kit, Telegram Bot API payload, etc.).
 */
export type RenderedMessage = unknown;

/**
 * Abstract channel adapter interface.
 *
 * Each supported platform (Slack, Discord, Telegram, etc.) implements this interface.
 *
 * Lifecycle:
 *   1. Construct the adapter with platform credentials.
 *   2. Register a message handler via `onMessage()`.
 *   3. Call `initialize()` to start listening for events (webhook / socket mode).
 *   4. Use `send()` / `sendA2H()` to deliver messages and A2H intents to humans.
 *   5. Call `shutdown()` to stop the adapter gracefully.
 *
 * @example
 * ```ts
 * import type { ChannelAdapter } from '@openthreads/core';
 *
 * export class TelegramAdapter implements ChannelAdapter {
 *   readonly channelType = 'telegram';
 *   readonly capabilities: ChannelCapabilities = { ... };
 *   // ...
 * }
 * ```
 */
export interface ChannelAdapter {
  /**
   * Platform identifier string (e.g., "slack", "telegram", "discord").
   */
  readonly channelType: string;

  /**
   * Platform capability flags, used by the Reply Engine to decide the
   * best rendering method for each A2H intent.
   */
  readonly capabilities: ChannelCapabilities;

  /**
   * Start the adapter — register webhooks, connect to Socket Mode, begin polling,
   * or perform any other startup needed to receive events.
   */
  initialize(): Promise<void>;

  /**
   * Stop the adapter gracefully — disconnect from webhooks/sockets, flush pending
   * state, release resources.
   */
  shutdown(): Promise<void>;

  /**
   * Register a handler that is called whenever a new inbound message arrives from
   * a human via this channel. Only one handler is active at a time; calling
   * `onMessage()` again replaces the previous handler.
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Send a message envelope to a target in the channel.
   * Processes the `message` field sequentially (text messages, INFORM intents).
   * Blocking A2H intents (AUTHORIZE, COLLECT) should use `sendA2H()` instead.
   *
   * @param envelope  The outbound envelope carrying target info and message payload.
   * @returns         Metadata about the sent message (ID, thread ID).
   */
  send(envelope: OutboundEnvelope): Promise<SendResult>;

  /**
   * Send an A2H intent to a channel and block until the human responds.
   *
   * - INFORM: fire-and-forget, resolves immediately after sending.
   * - AUTHORIZE: renders approve/deny UI; resolves when the human clicks.
   * - COLLECT: renders selection or captures free-text; resolves with human's response.
   *
   * @param channelId  Platform-native chat/channel ID.
   * @param threadId   Platform-native thread/message ID to reply within (optional).
   * @param intent     The A2H intent message to render.
   * @param options    Timeout and other send options.
   * @returns          The human's response, including intentId and type.
   */
  sendA2H(
    channelId: string,
    threadId: string | undefined,
    intent: A2HIntentMessage,
    options?: A2HSendOptions,
  ): Promise<A2HResponse>;
}
