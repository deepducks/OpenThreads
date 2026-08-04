/**
 * Server-side trust layer singleton.
 *
 * Instantiates the TrustLayerManager once and attaches it to globalThis so it
 * survives hot-reloads in development. Reads configuration from environment
 * variables:
 *
 *   TRUST_LAYER_ENABLED=true          — enable the trust layer
 *   TRUST_LAYER_ALGORITHM=ES256       — JWS algorithm (default: ES256)
 *   TRUST_LAYER_TIMESTAMP_TOLERANCE=300 — seconds (default: 300)
 *   TRUST_LAYER_NONCE_TTL=3600        — seconds (default: 3600)
 *   WEBAUTHN_RP_ID=openthreads.host   — relying party ID for WebAuthn
 *   TRUST_DEFAULT_AUTH_METHOD=totp    — default auth method (default: totp)
 *
 * The trust layer is wired with a MongoDB-backed audit storage adapter when
 * enabled. All audit log entries are written to the `audit_log` collection.
 */

import type { AuditLogEntry, AuditLogFilter, AuditStorageAdapter } from '@openthreads/trust';
import { TrustLayerManager } from '@openthreads/trust';
import { saveAuditEntry, queryAuditLog, type AuditLogDoc } from './db';

// ─── MongoDB audit storage adapter ───────────────────────────────────────────

class MongoAuditStorage implements AuditStorageAdapter {
  async saveAuditEntry(entry: AuditLogEntry): Promise<void> {
    await saveAuditEntry(entry as unknown as AuditLogDoc);
  }

  async queryAuditLog(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    const docs = await queryAuditLog({
      turnId: filter.turnId,
      threadId: filter.threadId,
      channelId: filter.channelId,
      eventType: filter.eventType,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      limit: filter.limit,
      offset: filter.offset,
    });
    return docs as unknown as AuditLogEntry[];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

type TrustServiceGlobal = typeof globalThis & {
  __otTrustService?: TrustLayerManager;
  __otTrustServiceInit?: Promise<TrustLayerManager>;
};

const g = globalThis as TrustServiceGlobal;

export function getTrustEnabled(): boolean {
  return process.env.TRUST_LAYER_ENABLED === 'true';
}

async function createTrustService(): Promise<TrustLayerManager> {
  const enabled = getTrustEnabled();
  const algorithm = (process.env.TRUST_LAYER_ALGORITHM ?? 'ES256') as 'ES256' | 'RS256' | 'PS256';
  const toleranceSecs = Number(process.env.TRUST_LAYER_TIMESTAMP_TOLERANCE ?? 300);
  const nonceTtlSecs = Number(process.env.TRUST_LAYER_NONCE_TTL ?? 3600);
  const rpId = process.env.WEBAUTHN_RP_ID ?? 'localhost';
  const defaultMethod = (process.env.TRUST_DEFAULT_AUTH_METHOD ?? 'totp') as
    | 'webauthn'
    | 'totp'
    | 'sms_otp';

  const storage = enabled ? new MongoAuditStorage() : undefined;

  return TrustLayerManager.create(
    {
      enabled,
      jwsAlgorithm: algorithm,
      timestampToleranceSecs: toleranceSecs,
      nonceTtlSecs,
    },
    storage,
    { defaultMethod, rpId },
  );
}

/**
 * Get the server-wide TrustLayerManager singleton.
 * Initialises it on first call.
 */
export async function getTrustService(): Promise<TrustLayerManager> {
  if (g.__otTrustService) return g.__otTrustService;

  if (!g.__otTrustServiceInit) {
    g.__otTrustServiceInit = createTrustService().then((svc) => {
      g.__otTrustService = svc;
      return svc;
    });
  }

  return g.__otTrustServiceInit;
}
