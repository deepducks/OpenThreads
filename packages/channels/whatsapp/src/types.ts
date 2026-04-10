import type { ChannelCapabilities } from "@openthreads/core";

/**
 * Configuration for the WhatsApp adapter.
 */
export interface WhatsAppConfig {
  /**
   * Directory where Baileys will persist the multi-file auth state (credentials,
   * keys, etc.). Must be writable. Each WhatsApp account should use a distinct
   * directory so multiple instances can coexist.
   */
  sessionDir: string;

  /**
   * Base URL of the OpenThreads server, used to build external form links for
   * A2H method-3 fallback (e.g. "https://openthreads.example.com").
   * When absent, method-3 messages still send but without a working URL.
   */
  serverBaseUrl?: string;

  /**
   * Pino log level used for the internal Baileys logger.
   * Defaults to "silent" so Baileys does not pollute the application logs.
   */
  logLevel?: "trace" | "debug" | "info" | "warn" | "error" | "silent";

  /**
   * Base interval (ms) for the first reconnection attempt.
   * Subsequent attempts use exponential backoff capped at 30 s.
   * Defaults to 1 000 ms.
   */
  reconnectIntervalMs?: number;

  /**
   * Maximum number of automatic reconnection attempts before giving up.
   * Defaults to 10.
   */
  maxReconnectAttempts?: number;

  /**
   * Timeout (ms) to wait for a method-2 quoted-reply response before the
   * pending capture expires and the caller receives an error.
   * Defaults to 300 000 ms (5 minutes).
   */
  replyTimeoutMs?: number;
}

/**
 * Constructor options for {@link WhatsAppAdapter}.
 */
export interface WhatsAppAdapterOptions {
  config: WhatsAppConfig;

  /**
   * Called with the raw QR-code string when the device needs to be paired.
   * Consumers can render it as an ASCII QR in the terminal, as an image, or
   * expose it via an API endpoint — the adapter is agnostic.
   */
  onQRCode?: (qr: string) => void | Promise<void>;

  /**
   * Called once the connection reaches the "open" state.
   * @param phoneNumber The WhatsApp account number that is now connected.
   */
  onConnected?: (phoneNumber: string) => void | Promise<void>;

  /**
   * Called whenever the connection closes.
   * @param reason Human-readable description of the disconnect reason.
   */
  onDisconnected?: (reason: string) => void | Promise<void>;
}

/**
 * WhatsApp channel capabilities as reported by the adapter.
 *
 * - threads: false — WhatsApp has no native thread concept; the adapter
 *   emulates virtual threads via quoted-reply chains.
 * - buttons: true (limited) — WhatsApp interactive messages support up to
 *   3 quick-reply buttons.
 * - selectMenus: false — WhatsApp lists are row-based, not <select> menus.
 * - replyMessages: true — quoted replies are the primary interaction primitive.
 * - dms: true — personal chats work as DMs.
 * - fileUpload: true — images, video, audio, and documents are supported.
 */
export const WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  threads: false,
  buttons: true,
  selectMenus: false,
  replyMessages: true,
  dms: true,
  fileUpload: true,
};

/**
 * Maximum number of quick-reply buttons WhatsApp supports per message.
 * https://developers.facebook.com/docs/whatsapp/guides/interactive-messages
 */
export const WHATSAPP_MAX_BUTTONS = 3;

/**
 * Internal record for an in-flight method-2 response capture.
 */
export interface PendingCapture {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** JID of the conversation we are listening on */
  jid: string;
  /** ID of the OpenThreads message the human is expected to reply to */
  promptMessageId: string;
}
