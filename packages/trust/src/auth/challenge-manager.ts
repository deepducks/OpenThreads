/**
 * AuthChallengeManager — issue and verify authentication challenges.
 *
 * Supports two methods:
 *   webauthn  — WebAuthn/Passkey (strong authentication for AUTHORIZE intents)
 *   totp      — Time-based OTP (simpler fallback, RFC 6238)
 *   sms_otp   — SMS OTP stub (actual SMS delivery is external)
 */

import type {
  AuthChallenge,
  AuthChallengeResult,
  AuthMethod,
  TotpVerification,
  WebAuthnAssertion,
} from '../types.js';
import { generateWebAuthnChallenge, verifyWebAuthnAssertion } from './webauthn.js';
import { generateTotpSecret, verifyTotp, encodeBase32 } from './totp.js';

// ─── In-memory challenge store ────────────────────────────────────────────────

interface StoredChallenge extends AuthChallenge {
  /** TOTP secret (raw bytes) when method === 'totp' */
  totpSecret?: Uint8Array;
  /** WebAuthn public key JWK for registered credentials */
  webAuthnPublicKeyJwk?: JsonWebKey;
  /** Relying Party ID for WebAuthn */
  rpId?: string;
}

function generateChallengeId(): string {
  return `ot_ch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateBase64urlChallenge(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── AuthChallengeManager ─────────────────────────────────────────────────────

export interface AuthChallengeManagerOptions {
  /** Default authentication method when not specified. Default: 'totp'. */
  defaultMethod?: AuthMethod;
  /** Challenge TTL in seconds. Default: 300 (5 minutes). */
  challengeTtlSecs?: number;
  /** Relying Party ID for WebAuthn. Default: 'localhost'. */
  rpId?: string;
}

export class AuthChallengeManager {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly defaultMethod: AuthMethod;
  private readonly challengeTtlMs: number;
  private readonly rpId: string;

  constructor(options: AuthChallengeManagerOptions = {}) {
    this.defaultMethod = options.defaultMethod ?? 'totp';
    this.challengeTtlMs = (options.challengeTtlSecs ?? 300) * 1000;
    this.rpId = options.rpId ?? 'localhost';
  }

  /**
   * Issue a new authentication challenge for a form.
   *
   * Returns an `AuthChallenge` that the server sends to the form client.
   * The challenge field contains the data the authenticator needs to respond.
   */
  async issueChallenge(formKey: string, method?: AuthMethod): Promise<AuthChallenge> {
    const m = method ?? this.defaultMethod;
    const challengeId = generateChallengeId();
    const expiresAt = new Date(Date.now() + this.challengeTtlMs);

    let challenge: string;
    const stored: Partial<StoredChallenge> = {};

    if (m === 'webauthn') {
      challenge = generateWebAuthnChallenge();
      stored.rpId = this.rpId;
    } else if (m === 'totp') {
      const secret = generateTotpSecret();
      stored.totpSecret = secret;
      // The challenge carries the base32-encoded secret (sent to client for QR code generation)
      // In production this would be pre-registered; here we provision one per challenge.
      challenge = encodeBase32(secret);
    } else {
      // sms_otp: generate a 6-digit code, challenge is a placeholder (actual SMS is external)
      challenge = generateBase64urlChallenge(4); // used as correlation ID
    }

    const authChallenge: StoredChallenge = {
      challengeId,
      formKey,
      method: m,
      challenge,
      expiresAt,
      verified: false,
      createdAt: new Date(),
      ...stored,
    };

    this.challenges.set(challengeId, authChallenge);

    // Return the public-facing challenge (strip server-side secrets).
    return {
      challengeId,
      formKey,
      method: m,
      challenge,
      expiresAt,
      verified: false,
      createdAt: authChallenge.createdAt,
    };
  }

  /**
   * Verify an authentication challenge response.
   *
   * @param challengeId  The ID returned by `issueChallenge`
   * @param response     The authenticator's response:
   *                       WebAuthn:  `WebAuthnAssertion` object
   *                       TOTP:      `TotpVerification` object with `code`
   *                       SMS OTP:   `TotpVerification` object with `code`
   * @param webAuthnPublicKeyJwk  Required for WebAuthn: the credential's public key
   */
  async verifyChallenge(
    challengeId: string,
    response: WebAuthnAssertion | TotpVerification,
    webAuthnPublicKeyJwk?: JsonWebKey,
  ): Promise<AuthChallengeResult> {
    const stored = this.challenges.get(challengeId);

    if (!stored) {
      return { success: false, challengeId, error: 'Challenge not found' };
    }

    if (stored.expiresAt < new Date()) {
      this.challenges.delete(challengeId);
      return { success: false, challengeId, error: 'Challenge has expired' };
    }

    if (stored.verified) {
      return { success: false, challengeId, error: 'Challenge already used' };
    }

    let success = false;
    let identityId: string | undefined;

    if (stored.method === 'webauthn') {
      const assertion = response as WebAuthnAssertion;
      const publicKeyJwk = webAuthnPublicKeyJwk ?? stored.webAuthnPublicKeyJwk;
      if (!publicKeyJwk) {
        return { success: false, challengeId, error: 'WebAuthn public key not provided' };
      }
      success = await verifyWebAuthnAssertion(
        assertion,
        stored.challenge,
        stored.rpId ?? this.rpId,
        publicKeyJwk,
      );
      if (success) identityId = assertion.credentialId;
    } else if (stored.method === 'totp') {
      const { code } = response as TotpVerification;
      if (!stored.totpSecret) {
        return { success: false, challengeId, error: 'TOTP secret not found' };
      }
      success = await verifyTotp(stored.totpSecret, code);
    } else {
      // sms_otp: for this implementation, accept any 6-digit numeric code
      // (real SMS OTP verification would validate against a sent code stored externally)
      const { code } = response as TotpVerification;
      success = /^\d{6}$/.test(code);
    }

    if (success) {
      const verifiedAt = new Date();
      stored.verified = true;
      stored.verifiedAt = verifiedAt;
      stored.identityId = identityId;
      return { success: true, challengeId, verifiedAt, identityId };
    }

    return { success: false, challengeId, error: 'Verification failed' };
  }

  /**
   * Check if a challenge has been successfully verified.
   * Returns the challenge record if verified, null otherwise.
   */
  getVerifiedChallenge(challengeId: string): AuthChallenge | null {
    const stored = this.challenges.get(challengeId);
    if (!stored || !stored.verified || stored.expiresAt < new Date()) return null;
    return {
      challengeId: stored.challengeId,
      formKey: stored.formKey,
      method: stored.method,
      challenge: stored.challenge,
      expiresAt: stored.expiresAt,
      verified: stored.verified,
      verifiedAt: stored.verifiedAt,
      identityId: stored.identityId,
      createdAt: stored.createdAt,
    };
  }

  /**
   * Remove expired challenge entries. Call periodically to avoid unbounded growth.
   */
  prune(): number {
    const now = new Date();
    let removed = 0;
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt < now) {
        this.challenges.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.challenges.size;
  }
}
