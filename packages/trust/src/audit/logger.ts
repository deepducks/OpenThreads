/**
 * AuditLogger — structured audit logging for all A2H interactions.
 *
 * Records the full decision path: intent sent → auth → consent → evidence.
 * Delegates storage to the configured AuditStorageAdapter.
 */

import type { AuditEventType, AuditLogEntry, AuditLogFilter, AuditStorageAdapter } from '../types.js';

let _entryCounter = 0;

function generateEntryId(): string {
  _entryCounter = (_entryCounter + 1) % 1_000_000;
  return `ot_audit_${Date.now()}_${_entryCounter.toString().padStart(6, '0')}`;
}

export class AuditLogger {
  constructor(private readonly storage: AuditStorageAdapter) {}

  /**
   * Record an audit log entry.
   *
   * @param eventType   The event type (e.g., 'intent_sent', 'evidence_signed')
   * @param turnId      Turn this event belongs to
   * @param fields      Additional contextual fields
   */
  async log(
    eventType: AuditEventType,
    turnId: string,
    fields: Omit<AuditLogEntry, 'id' | 'eventType' | 'turnId' | 'timestamp'> = {},
  ): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: generateEntryId(),
      eventType,
      turnId,
      timestamp: new Date(),
      ...fields,
    };

    await this.storage.saveAuditEntry(entry);
    return entry;
  }

  /** Query the audit log with optional filters. */
  async query(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
    return this.storage.queryAuditLog(filter);
  }
}
