import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
  type ConnectionState,
  type AuthenticationState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import P from "pino";
import type { WhatsAppConfig } from "./types.js";

type SocketReadyCallback = (socket: WASocket) => void;

/**
 * Manages the Baileys WebSocket connection lifecycle:
 *   - Initial QR-code authentication
 *   - Credential persistence via multi-file auth state
 *   - Automatic reconnection with exponential backoff
 *   - Clean shutdown
 *
 * The adapter delegates all Baileys socket creation to this class so that
 * reconnection can transparently swap in a new socket without the caller
 * needing to know.
 */
export class SessionManager {
  private socket: WASocket | null = null;
  private reconnectAttempts = 0;
  private reconnecting = false;
  private destroyed = false;

  /**
   * @param config            Adapter configuration.
   * @param onQRCode          Fired when the socket emits a new QR code.
   * @param onConnected       Fired when the connection reaches "open" state.
   * @param onDisconnected    Fired on every clean or unexpected close.
   * @param onSocketReady     Fired every time a new socket is created so that
   *                          the adapter can (re-)attach its event listeners.
   */
  constructor(
    private readonly config: WhatsAppConfig,
    private readonly onQRCode: (qr: string) => void | Promise<void>,
    private readonly onConnected: (phone: string) => void | Promise<void>,
    private readonly onDisconnected: (reason: string) => void | Promise<void>,
    private readonly onSocketReady: SocketReadyCallback,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Opens the connection for the first time.
   * Subsequent reconnections are handled internally.
   */
  async connect(): Promise<void> {
    await this.createSocket();
  }

  /**
   * Gracefully closes the connection and marks the manager as destroyed.
   * After calling this, no further reconnections will be attempted.
   */
  async disconnect(): Promise<void> {
    this.destroyed = true;

    if (this.socket) {
      try {
        // ev.removeAllListeners is available on the Baileys EventEmitter
        this.socket.ev.removeAllListeners("connection.update");
        this.socket.ev.removeAllListeners("creds.update");
        await this.socket.logout();
      } catch {
        // Ignore errors during shutdown — the socket may already be closed.
      } finally {
        this.socket = null;
      }
    }
  }

  /**
   * Returns the active socket.
   * Throws if the session has not been initialized yet.
   */
  getSocket(): WASocket {
    if (!this.socket) {
      throw new Error(
        "WhatsApp socket is not initialized. Ensure connect() has resolved before using the adapter.",
      );
    }
    return this.socket;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async createSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(
      this.config.sessionDir,
    );

    const { version, isLatest } = await fetchLatestBaileysVersion();

    const logger = P({ level: this.config.logLevel ?? "silent" });

    if (!isLatest) {
      logger.warn(
        { version },
        "Baileys: using an older WhatsApp Web version — consider upgrading @whiskeysockets/baileys",
      );
    }

    this.socket = makeWASocket({
      version,
      auth: state as AuthenticationState,
      logger,
      // Never print the QR to stdout — let the onQRCode callback handle it.
      printQRInTerminal: false,
      // Generous timeouts for slow mobile connections.
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      // Receive messages even while the socket was offline.
      syncFullHistory: false,
      // Ignore the status broadcast list.
      shouldIgnoreJid: (jid) => jid === "status@broadcast",
    });

    // Persist credentials whenever they change.
    this.socket.ev.on("creds.update", saveCreds);

    // Handle connection state changes.
    this.socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(update);
    });

    // Notify the adapter so it can attach its own listeners.
    this.onSocketReady(this.socket);
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      await this.onQRCode(qr);
    }

    if (connection === "open") {
      this.reconnectAttempts = 0;
      this.reconnecting = false;

      // Extract the bare phone number from the JID (e.g. "15551234567:1@s.whatsapp.net" → "15551234567")
      const rawId = this.socket?.user?.id ?? "";
      const phone = rawId.split(":")[0] ?? rawId.split("@")[0] ?? rawId;

      await this.onConnected(phone);
    }

    if (connection === "close") {
      const err = lastDisconnect?.error as Boom | undefined;
      const statusCode = err?.output?.statusCode ?? 0;

      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const reasonLabel =
        (DisconnectReason as Record<number, string>)[statusCode] ??
        err?.message ??
        "Unknown";

      await this.onDisconnected(reasonLabel);

      if (loggedOut) {
        // The session is invalid — cannot reconnect without re-scanning the QR.
        // Surface a clear message so operators know what action to take.
        await this.onDisconnected(
          "Session logged out. Delete the session directory and reconnect to scan a new QR code.",
        );
        return;
      }

      if (!this.destroyed) {
        await this.scheduleReconnect();
      }
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting || this.destroyed) return;

    const maxAttempts = this.config.maxReconnectAttempts ?? 10;

    if (this.reconnectAttempts >= maxAttempts) {
      await this.onDisconnected(
        `WhatsApp reconnection failed after ${maxAttempts} attempts.`,
      );
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff: 1 s, 2 s, 4 s … capped at 30 s.
    const baseMs = this.config.reconnectIntervalMs ?? 1_000;
    const delayMs = Math.min(
      baseMs * Math.pow(2, this.reconnectAttempts - 1),
      30_000,
    );

    await sleep(delayMs);

    this.reconnecting = false;

    if (!this.destroyed) {
      try {
        await this.createSocket();
      } catch {
        await this.scheduleReconnect();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
