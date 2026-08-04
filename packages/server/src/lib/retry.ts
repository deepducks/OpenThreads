/**
 * Exponential backoff retry utility.
 *
 * Used by the webhook fan-out layer to retry failed deliveries.
 */

export interface RetryOptions {
  /** Maximum number of total attempts (first try + retries). Default: 3 */
  maxAttempts: number;
  /** Delay before the second attempt in milliseconds. Default: 1000 */
  initialDelayMs: number;
  /** Cap on the computed delay (prevents runaway backoff). Default: 30000 */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each attempt. Default: 2 */
  backoffFactor: number;
  /**
   * Optional predicate — called with the thrown error.
   * When it returns `false`, the retry loop stops immediately and the error
   * is re-thrown without further attempts.
   * Default: always retry.
   */
  retryable?: (error: unknown) => boolean;
  /**
   * Optional callback invoked before each retry (not before the first attempt).
   */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

/**
 * Execute `fn`, retrying up to `options.maxAttempts` times with exponential
 * backoff between attempts.
 *
 * Resolves with the first successful return value, or rejects with the last
 * error if all attempts fail.
 *
 * @example
 * ```ts
 * const result = await withRetry(() => fetch(url), { maxAttempts: 5 });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Check if we should stop retrying for this error type.
      if (opts.retryable && !opts.retryable(err)) {
        throw err;
      }

      // On the final attempt, don't schedule another delay.
      if (attempt === opts.maxAttempts) break;

      // Exponential backoff: initialDelayMs * backoffFactor^(attempt-1)
      const rawDelay = opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1);
      const delayMs = Math.min(rawDelay, opts.maxDelayMs);

      opts.onRetry?.(attempt, delayMs, err);

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Compute the delay for attempt N (1-indexed, first attempt = 1) without
 * actually sleeping.  Useful for testing and logging.
 */
export function computeRetryDelay(
  attempt: number,
  options: Partial<Pick<RetryOptions, 'initialDelayMs' | 'maxDelayMs' | 'backoffFactor'>> = {},
): number {
  const initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const backoffFactor = options.backoffFactor ?? DEFAULTS.backoffFactor;
  const raw = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
  return Math.min(raw, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
