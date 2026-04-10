/**
 * Core OpenThreads types and interfaces.
 *
 * Channel adapters implement the ChannelAdapter interface to integrate
 * a messaging platform with the OpenThreads router and reply engine.
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Declares what a channel natively supports.
 * Used by the reply engine to decide the render method for A2H intents.
 */
export interface ChannelCapabilities {
  /** Whether the channel supports native thread replies (e.g. Slack threads) */
  readonly threads: boolean;
  /** Whether the channel supports button interactions (inline keyboards) */
  readonly buttons: boolean;
  /** Whether the channel supports drop-down / select-menu interactions */
  readonly selectMenus: boolean;
  /** Whether the channel supports replying to a specific message */
  readonly replyMessages: boolean;
  /** Whether the channel supports direct messages to individual users */
  readonly dms: boolean;
  /** Whether the channel supports file / media uploads */
  readonly fileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Inbound (channel → OpenThreads)
// ---------------------------------------------------------------------------

export interface MessageSender {
  id: string;
  name: string;
  username?: string;
}

export interface MessageAttachment {
  type: "image" | "video" | "audio" | "document" | "sticker" | "voice";
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  url?: string;
}

/**
 * Normalised representation of any inbound event from a channel.
 * Commands (/start, /help) are surfaced as messages with a leading slash.
 */
export interface InboundMessage {
  /** Opaque ID assigned by OpenThreads for this message */
  id: string;
  /** Opaque ID of the thread this message belongs to */
  threadId: string;
  /**
   * Platform-native message ID that was replied to, when present.
   * Used to resolve virtual threads on reply-chain channels.
   */
  replyToMessageId?: string;
  /** Channel this message arrived on */
  channel: string;
  /** Platform-native chat/channel/group identifier */
  chatId: string;
  sender: MessageSender;
  text?: string;
  attachments?: MessageAttachment[];
  /** Platform-native raw payload — do not rely on this in core logic */
  raw: unknown;
  receivedAt: Date;
}

/**
 * A callback query (button press / menu selection) from the channel.
 * Produced when a human interacts with an inline keyboard or similar control.
 */
export interface CallbackQuery {
  /** Opaque query ID assigned by the platform */
  id: string;
  /** The data string embedded in the button that was pressed */
  data: string;
  sender: MessageSender;
  /** ID of the message that contained the button */
  originMessageId: string;
  /** Platform-native chat/channel/group identifier */
  chatId: string;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Outbound (OpenThreads → channel)
// ---------------------------------------------------------------------------

export interface InlineKeyboardButton {
  text: string;
  /**
   * Opaque callback data returned verbatim when the button is pressed.
   * Maximum 64 bytes on Telegram.
   */
  callbackData: string;
  url?: string;
}

export interface ReplyKeyboardButton {
  text: string;
  requestContact?: boolean;
  requestLocation?: boolean;
}

export interface OutboundMessage {
  text?: string;
  /** When set, overrides `text` with HTML-formatted content */
  html?: string;
  /** When set, overrides `text` with MarkdownV2-formatted content */
  markdown?: string;
  /** Inline keyboard rows rendered below the message */
  inlineKeyboard?: InlineKeyboardButton[][];
  /** Reply keyboard shown as a custom keyboard to the user */
  replyKeyboard?: ReplyKeyboardButton[][];
  /** Remove any existing custom keyboard */
  removeKeyboard?: boolean;
  /** Platform-native message ID to reply to */
  replyToMessageId?: string;
  /** Suppress link previews */
  disableWebPagePreview?: boolean;
}

export interface SentMessage {
  /** Platform-native message ID */
  messageId: string;
  /** Timestamp assigned by the platform */
  sentAt: Date;
}

export interface SendTarget {
  /** Platform-native chat / channel / group identifier */
  chatId: string;
  /** When present, reply within this thread context */
  threadId?: string;
}

// ---------------------------------------------------------------------------
// A2H intent types
// ---------------------------------------------------------------------------

export type A2HIntentType = "INFORM" | "COLLECT" | "AUTHORIZE" | "ESCALATE" | "RESULT";

export interface A2HIntentBase {
  intent: A2HIntentType;
  /** Correlation ID used to match the response back to the pending request */
  turnId: string;
  context?: Record<string, unknown>;
  justification?: string;
}

export interface AuthorizeIntent extends A2HIntentBase {
  intent: "AUTHORIZE";
  context: {
    action: string;
    details?: string;
    evidence?: Record<string, unknown>;
  };
}

export interface CollectIntent extends A2HIntentBase {
  intent: "COLLECT";
  context: {
    question: string;
    /** When present, restricts the answer to one of these options */
    options?: string[];
    /** JSON Schema for structured multi-field collection */
    schema?: Record<string, unknown>;
  };
}

export interface InformIntent extends A2HIntentBase {
  intent: "INFORM";
  context: {
    message: string;
  };
}

export type A2HIntent = AuthorizeIntent | CollectIntent | InformIntent | A2HIntentBase;

export interface A2HResponse {
  turnId: string;
  intent: A2HIntentType;
  response: unknown;
  respondedAt: Date;
}

/**
 * Result returned by renderA2HIntent, carrying enough information
 * for the adapter to correlate a subsequent callback_query or reply
 * back to the correct turnId.
 */
export interface A2HRenderResult {
  /** Platform-native message ID of the rendered intent message */
  messageId: string;
  /** How the intent was rendered */
  method: "inline" | "reply-capture" | "external-form";
}

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

export interface AdapterConfig {
  /** Human-readable identifier for this channel registration */
  channelId: string;
  /** Platform-specific credentials and settings */
  credentials: Record<string, string>;
  /** Public webhook URL that the platform should POST updates to */
  webhookUrl?: string;
  /** Extra platform-specific options */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelAdapter interface
// ---------------------------------------------------------------------------

/**
 * The interface every channel adapter must implement.
 *
 * Adapters are responsible for:
 *  - Translating platform-native updates into normalised InboundMessage / CallbackQuery objects.
 *  - Sending OutboundMessages back to the correct chat.
 *  - Rendering A2H intents in the most appropriate way for the channel.
 *  - Managing virtual threads on platforms that lack native thread support.
 */
export interface ChannelAdapter {
  readonly capabilities: ChannelCapabilities;

