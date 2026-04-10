/**
 * SessionManager — handles the Baileys WhatsApp Web connection lifecycle.
 *
 * Responsibilities:
 *   - Initial QR-code authentication flow
 *   - Persistent auth state via `useMultiFileAuthState`
 *   - Exponential-backoff reconnection on unexpected disconnects
 *   - Graceful shutdown
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type SocketConfig,
} from '@whiskeysockets/baileys';
import Pino from 'pino';

export interface SessionManagerOptions {
  /** Directory where Baileys persists the auth state (creds + keys) */
  sessionDir: string;
  /** Called with the QR string when the device is not yet paired */
  qrCallback?: (qr: string) => void;
  /** Maximum number of automatic reconnection attempts (default: 10) */
  maxRetries?: number;
  /** Optional Pino logger instance; defaults to silent */
  logger?: ReturnType<typeof Pino>;
}

export type IncomingMessageHandler = (messages: unknown[]) => Promise<void>;

export class SessionManager {
  readonly maxRetries: number;

  /** Register this before calling connect() to receive incoming WhatsApp messages */
  onMessage?: IncomingMessageHandler;

  private sock?: WASocket;
  private stopped = false;
  private retryCount = 0;

  // Deferred promise for the initial connection
  private pendingResolve?: (sock: WASocket) => void;
  private pendingReject?: (err: unknown) => void;

  private readonly options: SessionManagerOptions;

  constructor(options: SessionManagerOptions) {
    this.options = options;
    this.maxRetries = options.maxRetries ?? 10;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect to WhatsApp (blocks until paired or throws after max retries).
   * Returns the live WASocket on success.
   */
  async connect(): Promise<WASocket> {
    if (this.sock) return this.sock;
    this.stopped = false;
    this.retryCount = 0;

    return new Promise<WASocket>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      void this.createSocket().catch(reject);
    });
  }

  /**
   * Gracefully close the WhatsApp connection.
   * Prevents automatic reconnection after this call.
   */
  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — socket creation & event wiring
  // ---------------------------------------------------------------------------

  private async createSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.options.sessionDir);

    const logger = (this.options.logger ?? Pino({ level: 'silent' })) as SocketConfig['logger'];

    const sock = makeWASocket({
      auth: state,
      // Only print the QR in terminal when no custom callback is provided
      printQRInTerminal: !this.options.qrCallback,
      logger,
    });

    this.sock = sock;

    // Persist credentials whenever they are updated
    sock.ev.on('creds.update', saveCreds);

    // Dispatch incoming messages to the registered handler
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      if (this.onMessage) {
        void this.onMessage(messages as unknown[]);
      }
    });

    // Handle connection state changes
    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update);
    });
  }

  private async handleConnectionUpdate(update: {
    connection?: string;
    lastDisconnect?: { error?: Error };
    qr?: string;
  }): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    // Surface the QR code to the caller
    if (qr && this.options.qrCallback) {
      this.options.qrCallback(qr);
    }

    if (connection === 'open') {
      this.retryCount = 0;
      // Resolve the deferred connect() promise
      if (this.pendingResolve && this.sock) {
        const resolve = this.pendingResolve;
        this.pendingResolve = undefined;
        this.pendingReject = undefined;
        resolve(this.sock);
      }
      return;
    }

    if (connection === 'close') {
      // @hapi/boom is Baileys' internal dep — access output.statusCode via duck-typing
      const boom = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const statusCode = boom?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      // Do not reconnect if the session was logged out or we were stopped manually
      if (isLoggedOut || this.stopped) {
        if (this.pendingReject) {
          const reject = this.pendingReject;
          this.pendingResolve = undefined;
          this.pendingReject = undefined;
          reject(new Error('WhatsApp session logged out'));
        }
        return;
      }

      // Exponential back-off reconnection
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delayMs = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30_000);
        await new Promise<void>((r) => setTimeout(r, delayMs));
        if (!this.stopped) {
          await this.createSocket();
        }
      } else {
        const err = new Error(
          `WhatsApp: exceeded max reconnection attempts (${this.maxRetries})`,
        );
        if (this.pendingReject) {
          const reject = this.pendingReject;
          this.pendingResolve = undefined;
          this.pendingReject = undefined;
          reject(err);
        }
      }
    }
  }
}
