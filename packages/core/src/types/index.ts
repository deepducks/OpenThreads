/**
 * Core types and interfaces for OpenThreads.
 *
 * The message envelope accepts both Vercel Chat SDK messages and A2H protocol
 * intents, identified by duck typing: presence of `intent` field = A2H.
 */

// ---------------------------------------------------------------------------
// Chat SDK Types (Vercel Chat SDK format)
// ---------------------------------------------------------------------------

export interface Attachment {
  url?: string;
  contentType?: string;
  name?: string;
}

export interface ChatSDKMessage {
  text?: string;
  markdown?: string;
  attachments?: Attachment[];
  blocks?: unknown[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// A2H Protocol Types
// ---------------------------------------------------------------------------

/** The five atomic A2H intents from Layer 1 of the A2H spec. */
export type A2HIntent = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT';

/** A field within a COLLECT intent. */
export interface CollectField {
  name: string;
  /** Closed option types can be rendered as buttons/selects in the channel. */
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'number';
  label?: string;
  /** Options for select/multiselect/checkbox types — makes this a "closed option" field. */
  options?: string[];
  required?: boolean;
}

/** A2H message following the A2H protocol spec (presence of `intent` = A2H). */
export interface A2HMessage {
  intent: A2HIntent;
  context?: {
    action?: string;
    details?: string;
    justification?: string;
    evidence?: unknown;
    [key: string]: unknown;
  };
  /** COLLECT-specific: defines the fields to collect and/or a question prompt. */
  collect?: {
    question?: string;
    fields?: CollectField[];
  };
  /** Trace ID for auditing and idempotency. */
  traceId?: string;
  nonce?: string;
}

/** Discriminated union of all valid message item types in the envelope. */
export type MessageItem = ChatSDKMessage | A2HMessage;

// ---------------------------------------------------------------------------
// Channel Capabilities
// ---------------------------------------------------------------------------

/**
 * Describes what the destination channel can render natively.
 * The Reply Engine uses this to select the best reply method.
 */
export interface ChannelCapabilities {
  /** Channel supports interactive button components (Slack, Discord, Telegram). */
  supportsButtons: boolean;
  /** Channel supports select/dropdown menus (Slack block kit selects, etc.). */
  supportsSelectMenus: boolean;
  /** Channel supports native message threads (Slack threads, Discord forum channels). */
  supportsNativeThreads: boolean;
  /** Channel supports replying to a specific message (Telegram reply, WhatsApp quote). */
  supportsNativeReplies: boolean;
  /** The current context is a Direct Message (implies implicit capture for method 2). */
  isDM: boolean;
}

// ---------------------------------------------------------------------------
// Reply Method
// ---------------------------------------------------------------------------

/**
 * The four reply methods the Reply Engine can use for A2H intents.
 *
 * 1 — Inline in channel (buttons/actions)
 * 2 — Text capture (thread, reply, or DM)
 * 3 — External form (temporary link)
 * 4 — Batch form (multiple intents on a single page)
 */
export type ReplyMethod = 1 | 2 | 3 | 4;

/** How method 2 captures the response from the human. */
export type CaptureMethod = 'thread' | 'reply' | 'dm' | 'none';

// ---------------------------------------------------------------------------
// A2H Response
// ---------------------------------------------------------------------------

/** The response collected from the human for a single A2H intent. */
export interface A2HResponse {
  intent: A2HIntent;
  /** The human's response payload (approval boolean, text string, selected option, etc.). */
  response: unknown;
  respondedAt?: Date;
}

// ---------------------------------------------------------------------------
// Channel Adapter Interface
// ---------------------------------------------------------------------------

/**
 * The channel adapter interface that the Reply Engine delegates to.
 *
 * Concrete implementations live in packages/channels/ or are provided by the
 * Vercel Chat SDK adapters in packages/core.
 */
export interface ChannelAdapter {
  /** Capabilities of the underlying channel. */
  readonly capabilities: ChannelCapabilities;

  /**
   * Render a Chat SDK message to the channel (fire-and-forget).
   * Used for text, markdown, blocks, etc.
   */
  renderChatSDK(message: ChatSDKMessage): Promise<void>;

  /**
   * Render an A2H intent inline using native channel primitives (method 1).
   * Returns the human's response once they interact with the buttons/select.
   */
  renderA2HInline(message: A2HMessage): Promise<A2HResponse>;

  /**
   * Capture a free-text response via the channel's native affordances (method 2).
   * The capture method depends on channel capabilities:
   *   'thread'  — capture any sender message in the native thread
   *   'reply'   — capture a direct reply to the COLLECT message
   *   'dm'      — capture next message in the DM (implicit context)
   *   'none'    — channel doesn't support capture (should not be passed here)
   */
  captureResponse(message: A2HMessage, captureMethod: Exclude<CaptureMethod, 'none'>): Promise<A2HResponse>;

  /**
   * Send a form link to the channel (methods 3 and 4).
   * The link points to the auto-generated A2H form page.
   */
  sendFormLink(formUrl: string, context: A2HMessage | A2HMessage[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Escalation Handler
// ---------------------------------------------------------------------------

/**
 * Optional hook for handling ESCALATE intents.
 * When provided, the Reply Engine calls this instead of falling back to method 3.
 */
export interface EscalationHandler {
  handle(message: A2HMessage): Promise<A2HResponse>;
}

// ---------------------------------------------------------------------------
// Reply Engine Config & Result
// ---------------------------------------------------------------------------

export interface ReplyEngineConfig {
  /**
   * Timeout in milliseconds for blocking A2H intents (COLLECT, AUTHORIZE, ESCALATE).
   * @default 300000 (5 minutes)
   */
  timeoutMs?: number;

  /**
   * When true, all A2H intents are routed to method 3 (external form) because
   * strong authentication (WebAuthn/passkeys) is only supported there.
   * @default false
   */
  trustLayerActive?: boolean;

  /**
   * Base URL for auto-generated A2H form pages.
   * Form URLs are constructed as `${formBaseUrl}/${turnId}`.
   * @default "https://openthreads.host/form"
   */
  formBaseUrl?: string;

  /**
   * Optional handler for ESCALATE intents.
   * Falls back to method 3 (external form) when not provided.
   */
  escalationHandler?: EscalationHandler;
}

/** The result returned by the Reply Engine after processing an envelope. */
export interface ReplyEngineResult {
  /**
   * Responses collected for each item in the message array, in the same order.
   * null for Chat SDK messages and INFORM intents (non-blocking / fire-and-forget).
   */
  responses: (A2HResponse | null)[];
}

/** The inbound envelope POSTed to the recipient inbound endpoint. */
export interface ReplyEnvelope {
  /**
   * A single message object or an array. When a single object, it is normalized
   * to a 1-item array. Each item is either a Chat SDK message or an A2H intent.
   */
  message: MessageItem | MessageItem[];
}