  /**
   * Initialise the adapter (register webhooks, open connections, etc.).
   * Must be idempotent — safe to call multiple times.
   */
  setup(config: AdapterConfig): Promise<void>;

  /**
   * Gracefully shut down the adapter (deregister webhooks, close connections).
   */
  teardown(): Promise<void>;

  /**
   * Parse a raw platform webhook payload into a normalised InboundMessage.
   * Returns null when the payload is a non-message event (e.g. a bot status update).
   */
  parseInbound(payload: unknown): Promise<InboundMessage | null>;

  /**
   * Parse a raw platform webhook payload into a CallbackQuery, when applicable.
   * Returns null when the payload does not contain a callback query.
   */
  parseCallbackQuery(payload: unknown): Promise<CallbackQuery | null>;

  /**
   * Send a message to a chat.
   */
  send(target: SendTarget, message: OutboundMessage): Promise<SentMessage>;

  /**
   * Acknowledge a callback query (clears the loading indicator on the button).
   * May be a no-op on platforms that do not require this.
   */
  answerCallbackQuery(queryId: string, text?: string): Promise<void>;

  /**
   * Render an A2H intent as an interactive message in the channel.
   * The adapter chooses the most appropriate render method based on its capabilities.
   */
  renderA2HIntent(
    chatId: string,
    intent: A2HIntent,
    replyToMessageId?: string,
  ): Promise<A2HRenderResult>;

  /**
   * Given a raw platform payload, determine whether it is the human's response
   * to a pending A2H intent message. Returns the response or null.
   */
  captureA2HResponse(payload: unknown, pendingTurnId: string, pendingMessageId: string): Promise<A2HResponse | null>;
}
