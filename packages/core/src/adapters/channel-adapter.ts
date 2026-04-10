import type {
  ChannelCapabilities,
  ChatSDKMessage,
  A2HMessage,
  A2HResponse,
  ReplyContext,
} from '../types/index.js';

/**
 * ChannelAdapter — the interface every channel plugin must implement.
 *
 * The Reply Engine delegates all channel-specific rendering to this interface,
 * keeping the engine logic channel-agnostic.
 */
export interface ChannelAdapter {
  /** Return the static capability profile for this channel/context. */
  getCapabilities(): ChannelCapabilities;

  /**
   * Render a Chat SDK message in the channel (text, markdown, blocks, etc.).
   * Fire-and-forget — no response expected.
   */
  renderChatSDK(message: ChatSDKMessage, context: ReplyContext): Promise<void>;

  /**
   * Render an A2H intent inline using native channel primitives (method 1).
   * Examples: Slack buttons, Telegram inline keyboard, Discord components.
   * Blocks until the human responds and returns the response.
   */
  renderA2HInline(message: A2HMessage, context: ReplyContext): Promise<A2HResponse>;

  /**
   * Capture a free-text response using channel-native affordances (method 2).
   * @param captureMode - 'thread' captures the next message in the thread;
   *                      'reply' captures a direct reply to the prompt message;
   *                      'dm' captures the next message in the DM.
   * Blocks until the human responds and returns the response.
   */
  captureResponse(
    message: A2HMessage,
    captureMode: 'thread' | 'reply' | 'dm',
    context: ReplyContext,
    timeoutMs?: number,
  ): Promise<A2HResponse>;

  /**
   * Send a link to a temporary external form in the channel (methods 3 & 4).
   * The form submission is processed separately and is NOT awaited here —
   * the response arrives asynchronously via the form's submit handler.
   */
  sendFormLink(formUrl: string, message: A2HMessage, context: ReplyContext): Promise<void>;

  /**
   * Handle an ESCALATE intent by notifying the appropriate human operator.
   * Fire-and-forget — no response expected from this method.
   */
  handleEscalation(message: A2HMessage, context: ReplyContext): Promise<void>;
}
