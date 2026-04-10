/**
 * Core type definitions for OpenThreads.
 *
 * These types form the shared contract between channel adapters, the router,
 * and the reply engine. All adapters must implement the ChannelAdapter interface.
 */

// ---------------------------------------------------------------------------
// Channel capabilities
// ---------------------------------------------------------------------------

/**
 * Flags describing what native primitives a channel supports.
 * Used by the Reply Engine to select the appropriate delivery method (1–4).
 */
export interface ChannelCapabilities {
  /** Native thread support (Slack, Discord forums) */
  threads: boolean;
  /** Interactive button support (Block Kit, inline keyboards, etc.) */
  buttons: boolean;
  /** Dropdown / select-menu support */
  selectMenus: boolean;
  /** Native reply-to-message support (WhatsApp, Telegram groups) */
  replyMessages: boolean;
  /** Direct-message support */
  dms: boolean;
  /** File / media upload support */
  fileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Senders and sources
// ---------------------------------------------------------------------------

export interface Sender {
  id: string;
  name: string;
  isBot?: boolean;
}

export interface MessageSource {
  /** Channel type string, e.g. "slack" | "discord" | "telegram" */
  channel: string;
  /** Platform-specific channel / room identifier */
  channelId: string;
  sender: Sender;
  /** Raw platform event — useful for debugging */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Message items
// ---------------------------------------------------------------------------

export interface FileAttachment {
  type: 'image' | 'file' | 'link';
  url?: string;
  filename?: string;
  mimeType?: string;
}

/** Plain-text (or mrkdwn/markdown) message */
export interface TextMessage {
  text: string;
  attachments?: FileAttachment[];
}

// ---------------------------------------------------------------------------
// A2H Protocol intents (Twilio A2H spec)
// ---------------------------------------------------------------------------

/**
 * AUTHORIZE — blocks until the human approves or denies the described action.
 */
export interface A2HAuthorizeIntent {
  intent: 'AUTHORIZE';
  id: string;
  context: {
    action: string;
    details?: string;
    evidence?: Record<string, unknown>;
  };
}

export interface A2HCollectOption {
  label: string;
  value: string;
}

/**
 * COLLECT — blocks until the human provides a value.
 * If `options` is present → rendered as a select menu (method 1).
 * Otherwise → free-text captured from a thread reply (method 2).
 */
export interface A2HCollectIntent {
  intent: 'COLLECT';
  id: string;
  question: string;
  /** When present the adapter renders a select menu instead of awaiting free text */
  options?: A2HCollectOption[];
  /** JSON Schema for multi-field COLLECT — escalates to external form (method 3) */
  schema?: Record<string, unknown>;
}

/**
 * INFORM — fire-and-forget notification. No response expected.
 */
export interface A2HInformIntent {
  intent: 'INFORM';
  id: string;
  text: string;
}

export type A2HIntent = A2HAuthorizeIntent | A2HCollectIntent | A2HInformIntent;
export type A2HIntentType = 'AUTHORIZE' | 'COLLECT' | 'INFORM' | 'ESCALATE' | 'RESULT';

/** Union of all valid message items in an envelope */
export type MessageItem = TextMessage | A2HIntent;

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/**
 * Inbound envelope — sent by OpenThreads to the external recipient (agent/API)
 * when a human message arrives on a registered channel.
 */
export interface InboundEnvelope {
  threadId: string;
  turnId: string;
  /** Pre-authenticated reply URL valid for 24 h by default */
  replyTo: string;
  source: MessageSource;
  message: MessageItem[];
}

/**
 * Outbound envelope — received by OpenThreads via POST /send/channel/:id/...
 * from the external recipient. The `message` field accepts a single item or array.
 */
export interface OutboundEnvelope {
  channelId: string;
  targetId: string;
  threadId?: string;
  message: MessageItem | MessageItem[];
}

// ---------------------------------------------------------------------------
// Results & responses
// ---------------------------------------------------------------------------

export interface SendResult {
  messageId: string;
  threadId?: string;
  raw?: unknown;
}

/** Response returned after a blocking A2H interaction completes */
export interface A2HResponse {
  intentId: string;
  type: A2HIntentType;
  /** AUTHORIZE: true = approved, false = denied */
  approved?: boolean;
  /** COLLECT: the collected value(s) */
  response?: string | string[];
  metadata?: Record<string, unknown>;
}

export interface A2HSendOptions {
  /** Milliseconds before the pending interaction times out. Default: 24 h */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Channel adapter interface
// ---------------------------------------------------------------------------

export type MessageHandler = (envelope: InboundEnvelope) => Promise<void>;

/**
 * Every channel adapter must implement this interface.
 *
 * Lifecycle:
 *   1. Caller registers a message handler via `onMessage()`
 *   2. Caller calls `initialize()` to start the adapter
 *   3. Adapter dispatches inbound messages to the registered handler
 *   4. Caller uses `send()` / `sendA2H()` to push outbound messages
 *   5. Caller calls `shutdown()` to gracefully stop the adapter
 */
export interface ChannelAdapter {
  readonly channelType: string;
  readonly capabilities: ChannelCapabilities;

  /** Start listening for inbound events (bind port, open socket, etc.) */
  initialize(): Promise<void>;

  /** Gracefully stop the adapter */
  shutdown(): Promise<void>;

  /** Register the inbound message handler */
  onMessage(handler: MessageHandler): void;

  /**
   * Send one or more message items to a channel/thread.
   * Blocking A2H intents (AUTHORIZE, COLLECT) should be sent via `sendA2H()`.
   */
  send(envelope: OutboundEnvelope): Promise<SendResult>;

  /**
   * Render an A2H intent in the channel and await the human's response.
   * Returns only after the human responds (or the timeout fires).
   */
  sendA2H(
    channelId: string,
    threadId: string | undefined,
    intent: A2HIntent,
    options?: A2HSendOptions,
  ): Promise<A2HResponse>;
}
