/**
 * Idempotent inbound message deduplication.
 *
 * Prevents the same platform event from being processed more than once when
 * a platform retries delivery (e.g., Slack retries events that receive no 2xx
 * within 3 seconds; Telegram retries if the bot misses a getUpdates poll).
 *
 * Usage:
 *   1. Call `deduplicationStore.check(key)` with a stable event identifier.
 *   2. If it returns `true`, the event is a duplicate — return 200 immediately.
 *   3. If it returns `false`, process the event then call `.seen(key)`.
 *
 * The store is intentionally kept as a simple interface so it can be backed
 * by Redis, a database, or the default in-process LRU (for single-instance
 * deployments and testing).
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DeduplicationStore {
  /**
   * Returns `true` if the key was previously seen (and is still within TTL).
   * Does NOT record the key.
   */
  check(key: string): boolean;
  /**
   * Record `key` as seen.  Subsequent `check(key)` calls will return `true`
   * until the key's TTL expires.
   */
  seen(key: string, ttlMs?: number): void;
}

// ---------------------------------------------------------------------------
// In-memory LRU-capped store (default, single-process)
// ---------------------------------------------------------------------------

interface Entry {
  expiresAt: number;
}

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1_000;

/** Maximum number of keys to track before evicting the oldest. */
const DEFAULT_MAX_SIZE = 10_000;

/**
 * In-memory deduplication store backed by a Map with LRU-style eviction.
 *
 * Suitable for single-instance deployments.  For multi-instance deployments,
 * replace with a Redis-backed implementation that exposes the same interface.
 */
export class InMemoryDeduplicationStore implements DeduplicationStore {
  private readonly seen_keys = new Map<string, Entry>();
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  check(key: string): boolean {
    const entry = this.seen_keys.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.seen_keys.delete(key);
      return false;
    }

    return true;
  }

  seen(key: string, ttlMs = DEFAULT_TTL_MS): void {
    // Evict the oldest entry if at capacity.
    if (this.seen_keys.size >= this.maxSize) {
      const oldest = this.seen_keys.keys().next().value;
      if (oldest !== undefined) this.seen_keys.delete(oldest);
    }

    this.seen_keys.set(key, { expiresAt: Date.now() + ttlMs });
  }

  /** Returns the number of currently tracked keys (includes expired, pre-eviction). */
  get size(): number {
    return this.seen_keys.size;
  }

  /** Purge all expired entries.  Can be called periodically to reclaim memory. */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.seen_keys) {
      if (now > entry.expiresAt) {
        this.seen_keys.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific key builders
// ---------------------------------------------------------------------------

/**
 * Build a deduplication key for a Slack event.
 *
 * Slack includes a unique `event_id` on every event payload. Retries carry
 * the same `event_id`, making it ideal as a deduplication key.
 */
export function slackEventKey(eventId: string): string {
  return `slack:${eventId}`;
}

/**
 * Build a deduplication key for a Telegram update.
 *
 * Each Telegram update has a monotonically increasing `update_id` per bot.
 */
export function telegramUpdateKey(botId: string, updateId: number): string {
  return `telegram:${botId}:${updateId}`;
}

/**
 * Build a deduplication key for a WhatsApp message.
 *
 * WhatsApp message IDs are unique per JID (phone/group).
 */
export function whatsappMessageKey(jid: string, messageId: string): string {
  return `whatsapp:${jid}:${messageId}`;
}

/**
 * Generic deduplication key from an arbitrary channel + native message ID.
 */
export function genericMessageKey(channelId: string, nativeMessageId: string): string {
  return `msg:${channelId}:${nativeMessageId}`;
}

// ---------------------------------------------------------------------------
// Singleton store (shared across webhook handlers in the same process)
// ---------------------------------------------------------------------------

let _defaultStore: InMemoryDeduplicationStore | null = null;

/**
 * Returns the process-wide default deduplication store, creating it on first call.
 * Suitable for single-process deployments using the in-memory store.
 */
export function getDefaultDeduplicationStore(): InMemoryDeduplicationStore {
  if (!_defaultStore) {
    _defaultStore = new InMemoryDeduplicationStore();
  }
  return _defaultStore;
}
