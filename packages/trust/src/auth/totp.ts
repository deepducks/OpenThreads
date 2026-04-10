/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Implements RFC 6238 (TOTP) over RFC 4226 (HOTP) using the Web Crypto API.
 * No external dependencies.
 *
 * Algorithm:
 *   HOTP(K, C) = Truncate(HMAC-SHA-1(K, C))
 *   TOTP(K, T) = HOTP(K, T) where T = floor((unix_time - T0) / step)
 */

// ─── HOTP core ────────────────────────────────────────────────────────────────

/**
 * Compute an HOTP code for the given key and counter.
 *
 * @param key     Base32-encoded or raw TOTP secret
 * @param counter 8-byte counter value
 * @param digits  OTP length (default: 6)
 */
async function hotp(key: Uint8Array, counter: bigint, digits = 6): Promise<string> {
  // Encode counter as 8-byte big-endian
  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(c & 0xffn);
    c >>= 8n;
  }

  // HMAC-SHA-1
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const hmacBuffer = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
  const hmac = new Uint8Array(hmacBuffer);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (code % 10 ** digits).toString();
  return otp.padStart(digits, '0');
}

// ─── TOTP ────────────────────────────────────────────────────────────────────

export interface TotpOptions {
  /** Time step in seconds. Default: 30. */
  step?: number;
  /** Number of OTP digits. Default: 6. */
  digits?: number;
  /**
   * Acceptable window: number of steps before/after current to accept.
   * Default: 1 (accepts current step + 1 step in each direction).
   */
  window?: number;
}

/**
 * Generate the current TOTP code for a secret.
 *
 * @param secret  Raw key bytes
 * @param options TOTP options
 */
export async function generateTotp(secret: Uint8Array, options: TotpOptions = {}): Promise<string> {
  const step = options.step ?? 30;
  const digits = options.digits ?? 6;
  const counter = BigInt(Math.floor(Date.now() / 1000 / step));
  return hotp(secret, counter, digits);
}

/**
 * Verify a TOTP code against a secret.
 *
 * Accepts codes within the configured time window to account for clock skew.
 *
 * @param secret  Raw key bytes
 * @param code    The OTP string to verify
 * @param options TOTP options
 * @returns true if the code is valid within the acceptance window
 */
export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  options: TotpOptions = {},
): Promise<boolean> {
  const step = options.step ?? 30;
  const digits = options.digits ?? 6;
  const window = options.window ?? 1;
  const currentCounter = BigInt(Math.floor(Date.now() / 1000 / step));

  for (let i = -window; i <= window; i++) {
    const counter = currentCounter + BigInt(i);
    if (counter < 0n) continue;
    const expected = await hotp(secret, counter, digits);
    if (expected === code) return true;
  }
  return false;
}

/**
 * Generate a random TOTP secret.
 *
 * @param byteLength  Length of the secret in bytes. Default: 20 (160 bits, SHA-1 block size).
 */
export function generateTotpSecret(byteLength = 20): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

/**
 * Encode a secret as a Base32 string (for use in otpauth:// URIs / QR codes).
 * Implements RFC 4648 Base32.
 */
export function encodeBase32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let output = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      output += alphabet[(buffer >> (bitsLeft - 5)) & 0x1f];
      bitsLeft -= 5;
    }
  }

  if (bitsLeft > 0) {
    output += alphabet[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return output;
}

/**
 * Decode a Base32-encoded secret to raw bytes.
 */
export function decodeBase32(base32: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    buffer = (buffer << 5) | idx;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  return new Uint8Array(bytes);
}
