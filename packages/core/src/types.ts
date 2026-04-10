/**
 * A2H Protocol intent types (Twilio A2H spec).
 * AUTHORIZE — request approval with evidence
 * COLLECT — collect structured data from human
 * INFORM — fire-and-forget notification
 * ESCALATE — hand off to human operator
 * RESULT — return task result to agent
 */
export type A2HIntent = "AUTHORIZE" | "COLLECT" | "INFORM" | "ESCALATE" | "RESULT";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface ChannelCapabilities {
  /** Channel supports native threaded conversations */
  threads: boolean;
  /** Channel supports interactive buttons */
  buttons: boolean;
  /** Channel supports select/dropdown menus */
  selectMenus: boolean;
  /** Channel supports replying to specific messages */
  replyMessages: boolean;
  /** Channel supports direct messages */
  dms: boolean;
  /** Channel supports file uploads */
  fileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Message content types
// ---------------------------------------------------------------------------

/** Conventional chat message (Vercel Chat SDK style) */
export interface MessageContent {
  text?: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

/** A2H protocol intent item */
export interface A2HContent {
  intent: A2HIntent;
  context: A2HContext;
}

export interface A2HContext {
  /** Short label for the action being authorized or data being collected */
  action?: string;
  /** Human-readable details / question text */
  details?: string;
  /** Question to present for COLLECT intents */
  question?: string;
  /** Closed options for COLLECT intents — renders as select menu when supported */
  options?: Array<{ label: string; value: string }>;
  [key: string]: unknown;
}

export type MessageItem = MessageContent | A2HContent;

/** Type guard — determines whether a MessageItem is an A2H intent */
export function isA2HContent(item: MessageItem): item is A2HContent {
  return typeof item === "object" && item !== null && "intent" in item;
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface MessageSource {
  /** Adapter type identifier (e.g. "slack", "discord") */
  channel: string;
  /** Native channel/room ID (e.g. Slack channel ID "C0123") */
  channelId: string;
  sender: { id: string; name: string };
}

/**
 * Inbound envelope — created by the adapter for every inbound message.
 * Forwarded to the recipient system via the outbound webhook.
 */
export interface InboundEnvelope {
  /** OpenThreads thread identifier — maps 1:1 to native threads where available */
  threadId: string;
  /** Turn identifier for this specific interaction */
  turnId: string;
  /** Reply endpoint URL (filled in by the server layer, not the adapter) */
  replyTo: string;
  source: MessageSource;
  message: MessageItem[];
}

/**
 * Outbound message — the adapter sends this to the channel.
 */
export interface OutboundMessage {
  /** Native channel/room ID (e.g. Slack channel ID) */
  targetId: string;
  /** Native thread identifier — if set, message is posted in this thread */
  threadId?: string;
  content: MessageItem[];
}

// ---------------------------------------------------------------------------
// A2H request/response
// ---------------------------------------------------------------------------

/**
 * A2H request passed to adapter.requestA2H().
 * The adapter renders this as the appropriate channel interaction
 * (Block Kit buttons, inline keyboard, etc.) and returns when resolved.
 */
export interface A2HRequest {
  intent: A2HIntent;
  context: A2HContext;
  /** Native channel/room ID (e.g. Slack channel ID) */
  targetId: string;
  /** Native thread identifier to post the interaction in */
  threadId?: string;
}

/** Human's response to an A2H interaction */
export interface A2HResponse {
  /** For AUTHORIZE: true = approved, false = denied */
  approved?: boolean;
  /** For COLLECT: the provided value or selected option */
  value?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ChannelAdapter interface
// ---------------------------------------------------------------------------

/**
 * ChannelAdapter — the contract every channel implementation must satisfy.
 *
 * Lifecycle: construct → onMessage(handler) → start() → [events] → stop()
 */
export interface ChannelAdapter {
  /** Returns the static capabilities of this channel */
  capabilities(): ChannelCapabilities;

  /** Register the handler that processes every inbound message */
  onMessage(handler: (envelope: InboundEnvelope) => Promise<void>): void;

  /** Start the adapter (open connections, subscribe to webhooks, etc.) */
  start(): Promise<void>;

  /** Gracefully stop the adapter */
  stop(): Promise<void>;

  /**
   * Send a conventional outbound message.
   * A2H intents in content.message are sent as INFORM (fire-and-forget).
   * Use requestA2H for blocking A2H interactions.
   */
  send(message: OutboundMessage): Promise<void>;

  /**
   * Send an A2H interaction and await the human's response.
   * Blocks until the human responds (button click, menu selection, thread reply).
   */
  requestA2H(request: A2HRequest): Promise<A2HResponse>;
}
