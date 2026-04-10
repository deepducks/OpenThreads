import type { A2HResponse, A2HIntent } from '../types/index.js';

/**
 * Error thrown when a blocking A2H intent times out waiting for a human response.
 */
export class TimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly intent: A2HIntent,
    public readonly turnId: string,
  ) {
    super(
      `A2H intent "${intent}" for turn "${turnId}" timed out after ${timeoutMs}ms with no response`,
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap a promise with a deadline.
 *
 * Rejects with `TimeoutError` if the promise does not settle within `timeoutMs`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  intent: A2HIntent,
  turnId: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs, intent, turnId));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * PendingResponse tracks an in-flight A2H interaction that is waiting for the
 * human to respond (via form submission, button click, etc.).
 *
 * The Reply Engine stores one PendingResponse per blocking A2H item, keyed by
 * turnId + index. When the form server (or channel adapter) receives the
 * human's answer, it calls `resolve()` to unblock the engine.
 */
export interface PendingResponse {
  resolve: (response: A2HResponse) => void;
  reject: (error: unknown) => void;
  intent: A2HIntent;
  createdAt: Date;
}

/**
 * Registry of pending form responses.
 *
 * The Reply Engine registers a pending entry when it sends a method-3 form link.
 * The form server calls `ResponseRegistry.submit()` when the human submits the form,
 * which resolves the corresponding promise and unblocks the Reply Engine.
 */
export class ResponseRegistry {
  private readonly pending = new Map<string, PendingResponse>();

  /**
   * Create a pending entry for `key` and return a Promise that resolves when
   * `submit(key, response)` is called.
   */
  wait(key: string, intent: A2HIntent): Promise<A2HResponse> {
    return new Promise<A2HResponse>((resolve, reject) => {
      this.pending.set(key, { resolve, reject, intent, createdAt: new Date() });
    });
  }

  /**
   * Resolve the pending entry for `key` with the human's response.
   * Returns true if a pending entry was found and resolved, false otherwise.
   */
  submit(key: string, response: A2HResponse): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    this.pending.delete(key);
    entry.resolve(response);
    return true;
  }

  /**
   * Reject the pending entry for `key` (e.g., form expired or cancelled).
   * Returns true if a pending entry was found and rejected, false otherwise.
   */
  cancel(key: string, reason?: unknown): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    this.pending.delete(key);
    entry.reject(reason ?? new Error(`Pending response for key "${key}" was cancelled`));
    return true;
  }

  /** Returns the number of currently pending entries. */
  get size(): number {
    return this.pending.size;
  }

  /** Check whether a pending entry exists for `key`. */
  has(key: string): boolean {
    return this.pending.has(key);
  }
}
