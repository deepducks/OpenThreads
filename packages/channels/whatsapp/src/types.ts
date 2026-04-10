/**
 * WhatsApp adapter types for OpenThreads.
 *
 * These mirror the patterns used in the Slack adapter and match the
 * ChannelAdapter interface consumed by the OpenThreads core.
 */

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------

export interface ChannelCapabilities {
  /** Whether the platform supports native threads */
  threads: boolean;
  /** Whether the platform supports interactive button components */
  buttons: boolean;
  /** Whether the platform supports select/dropdown menu components */
  selectMenus: boolean;
  /** Whether the platform supports replying to a specific message */
  replyMessages: boolean;
  /** Whether the platform supports direct messages */
  dms: boolean;
  /** Whether the platform supports file/media uploads */
  fileUpload: boolean;
}

/**
 * WhatsApp capabilities:
 *   - No native threads (simulated via quoted reply chains)
 *   - Buttons: yes, but limited to ≤3 buttons
 *   - No select menus
 *   - Reply messages (quoted replies): yes
 *   - DMs: yes
 *   - File upload: yes
 */
export const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  threads: false,
  buttons: true,
  selectMenus: false,
  replyMessages: true,
  dms: true,
  fileUpload: true,
};

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

export interface WhatsAppAdapterConfig {
  /** Directory to persist Baileys auth state (QR code session files) */
  sessionDir: string;
  /** OpenThreads base URL used to build `replyTo` URLs in inbound envelopes */
  baseUrl?: string;
  /** Optional callback to receive the QR code string for display/scanning */
  qrCallback?: (qr: string) => void;
  /** Maximum reconnection attempts before giving up (default: 10) */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Dependency injection (for testing)
// ---------------------------------------------------------------------------

/**
 * A minimal interface over `WASocket` sufficient for sending messages.
 * Test doubles can implement this without pulling in all of Baileys.
 */
export interface MockableSocket {
  sendMessage(
    jid: string,
    content: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ key: { id?: string } }>;
  end(error?: Error): void;
}

/**
 * Optional dependencies injected in tests.
 * When `socket` is provided, `initialize()` uses it directly
 * and bypasses the real Baileys connection / QR flow.
 */
export interface WhatsAppAdapterDeps {
  socket?: MockableSocket;
}

// ---------------------------------------------------------------------------
// Envelope types (mirror Slack adapter conventions)
// ---------------------------------------------------------------------------

export type MessageItem = TextItem | A2HInformIntent | A2HAuthorizeIntent | A2HCollectIntent;

export interface TextItem {
  text: string;
}

export interface InboundEnvelope {
  threadId: string;
  turnId: string;
  replyTo: string;
  source: {
    channel: 'whatsapp';
    channelId: string;
    sender: { id: string; name?: string };
    raw?: unknown;
  };
  message: MessageItem[];
}

export interface OutboundEnvelope {
  /** WhatsApp JID (e.g. `1234567890@s.whatsapp.net` or group `xxx@g.us`) */
  channelId: string;
  /** Recipient user ID */
  targetId: string;
  /** Optional "thread" root message ID (used as context for virtual threads) */
  threadId?: string;
  message: MessageItem | MessageItem[];
}

export interface SendResult {
  messageId: string;
  threadId?: string;
}

// ---------------------------------------------------------------------------
// A2H intent types (mirror Slack adapter — kept self-contained)
// ---------------------------------------------------------------------------

export interface A2HInformIntent {
  intent: 'INFORM';
  id: string;
  text: string;
}

export interface A2HAuthorizeIntent {
  intent: 'AUTHORIZE';
  id: string;
  context: {
    action: string;
    details?: string;
    [key: string]: unknown;
  };
  /**
   * Custom option labels/values for the approval choice.
   * When absent, defaults to Approve / Deny.
   * When ≤3 options: rendered as WhatsApp buttons (method 1).
   * When >3 options: falls back to external form link (method 3).
   */
  options?: Array<{ label: string; value: string }>;
}

export interface A2HCollectIntent {
  intent: 'COLLECT';
  id: string;
  question: string;
  /** When provided, the adapter falls back to an external form (method 3). */
  options?: Array<{ label: string; value: string }>;
}

export type A2HIntent = A2HInformIntent | A2HAuthorizeIntent | A2HCollectIntent;

export interface A2HResponse {
  intentId: string;
  type: 'AUTHORIZE' | 'COLLECT' | 'INFORM';
  /** AUTHORIZE only: whether the human approved */
  approved?: boolean;
  /** COLLECT only: the human's free-text or selected response */
  response?: string;
}

export interface A2HSendOptions {
  /** Override timeout in milliseconds (default: 24 hours) */
  timeoutMs?: number;
  /**
   * Base URL for external form links.
   * Append `/${intentId}` to get the full form URL.
   * Default: `https://openthreads.host/form`
   */
  formBaseUrl?: string;
}

export type MessageHandler = (envelope: InboundEnvelope) => Promise<void>;

// ---------------------------------------------------------------------------
// Internal pending capture state
// ---------------------------------------------------------------------------

/** Resolves a pending A2H interaction with a raw string response value */
export type PendingResolver = (value: string) => void;

/** Tracks the state of an in-flight A2H intent awaiting a human response */
export interface PendingCapture {
  /** The JID the original message was sent to */
  jid: string;
  /** The message ID of the sent A2H message (for updating/referencing) */
  messageId?: string;
  resolver: PendingResolver;
}
