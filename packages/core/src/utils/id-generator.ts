/**
 * ID generation utilities for OpenThreads.
 *
 * All IDs use the format: `<prefix><random-suffix>`
 * where the random suffix is 16 URL-safe alphanumeric characters derived
 * from the platform's cryptographic random source.
 *
 * Prefixes:
 *   - `ot_thr_`   → Thread IDs
 *   - `ot_turn_`  → Turn IDs
 *   - `ot_tk_`    → Ephemeral token IDs
 *   - `ot_ch_sk_` → Channel secret (API) keys
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 16;

/**
 * Generate a cryptographically random alphanumeric string of the given length.
 */
function randomSuffix(length: number = ID_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/**
 * Generate a unique Thread ID.
 * @returns A string in the format `ot_thr_<16 random alphanumeric chars>`
 */
export function generateThreadId(): string {
  return `ot_thr_${randomSuffix()}`;
}

/**
 * Generate a unique Turn ID.
 * @returns A string in the format `ot_turn_<16 random alphanumeric chars>`
 */
export function generateTurnId(): string {
  return `ot_turn_${randomSuffix()}`;
}

/**
 * Generate a unique ephemeral Token ID.
 * @returns A string in the format `ot_tk_<16 random alphanumeric chars>`
 */
export function generateTokenId(): string {
  return `ot_tk_${randomSuffix()}`;
}

/**
 * Generate a unique Channel Secret Key (API key for recipient systems).
 * @returns A string in the format `ot_ch_sk_<16 random alphanumeric chars>`
 */
export function generateChannelSecretKey(): string {
  return `ot_ch_sk_${randomSuffix()}`;
}

// ---- Prefix constants for external validation / parsing ----

export const ID_PREFIXES = {
  thread: 'ot_thr_',
  turn: 'ot_turn_',
  token: 'ot_tk_',
  channelSecretKey: 'ot_ch_sk_',
} as const;

/**
 * Check whether a string is a valid OpenThreads Thread ID.
 */
export function isThreadId(value: string): boolean {
  return value.startsWith(ID_PREFIXES.thread) && value.length > ID_PREFIXES.thread.length;
}

/**
 * Check whether a string is a valid OpenThreads Turn ID.
 */
export function isTurnId(value: string): boolean {
  return value.startsWith(ID_PREFIXES.turn) && value.length > ID_PREFIXES.turn.length;
}

/**
 * Check whether a string is a valid OpenThreads Token ID.
 */
export function isTokenId(value: string): boolean {
  return value.startsWith(ID_PREFIXES.token) && value.length > ID_PREFIXES.token.length;
}

/**
 * Check whether a string is a valid OpenThreads Channel Secret Key.
 */
export function isChannelSecretKey(value: string): boolean {
  return (
    value.startsWith(ID_PREFIXES.channelSecretKey) &&
    value.length > ID_PREFIXES.channelSecretKey.length
  );
}
