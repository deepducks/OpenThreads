/**
 * Generic reconnect manager for WebSocket-based channel adapters.
 *
 * Provides exponential backoff reconnection that can be reused by
 * any adapter that maintains a persistent connection (Slack Socket Mode,
 * Discord gateway, WhatsApp WebSocket).
 *
 * The WhatsApp adapter ships its own `SessionManager` with equivalent logic.
 * This module provides the same behaviour as a reusable utility for Slack
 * Socket Mode and Discord adapters.
 *
 * Usage:
 * ```ts
 * const reconnect = new ReconnectManager(
 *   () => this.wsClient.connect(),
 *   {
 *     maxAttempts: 10,
 *     initialDelayMs: 1_000,
 *     onRetry: (attempt, delay) => console.log(`Reconnecting (attempt ${attempt}), delay ${delay}ms`),
 *   },
 * );
 *
 * // On disconnect:
 * reconnect.scheduleReconnect(disconnectError);
 *
 * // On destroy:
 * reconnect.stop();
 * ```
 */

export interface ReconnectOptions {
  /**
   * Maximum number of reconnect attempts before giving up.
   * Default: 10
   */
  maxAttempts: number;
  /**
   * Delay before the first reconnect attempt (ms).
   * Default: 1000
   */
  initialDelayMs: number;
  /**
   * Upper bound on the computed delay (ms).
   * Default: 30000
   */
  maxDelayMs: number;
  /**
   * Multiplier applied to the delay after each attempt.
   * Default: 2
   */
  backoffFactor: number;
  /**
   * Called before each reconnect attempt (after the delay).
   */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /**
   * Called when reconnection succeeds.
   */
  onConnected?: () => void;
  /**
   * Called when all attempts are exhausted.
   */
  onExhausted?: (attempts: number) => void;
}

const DEFAULTS: ReconnectOptions = {
  maxAttempts: 10,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

export class ReconnectManager {
  private attempts = 0;
  private stopped = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly options: ReconnectOptions;

  constructor(
    /** Function that establishes the connection. Should throw on failure. */
    private readonly connectFn: () => Promise<void>,
    options: Partial<ReconnectOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Establish the initial connection.
   * Does not use retry — throws immediately on failure.
   * Call `scheduleReconnect()` from the disconnect handler to begin retrying.
   */
  async connect(): Promise<void> {
    this.stopped = false;
    this.attempts = 0;
    await this.connectFn();
    this.attempts = 0;
    this.options.onConnected?.();
  }

  /**
   * Schedule a reconnect attempt after a disconnect.
   *
   * Should be called from the adapter's disconnect/close event handler.
   * Ignored if `stop()` has been called.
   */
  scheduleReconnect(error?: unknown): void {
    if (this.stopped) return;
    if (this.attempts >= this.options.maxAttempts) {
      this.options.onExhausted?.(this.attempts);
      return;
    }

    this.attempts++;

    const rawDelay =
      this.options.initialDelayMs * Math.pow(this.options.backoffFactor, this.attempts - 1);
    const delayMs = Math.min(rawDelay, this.options.maxDelayMs);

    this.pendingTimer = setTimeout(() => {
      if (this.stopped) return;
      this.options.onRetry?.(this.attempts, delayMs, error);
      void this.attemptReconnect(error);
    }, delayMs);
  }

  /**
   * Permanently stop reconnecting.
   * Cancels any pending scheduled reconnect.
   */
  stop(): void {
    this.stopped = true;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /**
   * Reset the attempt counter (call after a successful reconnection).
   */
  resetAttempts(): void {
    this.attempts = 0;
  }

  /** Returns the current attempt count. */
  get currentAttempts(): number {
    return this.attempts;
  }

  /** Returns whether this manager has been stopped. */
  get isStopped(): boolean {
    return this.stopped;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async attemptReconnect(originalError: unknown): Promise<void> {
    try {
      await this.connectFn();
      this.attempts = 0;
      this.options.onConnected?.();
    } catch (err) {
      if (!this.stopped) {
        this.scheduleReconnect(err ?? originalError);
      }
    }
  }
}

/**
 * Compute the reconnect delay for attempt N (1-indexed) without actually sleeping.
 * Useful for logging and unit-testing the backoff curve.
 */
export function computeReconnectDelay(
  attempt: number,
  options: Partial<Pick<ReconnectOptions, 'initialDelayMs' | 'maxDelayMs' | 'backoffFactor'>> = {},
): number {
  const initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const backoffFactor = options.backoffFactor ?? DEFAULTS.backoffFactor;
  const raw = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
  return Math.min(raw, maxDelayMs);
}
