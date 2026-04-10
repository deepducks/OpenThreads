import type { A2HIntent, A2HMessage } from '@openthreads/core';

// ─── Trust configuration ───────────────────────────────────────────────────────

export interface TrustConfig {
  /** Whether the trust layer is active. When false, no trust logic runs. */
  enabled: boolean;
  /** JWS signing algorithm. Default: 'ES256' (ECDSA P-256 + SHA-256). */
  jwsAlgorithm?: 'ES256' | 'RS256' | 'PS256';
  /** Pre-generated private key for signing. If absent, one is auto-generated. */
  privateKey?: CryptoKey;
  /** Pre-generated public key for verification. */
  publicKey?: CryptoKey;
  /**
   * Acceptable time skew in seconds for replay protection.
   * Intents with timestamps older than this are rejected. Default: 300 (5 min).
   */
  timestampToleranceSecs?: number;
  /**
   * How long a nonce is remembered after use (seconds). Default: 3600 (1h).
   * Should be at least 2x timestampToleranceSecs.
   */
  nonceTtlSecs?: number;
}

// ─── JWS / Signing ────────────────────────────────────────────────────────────

/** JWS header claims */
export interface JwsHeader {
  /** Algorithm, e.g. 'ES256' */
  alg: string;
  /** Always 'JWT' for our purposes */
  typ: 'JWT';
  /** Optional key ID */
  kid?: string;
}

/** Claims embedded in a signed A2H intent JWS */
export interface IntentClaims {
  /** Intent type (sub = subject) */
  sub: A2HIntent;
  /** Issued-at timestamp (Unix seconds) */
  iat: number;
  /** JWT ID / nonce — used for replay protection */
  jti: string;
  /** Turn identifier */
  tid: string;
  /** Full A2H message payload */
  intent: A2HMessage;
  /** Optional trace/correlation ID */
  traceId?: string;
}

/** Claims embedded in a signed response JWS */
export interface ResponseClaims {
  /** Intent type */
  sub: A2HIntent;
  /** Issued-at timestamp (Unix seconds) */
  iat: number;
  /** JWT ID / nonce */
  jti: string;
  /** Human's response payload */
  response: unknown;
  /** Nonce of the parent intent JWS (links response → intent) */
  intentJti?: string;
}

/** Result of signing an A2H intent */
export interface SignedEvidence {
  /** The original A2H message that was signed */
  intent: A2HMessage;
  /** Turn identifier this evidence is bound to */
  turnId: string;
  /** JWS compact serialization: base64url(header).base64url(payload).base64url(sig) */
  jws: string;
  /** When the evidence was signed */
  timestamp: Date;
  /** Nonce embedded in the JWS (jti claim) — use for replay checks */
  nonce: string;
}

/** Result of signing the human's response */
export interface SignedResponse {
  /** The human's response payload */
  response: unknown;
  /** JWS compact serialization */
  jws: string;
  /** When the response was signed */
  timestamp: Date;
  /** Nonce embedded in the JWS */
  nonce: string;
  /** Nonce of the originating intent (binds response → intent) */
  intentNonce?: string;
}

/** Generated key pair for JWS operations */
export interface TrustKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** JWK representation of the public key for export/sharing */
  publicKeyJwk: JsonWebKey;
}

// ─── Replay protection ─────────────────────────────────────────────────────────

export type ReplayRejectReason = 'intent_expired' | 'intent_future' | 'nonce_reused';

/** Thrown when a replay attack is detected */
export class ReplayError extends Error {
  constructor(
    public readonly code: ReplayRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'ReplayError';
  }
}

// ─── Audit logging ─────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'intent_sent'
  | 'intent_rendered'
  | 'auth_challenge_issued'
  | 'auth_challenge_completed'
  | 'auth_challenge_failed'
  | 'response_received'
  | 'evidence_signed'
  | 'replay_rejected';

/** Structured audit log entry recording a single A2H lifecycle event */
export interface AuditLogEntry {
  /** Unique entry ID */
  id: string;
  /** Event type */
  eventType: AuditEventType;
  /** Turn this event belongs to */
  turnId: string;
  /** Thread this turn belongs to (when known) */
  threadId?: string;
  /** Channel this interaction happened in */
  channelId?: string;
  /** Actor who triggered the event (human user ID, agent ID, etc.) */
  actorId?: string;
  /** Channel-specific metadata (platform, target ID, etc.) */
  channelMetadata?: Record<string, unknown>;
  /** A2H intent type involved */
  intentType?: A2HIntent;
  /** Trace/correlation ID from the A2H message */
  traceId?: string;
  /** Nonce associated with the JWS (for evidence tracing) */
  nonce?: string;
  /** When the event occurred */
  timestamp: Date;
  /** Arbitrary event-specific payload */
  payload?: unknown;
}

/** Filter for querying the audit log */
export interface AuditLogFilter {
  turnId?: string;
  threadId?: string;
  channelId?: string;
  eventType?: AuditEventType;
  fromDate?: Date;
  toDate?: Date;
  /** Maximum number of results (default: 100) */
  limit?: number;
  /** Skip N results (for pagination) */
  offset?: number;
}

/** Abstract storage interface for audit log entries */
export interface AuditStorageAdapter {
  /** Persist an audit log entry */
  saveAuditEntry(entry: AuditLogEntry): Promise<void>;
  /** Query audit log entries with optional filters */
  queryAuditLog(filter: AuditLogFilter): Promise<AuditLogEntry[]>;
}

// ─── Authentication challenge ──────────────────────────────────────────────────

export type AuthMethod = 'webauthn' | 'totp' | 'sms_otp';

/** An issued authentication challenge that must be completed before form submission */
export interface AuthChallenge {
  /** Unique challenge ID */
  challengeId: string;
  /** Form key this challenge is tied to */
  formKey: string;
  /** Authentication method */
  method: AuthMethod;
  /** Base64url-encoded challenge bytes sent to the authenticator */
  challenge: string;
  /** When this challenge expires */
  expiresAt: Date;
  /** Whether the challenge has been verified */
  verified: boolean;
  /** When the challenge was verified (if verified) */
  verifiedAt?: Date;
  /** Identity linked to the verified credential */
  identityId?: string;
  /** When the challenge was created */
  createdAt: Date;
}

/** Result of verifying an auth challenge */
export interface AuthChallengeResult {
  success: boolean;
  challengeId: string;
  verifiedAt?: Date;
  identityId?: string;
  error?: string;
}

/** WebAuthn credential assertion sent by the browser */
export interface WebAuthnAssertion {
  /** base64url credential ID */
  credentialId: string;
  /** base64url authenticatorData */
  authenticatorData: string;
  /** base64url clientDataJSON */
  clientDataJSON: string;
  /** base64url signature */
  signature: string;
  /** base64url user handle (optional) */
  userHandle?: string;
}

/** TOTP verification request */
export interface TotpVerification {
  /** 6-digit TOTP code */
  code: string;
}
