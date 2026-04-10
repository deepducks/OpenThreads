/**
 * JWS (JSON Web Signature) utilities for the OpenThreads Trust Layer.
 *
 * Uses the Web Crypto API (built into Bun and Node.js ≥ 19) — no external deps.
 * Default algorithm: ES256 (ECDSA with P-256 curve and SHA-256 hash).
 */

import type { IntentClaims, JwsHeader, ResponseClaims, TrustKeyPair } from '../types.js';
import type { A2HMessage, A2HIntent } from '@openthreads/core';

// ─── Base64url helpers ────────────────────────────────────────────────────────

function base64urlEncodeString(str: string): string {
  return base64urlEncodeBytes(new TextEncoder().encode(str));
}

function base64urlEncodeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
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

function base64urlDecodeString(b64url: string): string {
  return new TextDecoder().decode(base64urlDecodeBytes(b64url));
}

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Generate a new ES256 (ECDSA P-256) key pair for JWS signing.
 * The keys are extractable so they can be exported as JWK for storage/sharing.
 */
export async function generateKeyPair(): Promise<TrustKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyJwk,
  };
}

/**
 * Import an EC public key from a JWK for verification.
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}

/**
 * Export a private key to JWK format for persistence.
 */
export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/**
 * Import an EC private key from a JWK for signing.
 */
export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
}

// ─── JWS sign / verify ────────────────────────────────────────────────────────

/**
 * Sign a payload object and return a JWS compact serialization string.
 *
 * Format: BASE64URL(header).BASE64URL(payload).BASE64URL(signature)
 */
export async function sign(payload: object, privateKey: CryptoKey, alg = 'ES256'): Promise<string> {
  const header: JwsHeader = { alg, typ: 'JWT' };

  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64urlEncodeBytes(sigBytes);
  return `${signingInput}.${signatureB64}`;
}

/**
 * Verify a JWS compact serialization. Returns the decoded header and payload
 * if the signature is valid, or `null` if invalid/malformed.
 */
export async function verify(
  jws: string,
  publicKey: CryptoKey,
): Promise<{ header: JwsHeader; payload: Record<string, unknown> } | null> {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  try {
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64urlDecodeBytes(signatureB64),
      new TextEncoder().encode(signingInput),
    );

    if (!valid) return null;

    const header = JSON.parse(base64urlDecodeString(headerB64)) as JwsHeader;
    const payload = JSON.parse(base64urlDecodeString(payloadB64)) as Record<string, unknown>;

    return { header, payload };
  } catch {
    return null;
  }
}

// ─── Intent / Response signing helpers ────────────────────────────────────────

/**
 * Build and sign an IntentClaims JWS.
 *
 * @param message  The A2H message to sign
 * @param turnId   The turn identifier
 * @param nonce    Unique nonce (jti) — generate with `crypto.randomUUID()`
 * @param privateKey Signing key
 */
export async function signIntent(
  message: A2HMessage,
  turnId: string,
  nonce: string,
  privateKey: CryptoKey,
): Promise<string> {
  const claims: IntentClaims = {
    sub: message.intent as A2HIntent,
    iat: Math.floor(Date.now() / 1000),
    jti: nonce,
    tid: turnId,
    intent: message,
    traceId: message.traceId,
  };
  return sign(claims, privateKey);
}

/**
 * Build and sign a ResponseClaims JWS.
 *
 * @param response     The human's response payload
 * @param intentType   The A2H intent type being responded to
 * @param nonce        Unique nonce for this response
 * @param intentNonce  The nonce of the original intent (creates a cryptographic link)
 * @param privateKey   Signing key
 */
export async function signResponse(
  response: unknown,
  intentType: A2HIntent,
  nonce: string,
  intentNonce: string | undefined,
  privateKey: CryptoKey,
): Promise<string> {
  const claims: ResponseClaims = {
    sub: intentType,
    iat: Math.floor(Date.now() / 1000),
    jti: nonce,
    response,
    intentJti: intentNonce,
  };
  return sign(claims, privateKey);
}

/**
 * Decode a JWS without verifying the signature (for inspection only).
 * Use `verify()` when signature validation is required.
 */
export function decodeUnverified(jws: string): { header: JwsHeader; payload: Record<string, unknown> } | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64urlDecodeString(parts[0])) as JwsHeader;
    const payload = JSON.parse(base64urlDecodeString(parts[1])) as Record<string, unknown>;
    return { header, payload };
  } catch {
    return null;
  }
}
