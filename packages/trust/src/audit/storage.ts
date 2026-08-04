/**
 * Audit log storage interface and in-memory implementation.
 */

import type { AuditLogEntry, AuditLogFilter, AuditStorageAdapter } from '../types.js';

// ─── In-memory implementation ─────────────────────────────────────────────────

/**
 * InMemoryAuditStorage — simple in-memory audit log.
 *
 * Suitable for development and single-process deployments. For production, wire
 * in a persistence-backed implementation (e.g., MongoAuditStorage in the server
 * package that stores entries in the `audit_log` MongoDB collection).
 */
export class InMemoryAuditStorage implements AuditStorageAdapter {
  private readonly entries: AuditLogEntry[] = [];
  /** Maximum entries to retain in memory. Oldest are evicted when exceeded. */
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  async saveAuditEntry(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      // Evict the oldest entry.
      this.entries.shift();
    }
  }

  async queryAuditLog(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    let results = [...this.entries];

    if (filter.turnId) {
      results = results.filter((e) => e.turnId === filter.turnId);
    }
    if (filter.threadId) {
      results = results.filter((e) => e.threadId === filter.threadId);
    }
    if (filter.channelId) {
      results = results.filter((e) => e.channelId === filter.channelId);
    }
    if (filter.eventType) {
      results = results.filter((e) => e.eventType === filter.eventType);
    }
    if (filter.fromDate) {
      results = results.filter((e) => e.timestamp >= filter.fromDate!);
    }
    if (filter.toDate) {
      results = results.filter((e) => e.timestamp <= filter.toDate!);
    }

    // Sort descending by timestamp (most recent first).
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  /** Total number of stored entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Flush all entries (useful in tests). */
  clear(): void {
    this.entries.length = 0;
  }
}
