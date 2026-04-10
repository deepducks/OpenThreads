/**
 * Core types for the OpenThreads channel adapter interface.
 *
 * Based on the data model from VISION.md and the A2H protocol.
 */

// ---------------------------------------------------------------------------
// Message types (Vercel Chat SDK compatible)
// ---------------------------------------------------------------------------

export interface TextMessage {
  text: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  type: string;
  url?: string;
  name?: string;
  mimeType?: string;
}

// ---------------------------------------------------------------------------
// A2H intent types (https://github.com/twilio-labs/a2h-spec)
// ---------------------------------------------------------------------------

export interface A2HAuthorize {
  intent: "AUTHORIZE";
  requestId: string;
  context: {
    action: string;
    details?: string;
    evidence?: Record<string, unknown>;
  };
}

export interface A2HCollect {
  intent: "COLLECT";
  requestId: string;
  question: string;
  /**
   * When present, render as a select menu (method 1).
   * When absent, capture free text (method 2 — thread reply).
   */
  options?: string[];
  /**
   * JSON Schema describing the data to collect.
   * When this has multiple fields, use method 3 (external form).
   */
  schema?: Record<string, unknown>;
}

export interface A2HInform {
  intent: "INFORM";
  requestId: string;
  message: string;
}

export interface A2HEscalate {
  intent: "ESCALATE";
  requestId: string;
  context: {
    reason: string;
    details?: string;
  };
}

export interface A2HResult {
  intent: "RESULT";
  requestId: string;
  result: unknown;
}

export type A2HItem =
  | A2HAuthorize
  | A2HCollect
  | A2HInform
  | A2HEscalate
  | A2HResult;

/** Duck-typed union — if it has `intent` it's A2H, otherwise Chat SDK message */
export type MessageItem = TextMessage | A2HItem;

// ---------------------------------------------------------------------------
// Responses from humans
// ---------------------------------------------------------------------------

export interface AuthorizeResponse {
  requestId: string;
  approved: boolean;
  respondedBy: string;
  respondedAt: string;
}

export interface CollectResponse {
  requestId: string;
  value: string | string[];
  respondedBy: string;
  respondedAt: string;
}

export type A2HResponse = AuthorizeResponse | CollectResponse;

// ---------------------------------------------------------------------------
// Envelope (OpenThreads wire format)
// ---------------------------------------------------------------------------

export interface Sender {
  id: string;
  name: string;
}

export interface MessageSource {
  channel: string;
  channelId: string;
  sender: Sender;
}

/** Outbound envelope sent by OpenThreads to the recipient system */
export interface Envelope {
  threadId: string;
  turnId: string;
  replyTo: string;
  source: MessageSource;
  message: MessageItem[];
}

// ---------------------------------------------------------------------------
// Inbound message (normalized from any channel)
// ---------------------------------------------------------------------------

export interface InboundMessage {
  /** OpenThreads thread ID — may be null for unthreaded messages */
  threadId: string | null;
  /** Platform-native thread identifier (e.g. Slack thread_ts) */
  nativeThreadId: string | null;
  sender: Sender;
  /** Parsed text content */
  content: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Original platform payload, unmodified */
  raw: unknown;
  /** Channel identifier where the message was received */
  channelId: string;
  /** True if this is a DM */
  isDM: boolean;
}

// ---------------------------------------------------------------------------
// Channel capabilities
// ---------------------------------------------------------------------------

export interface ChannelCapabilities {
  /** Supports native platform threads (Slack thread_ts, Discord thread) */
  threads: boolean;
  /** Supports interactive buttons / inline keyboard */
  buttons: boolean;
  /** Supports select menus / dropdown pickers */
  selectMenus: boolean;
  /** Supports reply-to-message (quoting) */
  replyMessages: boolean;
  /** Supports direct messages */
  dms: boolean;
  /** Supports file/attachment uploads */
  fileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

export interface AdapterConfig {
  /** Arbitrary name for logging */
  name?: string;
}

// ---------------------------------------------------------------------------
// ChannelAdapter interface
// ---------------------------------------------------------------------------

export type MessageHandler = (message: InboundMessage) => Promise<void>;
export type InteractionHandler = (response: A2HResponse) => Promise<void>;

export interface ChannelAdapter {
  /** Report what this channel natively supports */
  getCapabilities(): ChannelCapabilities;

  /**
   * Register a handler for inbound messages.
   * Must be called before `start()`.
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a handler for A2H interaction responses (button clicks, etc.).
   * Must be called before `start()`.
   */
  onInteraction(handler: InteractionHandler): void;

  /** Start receiving inbound messages (connect to platform). */
  start(): Promise<void>;

  /** Gracefully disconnect and stop receiving messages. */
  stop(): Promise<void>;

  /**
   * Send one or more message items to a channel/thread.
   *
   * @param channelId   Platform channel or conversation ID
   * @param threadId    Native thread ID to reply into, or null for a new message
   * @param messages    Array of Chat SDK messages and/or A2H intents
   */
  send(
    channelId: string,
    threadId: string | null,
    messages: MessageItem[]
  ): Promise<void>;
}
