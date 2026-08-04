/**
 * Global in-process registry for pending A2H form responses.
 *
 * When the Reply Engine generates a form URL (methods 3 & 4), it registers
 * a pending entry keyed by formKey (turnId or `${turnId}_batch`). The form
 * submission API route calls `formRegistry.submit()` to resolve the promise
 * and unblock the Reply Engine.
 *
 * Implemented as a global singleton (via `globalThis`) so it persists across
 * hot-reloads in development and is shared across all Next.js API route
 * invocations within the same Node.js process.
 */

export type A2HIntent = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT';

export interface A2HResponse {
  intent: A2HIntent;
  /** The human's answer. true/false for AUTHORIZE; field map for COLLECT. */
  response: unknown;
  /** Optional free-text comment (AUTHORIZE) */
  comment?: string;
  /** Timestamp of the human's response */
  respondedAt: string;
}

interface PendingEntry {
  resolve: (response: A2HResponse) => void;
  reject: (error: unknown) => void;
  intent: A2HIntent;
  createdAt: Date;
}

class FormResponseRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * Register a pending entry for `key`.
   * Returns a Promise that resolves when `submit(key, response)` is called.
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
   */
  cancel(key: string, reason?: unknown): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    this.pending.delete(key);
    entry.reject(reason ?? new Error(`Pending form response for key "${key}" was cancelled`));
    return true;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  get size(): number {
    return this.pending.size;
  }
}

// Attach to globalThis so it survives module re-evaluation during hot-reload.
const g = globalThis as typeof globalThis & { __otFormRegistry?: FormResponseRegistry };
if (!g.__otFormRegistry) {
  g.__otFormRegistry = new FormResponseRegistry();
}

export const formRegistry: FormResponseRegistry = g.__otFormRegistry;
