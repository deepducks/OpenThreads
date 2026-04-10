/**
 * TrustLayerManager — the main entry point for the OpenThreads Trust Layer.
 *
 * Ties together JWS signing, replay protection, audit logging, and auth challenges
 * into a single cohesive interface. Designed to be instantiated once as a singleton.
 *
 * When `config.enabled` is false, all methods are no-ops (zero overhead for
 * lightweight deployments).
 *
 * @example
 * ```ts
 * const trust = await TrustLayerManager.create({ enabled: true });
 *
 * // In the reply engine hook:
 * const evidence = await trust.signIntent(message, turnId);
 * await trust.log('intent_sent', turnId, { intentType: message.intent });
 *
 * // In the form API route:
 * const challenge = await trust.issueAuthChallenge(formKey, 'webauthn');
 * const result = await trust.verifyAuthChallenge(challengeId, assertion);
 * ```
 */

import type {
  AuditLogEntry,
  AuditLogFilter,
  AuditStorageAdapter,
  AuthChallenge,
  AuthChallengeResult,
  AuthMethod,
  SignedEvidence,
  SignedResponse,
  TotpVerification,
  TrustConfig,
  WebAuthnAssertion,
  AuditEventType,
} from './types.js';
import type { A2HMessage, A2HIntent } from '@openthreads/core';
import { generateKeyPair, signIntent as jwsSignIntent, signResponse as jwsSignResponse, verify as jwsVerify } from './jws/index.js';
import { ReplayGuard } from './replay/index.js';
import { AuditLogger } from './audit/logger.js';
import { InMemoryAuditStorage } from './audit/storage.js';
import { AuthChallengeManager } from './auth/challenge-manager.js';
import type { AuthChallengeManagerOptions } from './auth/challenge-manager.js';

export class TrustLayerManager {
  readonly config: Required<TrustConfig>;

  private readonly replayGuard: ReplayGuard;
  private readonly auditLogger: AuditLogger;
  private readonly authManager: AuthChallengeManager;

  private constructor(
    config: Required<TrustConfig>,
    storage: AuditStorageAdapter,
    authOptions?: AuthChallengeManagerOptions,
  ) {
    this.config = config;
    this.replayGuard = new ReplayGuard(
      config.timestampToleranceSecs,
      config.nonceTtlSecs,
    );
    this.auditLogger = new AuditLogger(storage);
    this.authManager = new AuthChallengeManager(authOptions);
  }

  /**
   * Create and initialise a TrustLayerManager.
   *
   * If no keys are provided in the config, an ephemeral ES256 key pair is
   * generated. Pass pre-generated keys for persistence across restarts.
   *
   * @param config      Trust layer configuration
   * @param storage     Audit log storage adapter (defaults to InMemoryAuditStorage)
   * @param authOptions AuthChallengeManager options (rpId, default method, etc.)
   */
  static async create(
    config: TrustConfig,
    storage?: AuditStorageAdapter,
    authOptions?: AuthChallengeManagerOptions,
  ): Promise<TrustLayerManager> {
    let privateKey = config.privateKey;
    let publicKey = config.publicKey;

    if (!privateKey || !publicKey) {
      const pair = await generateKeyPair();
      privateKey = pair.privateKey;
      publicKey = pair.publicKey;
    }

    const full: Required<TrustConfig> = {
      enabled: config.enabled,
      jwsAlgorithm: config.jwsAlgorithm ?? 'ES256',
      privateKey,
      publicKey,
      timestampToleranceSecs: config.timestampToleranceSecs ?? 300,
      nonceTtlSecs: config.nonceTtlSecs ?? 3600,
    };

    return new TrustLayerManager(full, storage ?? new InMemoryAuditStorage(), authOptions);
  }

  // ─── JWS signing ────────────────────────────────────────────────────────────

  /**
   * Sign an A2H intent and return signed evidence.
   *
   * Also records the nonce to prevent replay, and emits an 'evidence_signed'
   * audit log entry.
   *
   * @throws `ReplayError` if `message.idempotencyKey` was already processed
   */
  async signIntent(message: A2HMessage, turnId: string): Promise<SignedEvidence> {
    this.assertEnabled();

    const nonce = crypto.randomUUID();
    const timestamp = new Date();

    // If the intent carries an idempotency key, treat it as the nonce check.
    if (message.idempotencyKey) {
      this.replayGuard.checkNonce(message.idempotencyKey);
      this.replayGuard.recordNonce(message.idempotencyKey);
    }

    this.replayGuard.recordNonce(nonce);

    const jws = await jwsSignIntent(message, turnId, nonce, this.config.privateKey);

    await this.auditLogger.log('evidence_signed', turnId, {
      intentType: message.intent as A2HIntent,
      nonce,
      traceId: message.traceId,
      payload: { action: 'intent_signed', algorithm: this.config.jwsAlgorithm },
    });

    return { intent: message, turnId, jws, timestamp, nonce };
  }

