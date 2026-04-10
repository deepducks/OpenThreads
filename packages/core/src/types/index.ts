/**
 * OpenThreads Core — Type Definitions
 *
 * Covers the A2H Protocol (Twilio), Vercel Chat SDK message shapes,
 * channel adapter interface, and reply-engine contracts.
 */

// ---------------------------------------------------------------------------
// Primitives / identifiers
// ---------------------------------------------------------------------------

export type ThreadId = string;
export type TurnId = string;
export type ChannelId = string;
export type RecipientId = string;

// ---------------------------------------------------------------------------
// A2H Protocol types
// ---------------------------------------------------------------------------

/** The five atomic A2H intents (Layer 1). */
export type A2HIntentType =
  | 'INFORM'
  | 'COLLECT'
  | 'AUTHORIZE'
  | 'ESCALATE'
  | 'RESULT';

/** A single field definition inside a COLLECT schema. */
export interface CollectField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'boolean' | 'select' | 'multiselect';
  required?: boolean;
  /** Allowed values — present on `select` and `multiselect` fields. */
  options?: string[];
}

/**
 * An A2H message item.
 * Identified at runtime by the presence of the `intent` field (duck typing).
 */
export interface A2HMessage {
  intent: A2HIntentType;
  /** Free-form context forwarded to the human (action, details, evidence, etc.). */
  context?: Record<string, unknown>;
  /**
   * For COLLECT: schema of fields to gather.
   * When absent, a single free-text field is assumed.
   */
  schema?: {
    fields: CollectField[];
  };
  /**
   * Closed options for AUTHORIZE (approve/deny alternatives)
   * or COLLECT (enumerated choices without a full schema).
   */
  options?: string[];
  /** JWS evidence blob for the trust layer. */
  evidence?: unknown;
  /** Caller-supplied trace ID for end-to-end audit correlation. */
  traceId?: string;
  /** Idempotency key — prevents duplicate processing of the same intent. */
  idempotencyKey?: string;
}

/** Response returned to the recipient after a blocking A2H intent. */
export interface A2HResponse {
  intent: A2HIntentType;
  /** The human's answer — shape depends on intent/field types. */
  response: unknown;
  respondedAt: Date;
  /** Channel identity of the responder, if available. */
  respondedBy?: string;
  /** JWS evidence, populated only when the trust layer is active. */
  evidence?: unknown;
}

// ---------------------------------------------------------------------------
// Vercel Chat SDK message types
// ---------------------------------------------------------------------------

/**
 * A Chat SDK message item.
 * Identified at runtime by the *absence* of an `intent` field.
 */
