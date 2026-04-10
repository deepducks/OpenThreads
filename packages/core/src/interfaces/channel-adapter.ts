import type { Thread } from '../types/thread.js';
import type { Turn } from '../types/turn.js';
import type { ChatSDKMessage } from '../types/message.js';
import type { A2HMessage } from '../types/a2h.js';

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
 * Native Vercel Chat SDK adapters live in `packages/core`; custom adapters
 * (e.g., WhatsApp via Baileys) live in `packages/channels/`.
 *
 * @example
 * ```ts
 * import type { ChannelAdapter } from '@openthreads/core';
 *
 * export class SlackAdapter implements ChannelAdapter {
 *   // ...
 * }
 * ```
 */
export interface ChannelAdapter {
  /**
   * Set up the adapter — register webhooks, subscribe to events, initialise the
   * platform SDK client. Called once when a channel is registered in OpenThreads.
   */
  register(config: ChannelConfig): Promise<void>;

  /**
   * Send a rendered message to a target within the channel.
   *
   * @param target  Platform-native target identifier (channel ID, group ID, user ID, etc.)
   * @param message A single message or array of messages (Chat SDK or A2H)
   */
  sendMessage(
    target: string,
    message: ChatSDKMessage | A2HMessage | (ChatSDKMessage | A2HMessage)[],
  ): Promise<void>;

  /**
   * Adapt a Chat SDK message to the platform's native format.
   * Used by the Reply Engine when rendering conventional text/media replies.
   *
   * @param message      The Chat SDK message to render
   * @param capabilities The platform's capability flags
   * @returns            A platform-native payload (Slack blocks, Telegram object, etc.)
   */
  renderChatSDK(message: ChatSDKMessage, capabilities: ChannelCapabilities): Promise<RenderedMessage>;

  /**
   * Render an A2H intent as an inline interactive element in the channel
   * (buttons for AUTHORIZE approve/deny, select menus for COLLECT with closed options).
   * Only called when the Reply Engine selects method 1 (inline rendering).
   *
   * @param intent       The A2H message to render inline
   * @param capabilities The platform's capability flags
   * @returns            A platform-native interactive component payload
   */
  renderA2HInline(intent: A2HMessage, capabilities: ChannelCapabilities): Promise<RenderedMessage>;

  /**
   * Listen for the human's response to a specific turn in a thread.
   * Used by the Reply Engine for method 2 (text capture via thread, reply, or DM).
   *
   * Implementations should resolve the promise when the response is received,
   * following the capture hierarchy:
   *   1. Native thread reply
   *   2. Native reply-to-message
   *   3. DM implicit context (next message from sender)
   *
   * @param thread The thread to listen on
   * @param turn   The turn awaiting a response
   * @returns      The captured response message
   */
  captureResponse(thread: Thread, turn: Turn): Promise<ChatSDKMessage>;

  /**
   * Return the platform's capability flags.
   * Called by the Reply Engine to determine how to render A2H intents.
   */
  capabilities(): ChannelCapabilities;
}
