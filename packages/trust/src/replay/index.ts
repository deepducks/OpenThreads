/**
 * Replay protection for the OpenThreads Trust Layer.
 *
 * Guards against:
 *   1. Stale intents — timestamps outside the configured tolerance window
 *   2. Future intents — timestamps too far ahead of the server clock
 *   3. Nonce reuse — same JTI (nonce) used more than once
 *
 * In-memory implementation. For distributed deployments, swap the nonce store
 * with a Redis-backed implementation.
 */

import { ReplayError } from '../types.js';

// ─── Nonce store ──────────────────────────────────────────────────────────────

interface NonceEntry {
  /** When this nonce entry expires and can be evicted */
  expiresAt: number; // Unix ms
}

export class ReplayGuard {
  private readonly nonces = new Map<string, NonceEntry>();
  private readonly toleranceMs: number;
  private readonly nonceTtlMs: number;

  /**
   * @param toleranceSecs  Max age (and future skew) for intent timestamps. Default: 300 (5 min).
   * @param nonceTtlSecs   How long nonces are remembered. Default: 3600 (1h).
   */
  constructor(toleranceSecs = 300, nonceTtlSecs = 3600) {
    this.toleranceMs = toleranceSecs * 1000;
    this.nonceTtlMs = nonceTtlSecs * 1000;
  }

  /**
   * Validate that a timestamp is within the acceptable window.
   * Throws `ReplayError` if the timestamp is stale or too far in the future.
   */
  validateTimestamp(timestamp: Date): void {
    const now = Date.now();
    const ts = timestamp.getTime();

    if (ts < now - this.toleranceMs) {
      throw new ReplayError(
        'intent_expired',
        `Intent timestamp is too old. Age: ${Math.round((now - ts) / 1000)}s, tolerance: ${Math.round(this.toleranceMs / 1000)}s`,
      );
    }

    if (ts > now + this.toleranceMs) {
      throw new ReplayError(
        'intent_future',
        `Intent timestamp is too far in the future. Skew: ${Math.round((ts - now) / 1000)}s, tolerance: ${Math.round(this.toleranceMs / 1000)}s`,
      );
    }
  }

  /**
   * Check if a nonce has already been seen.
   * Throws `ReplayError` if the nonce has been used before.
   */
  checkNonce(nonce: string): void {
    const entry = this.nonces.get(nonce);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        throw new ReplayError('nonce_reused', `Nonce "${nonce}" has already been used`);
      }
      // Entry is expired — clean it up.
      this.nonces.delete(nonce);
    }
  }

  /**
   * Record a nonce as used. Should be called after a successful replay check.
   * The nonce is remembered for `nonceTtlMs` milliseconds.
   */
  recordNonce(nonce: string, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.nonceTtlMs);
    this.nonces.set(nonce, { expiresAt });

    // Schedule lazy eviction.
    const ttl = ttlMs ?? this.nonceTtlMs;
    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => this.nonces.delete(nonce), ttl);
    }
  }

  /**
   * Full replay check: validate timestamp and check nonce.
   * On success, records the nonce.
   * Throws `ReplayError` on any violation.
   */
  check(nonce: string, timestamp: Date): void {
    this.validateTimestamp(timestamp);
    this.checkNonce(nonce);
    this.recordNonce(nonce);
  }

  /**
   * Remove all expired nonce entries. Call periodically to avoid unbounded growth.
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [nonce, entry] of this.nonces) {
      if (entry.expiresAt <= now) {
        this.nonces.delete(nonce);
        removed++;
      }
    }
    return removed;
  }

  /** Number of currently tracked nonces. */
  get size(): number {
    return this.nonces.size;
  }
}
