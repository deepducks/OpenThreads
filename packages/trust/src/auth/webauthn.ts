/**
 * WebAuthn server-side utilities for the OpenThreads Trust Layer.
 *
 * Handles the server-side of the WebAuthn ceremony:
 *   1. Challenge generation — create a random challenge to send to the browser
 *   2. Credential verification — verify the browser's signed assertion
 *
 * The browser-side (navigator.credentials.get / create) is handled by the
 * form client (FormClient.tsx).
 *
 * References:
 *   - https://www.w3.org/TR/webauthn-2/
 *   - https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API
 */

import type { WebAuthnAssertion } from '../types.js';

// ─── Challenge generation ─────────────────────────────────────────────────────

/**
 * Generate a cryptographically random WebAuthn challenge.
 *
 * @param byteLength  Length of the challenge in bytes. Default: 32 (256 bits).
 * @returns Base64url-encoded challenge string to send to the browser.
 */
export function generateWebAuthnChallenge(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64urlEncodeBytes(bytes);
}

/**
 * Build the PublicKeyCredentialRequestOptions payload to send to the browser.
 * The browser passes this to `navigator.credentials.get({ publicKey: ... })`.
 */
export function buildCredentialRequestOptions(
  challenge: string,
  rpId: string,
  timeout = 60_000,
): object {
  return {
    challenge,
    rpId,
    timeout,
    userVerification: 'preferred',
  };
}

// ─── Assertion verification ───────────────────────────────────────────────────

/**
 * Verify a WebAuthn authenticator assertion.
 *
 * This implements a simplified subset of the W3C WebAuthn Level 2 verification
 * algorithm — sufficient for standard resident-key / discoverable-credential
 * scenarios. For full Level 2 compliance (attestation, extensions, token
 * binding), use a dedicated library like `@simplewebauthn/server`.
 *
 * @param assertion       The credential assertion from the browser
 * @param expectedChallenge  The challenge that was sent to the browser (base64url)
 * @param expectedRpId    The relying party ID (e.g., "openthreads.host")
 * @param publicKeyJwk    The stored public key for this credential (as JWK)
 * @returns true if the assertion is valid
 */
export async function verifyWebAuthnAssertion(
  assertion: WebAuthnAssertion,
  expectedChallenge: string,
  expectedRpId: string,
  publicKeyJwk: JsonWebKey,
): Promise<boolean> {
  try {
    // 1. Parse clientDataJSON
    const clientDataBytes = base64urlDecodeBytes(assertion.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
      type: string;
      challenge: string;
      origin: string;
    };

    // 2. Verify type
    if (clientData.type !== 'webauthn.get') return false;

    // 3. Verify challenge
    if (clientData.challenge !== expectedChallenge) return false;

    // 4. Parse authenticatorData
    const authDataBytes = base64urlDecodeBytes(assertion.authenticatorData);
    if (authDataBytes.length < 37) return false;

    // Bytes 0-31: rpIdHash (SHA-256 of the RP ID)
    const rpIdHash = authDataBytes.slice(0, 32);
    const expectedRpIdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expectedRpId)),
    );
    if (!uint8ArrayEqual(rpIdHash, expectedRpIdHash)) return false;

    // Byte 32: flags
    const flags = authDataBytes[32];
    const userPresent = (flags & 0x01) !== 0;
    if (!userPresent) return false;

    // 5. Verify signature over clientDataHash + authenticatorData
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', clientDataBytes),
    );
    const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
    signedData.set(authDataBytes, 0);
    signedData.set(clientDataHash, authDataBytes.length);

    // Import the public key (EC P-256)
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );

    const signatureBytes = base64urlDecodeBytes(assertion.signature);
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signatureBytes,
      signedData,
    );
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecodeBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
