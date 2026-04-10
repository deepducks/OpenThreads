/**
 * Core type definitions for OpenThreads.
 * Covers the A2H Protocol intents, Chat SDK messages, channel capabilities,
 * reply context, and engine configuration.
 */

// ---------------------------------------------------------------------------
// A2H Protocol types
// ---------------------------------------------------------------------------

/** The five atomic A2H intent types (Layer 1). */
export type A2HIntentType = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT';

/** Reply methods selected by the Reply Engine. */
export type ReplyMethod = 1 | 2 | 3 | 4;

/** A single field definition for a COLLECT intent. */
export interface CollectField {
  id: string;
  label: string;
  /** 'select' and 'multiselect' and 'checkbox' are closed-option types. */
  type: 'text' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'number';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

/** An A2H message item — identified by the presence of the `intent` field. */
export interface A2HMessage {
  intent: A2HIntentType;
  /** Unique identifier for this intent (for idempotency and audit). */
  id?: string;
  /** Context and evidence for the intent. */
  context?: {
    action?: string;
    details?: string;
    evidence?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Field schema for COLLECT intents. */
  fields?: CollectField[];
  traceId?: string;
  nonce?: string;
}

// ---------------------------------------------------------------------------
// Chat SDK types
// ---------------------------------------------------------------------------

/** An attachment inside a Chat SDK message. */
export interface Attachment {
  url?: string;
  filename?: string;
  contentType?: string;
  [key: string]: unknown;
}

/** A block element inside a Chat SDK message (Slack blocks, Discord embeds, etc.). */
export interface Block {
  type: string;
  [key: string]: unknown;
}

/**
 * A Chat SDK message item — any object without an `intent` field.
 * Follows the Vercel Chat SDK schema.
 */
export interface ChatSDKMessage {
  text?: string;
  markdown?: string;
  attachments?: Attachment[];
  blocks?: Block[];
  [key: string]: unknown;
}

/** Union of all message item types (classified by duck typing at runtime). */
export type MessageItem = ChatSDKMessage | A2HMessage;

/** The raw `message` field from a recipient inbound request. */
export type MessageInput = MessageItem | MessageItem[];

// ---------------------------------------------------------------------------
// Channel capabilities
// ---------------------------------------------------------------------------

/** Describes what a channel adapter can render natively. */
export interface ChannelCapabilities {
  /** Channel supports button interactions (Slack actions, Telegram inline keyboard, etc.). */
  supportsButtons: boolean;
  /** Channel supports select/dropdown menus. */
  supportsSelectMenus: boolean;
  /** Channel has native thread support (Slack threads, Discord forum posts). */
  supportsNativeThreads: boolean;
  /** Channel supports reply-to-message affordance (WhatsApp, Telegram in groups). */
  supportsReplyMessages: boolean;
  /** The current conversation is a direct message (implicit capture context). */
  isDM: boolean;
}

// ---------------------------------------------------------------------------
// Reply context
// ---------------------------------------------------------------------------

/** Routing and source information for a recipient inbound request. */
export interface ReplyContext {
  channelId: string;
  threadId: string;
  turnId: string;
  targetId: string;
  source: {
    channel: string;
    channelId: string;
    sender: {
      id: string;
      name: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** The human's response to a blocking A2H intent. */
export interface A2HResponse {
  /** Echo of the original intent id, if provided. */
  intentId?: string;
  intent: A2HIntentType;
  /** The actual response payload (approve/deny object, collected field values, etc.). */
  response: unknown;
  respondedAt: Date;
  /** Cryptographic evidence (JWS) — populated by the trust layer when active. */
  evidence?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Engine configuration and results
// ---------------------------------------------------------------------------

/** Configuration options for the Reply Engine. */
export interface ReplyEngineOptions {
  /**
   * When true, always uses method 3 (external form) for all A2H intents.
   * Required for WebAuthn/OTP authentication and JWS evidence collection.
   */
  trustLayerActive?: boolean;
  /** Milliseconds to wait for a blocking intent response before timing out. Default: 30000. */
  responseTimeoutMs?: number;
  /** Base URL for auto-generated A2H forms. Default: 'https://openthreads.host/form'. */
  formBaseUrl?: string;
}

/** Result returned by the Reply Engine after processing a message. */
export interface ReplyEngineResult {
  /** True if all items were processed without errors. */
  success: boolean;
  /**
   * Responses in the same order as the input items.
   * null for Chat SDK messages and non-blocking intents (INFORM, ESCALATE).
   * null for method 3/4 items whose responses arrive asynchronously via form submit.
   */
  responses: Array<A2HResponse | null>;
  /** Error messages for any items that failed processing. */
  errors?: string[];
}
