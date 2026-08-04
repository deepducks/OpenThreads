/**
 * ID generation utilities for OpenThreads entity identifiers.
 *
 * All IDs follow the pattern: `<prefix>_<random-hex>` where the random
 * portion is 16 hexadecimal characters (8 bytes of cryptographic randomness).
 */

/** Generate 16 hex characters of cryptographic randomness. */
function randomHex(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate an ephemeral token ID: `ot_tk_<hex>` */
export function generateTokenId(): string {
  return `ot_tk_${randomHex()}`;
}

/** Generate a channel API key ID: `ot_ch_sk_<hex>` */
export function generateChannelApiKeyId(): string {
  return `ot_ch_sk_${randomHex()}`;
}

/** Generate a thread ID: `ot_thr_<hex>` */
export function generateThreadId(): string {
  return `ot_thr_${randomHex()}`;
}

/** Generate a turn ID: `ot_turn_<hex>` */
export function generateTurnId(): string {
  return `ot_turn_${randomHex()}`;
}