export interface ChatSDKMessage {
  text?: string;
  markdown?: string;
  attachments?: unknown[];
  blocks?: unknown[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Union types used in the envelope
// ---------------------------------------------------------------------------

export type MessageItem = A2HMessage | ChatSDKMessage;

/**
 * The `message` field accepted by the Recipient Inbound endpoint.
 * A single object is normalised to a 1-item array by the Reply Engine.
 */
export type MessageField = MessageItem | MessageItem[];

// ---------------------------------------------------------------------------
// Channel capabilities & context
// ---------------------------------------------------------------------------

/** What the target channel is capable of rendering. */
export interface ChannelCapabilities {
  /** Supports interactive buttons (Slack block-kit buttons, Telegram inline keyboard…). */
  supportsButtons: boolean;
  /** Supports select / dropdown menus. */
  supportsSelectMenus: boolean;
  /** Has native threaded conversations (Slack threads, Discord forum channels…). */
  hasNativeThreads: boolean;
  /** Supports replying to a specific message (Telegram groups, WhatsApp, Discord). */
  hasReplyMessages: boolean;
}

/**
 * Runtime context for a reply operation — describes where and how
 * the response will be delivered.
 */
export interface ReplyContext {
  channelId: ChannelId;
  /** True when the reply target is a DM / private chat. */
  isDM: boolean;
  threadId?: ThreadId;
  turnId?: TurnId;
  capabilities: ChannelCapabilities;
  /**
   * When true, the optional trust layer is active.
   * All A2H intents are automatically escalated to method 3 (external form)
   * so that strong authentication (WebAuthn / OTP) can be collected.
   */
  trustLayerActive?: boolean;
  /** Base URL used to generate temporary form URLs for method 3/4. */
  formBaseUrl?: string;
  /**
   * How long (ms) to wait for a human response before timing out.
   * Defaults to 24 h (86 400 000 ms).
   */
  responseTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Capture mode (method 2 — text capture)
// ---------------------------------------------------------------------------

export type CaptureMode = 'thread' | 'reply' | 'dm';

// ---------------------------------------------------------------------------
// Channel adapter interface
// ---------------------------------------------------------------------------

/**
 * Implemented by each channel adapter (Slack, Discord, Telegram, …).
 * The Reply Engine uses this interface exclusively — it is never
 * aware of which underlying platform it is talking to.
 */
export interface ChannelAdapter {
  /** Send a conventional Chat-SDK message (text, blocks, attachments…). */
  renderChatSDK(message: ChatSDKMessage, context: ReplyContext): Promise<void>;

  /**
   * Method 1 — render an A2H intent inline using native channel primitives
   * (buttons, select menus, inline keyboards) and block until the human responds.
   */
  renderA2HInline(message: A2HMessage, context: ReplyContext): Promise<A2HResponse>;

  /**
   * Method 2 — post the question in the channel and capture the textual reply
   * using the given capture mode. Returns `null` if no response is received
   * within the timeout (caller should fall back to method 3).
   */
  captureResponse(
    message: A2HMessage,
    mode: CaptureMode,
    context: ReplyContext,
  ): Promise<A2HResponse | null>;

  /** Send a plain text or markdown message (used for INFORM intents). */
  sendMessage(text: string, context: ReplyContext): Promise<void>;

  /**
   * Method 3/4 — post the external-form link in the channel so the human
   * knows where to respond.
   */
  sendFormLink(
    formUrl: string,
    intents: A2HMessage[],
    context: ReplyContext,
  ): Promise<void>;

  /**
   * ESCALATE intent handler — hand off to a human operator via whatever
   * mechanism the channel supports.
   */
  handleEscalation(message: A2HMessage, context: ReplyContext): Promise<void>;

  /** Return the static capability set for this channel / conversation. */
  getCapabilities(): ChannelCapabilities;
}

// ---------------------------------------------------------------------------
// Form store interface (method 3 / 4 — external form)
// ---------------------------------------------------------------------------

/**
 * Persists ephemeral forms and waits for their submission.
 * The default implementation lives in `packages/server`; a simple
 * in-memory mock is provided in the test helpers.
 */
export interface FormStore {
  /**
   * Create a temporary form page for the given intents.
   * Returns the public URL that the human should visit.
   */
  createForm(turnId: TurnId, intents: A2HMessage[]): Promise<string>;

  /**
   * Block until the form is submitted or the timeout elapses.
   * Resolves with a flat map of field names → values.
   * Rejects with `TimeoutError` if the timeout expires before submission.
   */
  waitForSubmit(
    formUrl: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Reply-engine public API types
// ---------------------------------------------------------------------------

/** The A2H reply method selected for a particular intent. */
export type A2HMethod = 1 | 2 | 3 | 4;

/** Internal result of the method-selection step. */
export type MethodSelection =
  | { method: A2HMethod }
  | { method: 'inform-fire-forget' }
  | { method: 'escalate' };

/**
 * What the Reply Engine returns to the Recipient Inbound handler.
 * `responses` is parallel to the original `message` array:
 *   - null → Chat SDK item (no blocking response expected)
 *   - null → INFORM / ESCALATE (fire-and-forget or handed off)
 *   - A2HResponse → blocking intent that received a human answer
 */
export interface ReplyResult {
  responses: Array<A2HResponse | null>;
  chatSDKCount: number;
  a2hCount: number;
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/** Payload sent from OpenThreads to an external recipient (outbound). */
export interface RecipientOutboundEnvelope {
  threadId: ThreadId;
  turnId: TurnId;
  replyTo: string;
  source: {
    channel: string;
    channelId: ChannelId;
    sender: { id: string; name?: string };
  };
  message: MessageItem[];
}

/** Payload received from an external recipient (inbound reply). */
export interface RecipientInboundEnvelope {
  message: MessageField;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when a blocking intent times out waiting for a human response. */
export class TimeoutError extends Error {
  constructor(
    public readonly turnId: TurnId | undefined,
    public readonly intentType: A2HIntentType,
    public readonly timeoutMs: number,
  ) {
    super(
      `Timed out after ${timeoutMs}ms waiting for response to ${intentType} intent` +
        (turnId ? ` (turnId: ${turnId})` : ''),
    );
    this.name = 'TimeoutError';
  }
}
