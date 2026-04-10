// @openthreads/trust
// Optional trust layer: JWS signing, strong authentication, audit logging, replay protection.
// Enable for compliance requirements; skip for lightweight deployments (zero overhead).

// ─── Types ───────────────────────────────────────────────────────────────────

export type {
  TrustConfig,
  JwsHeader,
  IntentClaims,
  ResponseClaims,
  SignedEvidence,
  SignedResponse,
  TrustKeyPair,
  ReplayRejectReason,
  AuditEventType,
  AuditLogEntry,
  AuditLogFilter,
  AuditStorageAdapter,
  AuthMethod,
  AuthChallenge,
  AuthChallengeResult,
  WebAuthnAssertion,
  TotpVerification,
} from './types.js';

export { ReplayError } from './types.js';

// ─── JWS ─────────────────────────────────────────────────────────────────────

export {
  generateKeyPair,
  importPublicKey,
  exportPrivateKey,
  importPrivateKey,
  sign as jwsSign,
  verify as jwsVerify,
  signIntent as jwsSignIntent,
  signResponse as jwsSignResponse,
  decodeUnverified as jwsDecodeUnverified,
} from './jws/index.js';

// ─── Replay protection ────────────────────────────────────────────────────────

export { ReplayGuard } from './replay/index.js';

// ─── Audit logging ────────────────────────────────────────────────────────────

export { AuditLogger } from './audit/logger.js';
export { InMemoryAuditStorage } from './audit/storage.js';

// ─── Authentication ───────────────────────────────────────────────────────────

export { AuthChallengeManager } from './auth/challenge-manager.js';
export type { AuthChallengeManagerOptions } from './auth/challenge-manager.js';
export {
  generateWebAuthnChallenge,
  buildCredentialRequestOptions,
  verifyWebAuthnAssertion,
} from './auth/webauthn.js';
export {
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  encodeBase32,
  decodeBase32,
} from './auth/totp.js';
export type { TotpOptions } from './auth/totp.js';

// ─── Trust Layer Manager ──────────────────────────────────────────────────────

export { TrustLayerManager } from './trust-layer.js';
