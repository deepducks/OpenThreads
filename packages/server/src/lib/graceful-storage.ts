/**
 * Graceful degradation for storage operations.
 *
 * When the storage layer (MongoDB, etc.) becomes temporarily unavailable,
 * it should not cause a complete outage. This module provides helpers that:
 *
 *   1. Catch storage errors and return a safe fallback value.
 *   2. Optionally invoke an `onError` callback for observability.
 *   3. Track whether storage is currently healthy.
 *
 * Usage:
 * ```ts
 * // Instead of:
 * const channel = await db.channels.getById(channelId);
 *
 * // Use:
 * const channel = await withGracefulStorage(
 *   () => db.channels.getById(channelId),
 *   null,
 *   'channels.getById',
 * );
 * if (!channel) {
 *   return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Core utility
// ---------------------------------------------------------------------------

export interface GracefulStorageOptions {
  /**
   * Invoked whenever a storage operation throws.
   * Use for logging / alerting.
   */
  onError?: (operation: string, error: unknown) => void;
}

/**
 * Execute a storage operation, returning `fallback` if the operation throws.
 *
 * @param operation  A function that performs the storage call.
 * @param fallback   Value returned when `operation` throws.
 * @param label      Human-readable label for error logging. Default: 'storage'.
 * @param options    Optional hooks (e.g., onError callback).
 */
export async function withGracefulStorage<T>(
  operation: () => Promise<T>,
  fallback: T,
  label = 'storage',
  options: GracefulStorageOptions = {},
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    options.onError?.(label, err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// StorageHealthMonitor
// ---------------------------------------------------------------------------

/**
 * Tracks the health of the storage layer based on recent operation outcomes.
 *
 * Call `recordSuccess()` / `recordFailure()` around storage operations.
 * `isHealthy()` returns false when the error rate exceeds the threshold in
 * the sliding window — at which point callers should return 503 immediately
 * rather than attempting (and failing) storage calls.
 */
export class StorageHealthMonitor {
  private readonly windowSize: number;
  private readonly failureThreshold: number;
  private readonly outcomes: boolean[] = [];

  /**
   * @param windowSize        Number of recent outcomes to track. Default: 20
   * @param failureThreshold  Fraction of failures that triggers unhealthy.  Default: 0.5
   */
  constructor(windowSize = 20, failureThreshold = 0.5) {
    this.windowSize = windowSize;
    this.failureThreshold = failureThreshold;
  }

  recordSuccess(): void {
    this.push(true);
  }

  recordFailure(): void {
    this.push(false);
  }

  /**
   * Returns `true` when the storage layer appears healthy.
   * Returns `true` when there is not enough history to make a determination.
   */
  isHealthy(): boolean {
    if (this.outcomes.length < this.windowSize) return true;

    const failures = this.outcomes.filter((ok) => !ok).length;
    return failures / this.outcomes.length < this.failureThreshold;
  }

  /** Reset the monitor (e.g., after a successful reconnection). */
  reset(): void {
    this.outcomes.length = 0;
  }

  // Keep the rolling window bounded.
  private push(ok: boolean): void {
    this.outcomes.push(ok);
    if (this.outcomes.length > this.windowSize) {
      this.outcomes.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton monitor
// ---------------------------------------------------------------------------

let _defaultMonitor: StorageHealthMonitor | null = null;

/**
 * Returns the process-wide default `StorageHealthMonitor`, creating it on
 * first call.
 */
export function getDefaultStorageMonitor(): StorageHealthMonitor {
  if (!_defaultMonitor) {
    _defaultMonitor = new StorageHealthMonitor();
  }
  return _defaultMonitor;
}