  /**
   * Sign the human's response, cryptographically binding it to the original intent.
   *
   * @param response    The human's response payload
   * @param evidence    The signed evidence from `signIntent`
   * @param actorId     Optional identity of the human responder
   */
  async signResponse(
    response: unknown,
    evidence: SignedEvidence,
    actorId?: string,
  ): Promise<SignedResponse> {
    this.assertEnabled();

    const nonce = crypto.randomUUID();
    const timestamp = new Date();

    this.replayGuard.recordNonce(nonce);

    const jws = await jwsSignResponse(
      response,
      evidence.intent.intent as A2HIntent,
      nonce,
      evidence.nonce,
      this.config.privateKey,
    );

    await this.auditLogger.log('evidence_signed', evidence.turnId, {
      intentType: evidence.intent.intent as A2HIntent,
      traceId: evidence.intent.traceId,
      nonce,
      actorId,
      payload: { action: 'response_signed', intentNonce: evidence.nonce },
    });

    return { response, jws, timestamp, nonce, intentNonce: evidence.nonce };
  }

  /**
   * Verify a piece of signed evidence. Returns true if the JWS is valid.
   */
  async verifyEvidence(evidence: SignedEvidence): Promise<boolean> {
    this.assertEnabled();
    const result = await jwsVerify(evidence.jws, this.config.publicKey);
    return result !== null;
  }

  // ─── Replay protection ───────────────────────────────────────────────────────

  /**
   * Check a nonce + timestamp pair for replay attacks.
   * Records the nonce on success.
   * @throws `ReplayError` on violation
   */
  checkReplay(nonce: string, timestamp: Date): void {
    this.assertEnabled();
    this.replayGuard.check(nonce, timestamp);
  }

  /**
   * Validate only the timestamp (without nonce check).
   * @throws `ReplayError` if timestamp is outside the tolerance window
   */
  validateTimestamp(timestamp: Date): void {
    this.assertEnabled();
    this.replayGuard.validateTimestamp(timestamp);
  }

  /**
   * Manually record a nonce as used (e.g., for idempotency key tracking).
   */
  recordNonce(nonce: string, ttlSecs?: number): void {
    this.assertEnabled();
    this.replayGuard.recordNonce(nonce, ttlSecs ? ttlSecs * 1000 : undefined);
  }

  // ─── Authentication challenges ───────────────────────────────────────────────

  /**
   * Issue an auth challenge that must be completed before form submission.
   *
   * @param formKey  The form key the challenge is tied to
   * @param method   Authentication method (default: configured defaultMethod)
   */
  async issueAuthChallenge(formKey: string, method?: AuthMethod): Promise<AuthChallenge> {
    this.assertEnabled();
    const challenge = await this.authManager.issueChallenge(formKey, method);

    await this.auditLogger.log('auth_challenge_issued', formKey, {
      payload: { challengeId: challenge.challengeId, method: challenge.method },
    });

    return challenge;
  }

  /**
   * Verify an auth challenge response.
   *
   * @param challengeId          ID returned by `issueAuthChallenge`
   * @param response             Authenticator response
   * @param webAuthnPublicKeyJwk Required for WebAuthn verification
   */
  async verifyAuthChallenge(
    challengeId: string,
    response: WebAuthnAssertion | TotpVerification,
    webAuthnPublicKeyJwk?: JsonWebKey,
  ): Promise<AuthChallengeResult> {
    this.assertEnabled();

    const result = await this.authManager.verifyChallenge(
      challengeId,
      response,
      webAuthnPublicKeyJwk,
    );

    const eventType: AuditEventType = result.success
      ? 'auth_challenge_completed'
      : 'auth_challenge_failed';

    // Use challengeId as turnId proxy since we don't always have the turnId here.
    await this.auditLogger.log(eventType, challengeId, {
      actorId: result.identityId,
      payload: { challengeId, success: result.success, error: result.error },
    });

    return result;
  }

  /**
   * Check if a challenge has been verified (for pre-submission validation).
   */
  getVerifiedChallenge(challengeId: string): AuthChallenge | null {
    return this.authManager.getVerifiedChallenge(challengeId);
  }

  // ─── Audit logging ───────────────────────────────────────────────────────────

  /**
   * Record an audit log entry directly.
   * Can be called from reply engine hooks or form route handlers.
   */
  async log(
    eventType: AuditEventType,
    turnId: string,
    fields: Omit<AuditLogEntry, 'id' | 'eventType' | 'turnId' | 'timestamp'> = {},
  ): Promise<AuditLogEntry> {
    return this.auditLogger.log(eventType, turnId, fields);
  }

  /**
   * Query the audit log.
   */
  async queryAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
    return this.auditLogger.query(filter);
  }

  // ─── Maintenance ─────────────────────────────────────────────────────────────

  /**
   * Prune expired nonces and auth challenges.
   * Call periodically (e.g., every 5 minutes) in long-running processes.
   */
  prune(): void {
    this.replayGuard.prune();
    this.authManager.prune();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new Error('Trust layer is not enabled');
    }
  }
}
