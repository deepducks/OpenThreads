/**
 * Token management for OpenThreads.
 *
 * Handles two credential types:
 *
 * 1. **Ephemeral tokens** (`ot_tk_*`) — short-lived, scoped to a specific
 *    thread/channel/target combination.  Included in `replyTo` URLs so that
 *    an external system can POST a reply without a permanent API key.
 *
 * 2. **Channel API keys** (`ot_ch_sk_*`) — long-lived, scoped to a channel.
 *    Used for direct sending outside a replyTo context.
 */

import type {
  StorageAdapter,
  TokenRecord,
  ChannelApiKeyRecord,
  TokenValidationResult,
  ChannelApiKeyValidationResult,
} from '../types/index.js';
import { generateTokenId, generateChannelApiKeyId } from '../utils/id.js';

/** Default ephemeral token TTL: 24 hours in milliseconds. */
export const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface TokenManagerOptions {
  storage: StorageAdapter;
  /** Override the default ephemeral token TTL (milliseconds). Default: 24h. */
  defaultTtlMs?: number;
}

export interface GenerateEphemeralTokenOptions {
  channelId: string;
  targetId: string;
  threadId: string;
  /** Per-token TTL override (milliseconds). Falls back to `defaultTtlMs`. */
  ttlMs?: number;
}

export class TokenManager {
  private readonly storage: StorageAdapter;
  readonly defaultTtlMs: number;

  constructor(options: TokenManagerOptions) {
    this.storage = options.storage;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TOKEN_TTL_MS;
  }

  // ---------------------------------------------------------------------------
  // Ephemeral tokens
  // ---------------------------------------------------------------------------

  /**
   * Generate a new ephemeral token scoped to a thread.
   *
   * The returned `id` is included in the `replyTo` URL as `?token=<id>`.
   */
  async generateEphemeralToken(options: GenerateEphemeralTokenOptions): Promise<TokenRecord> {
    const { channelId, targetId, threadId, ttlMs } = options;
    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;

    const token: TokenRecord = {
      id: generateTokenId(),
      channelId,
      targetId,
      threadId,
      expiresAt: new Date(now.getTime() + ttl),
      createdAt: now,
    };

    await this.storage.saveToken(token);
    return token;
  }

  /**
   * Validate an ephemeral token.
   *
   * Returns `{ valid: true, token }` when the token exists, is not revoked,
   * and has not expired.  Otherwise returns a discriminated union describing
   * the failure reason.
   */
  async validateToken(tokenId: string): Promise<TokenValidationResult> {
    const token = await this.storage.getToken(tokenId);

    if (!token) {
      return { valid: false, reason: 'not_found' };
    }

    if (token.revokedAt) {
      return { valid: false, reason: 'revoked', token };
    }

    if (token.expiresAt < new Date()) {
      return { valid: false, reason: 'expired', token };
    }

    return { valid: true, token };
  }

  /**
   * Revoke an ephemeral token immediately.
   *
   * After revocation the token will no longer pass `validateToken`.
   * The record is kept in storage (not deleted) so that audit logs can
   * inspect why a replyTo URL was rejected.
   *
   * @throws {Error} when the token does not exist.
   */
  async revokeToken(tokenId: string): Promise<void> {
    const token = await this.storage.getToken(tokenId);
    if (!token) {
      throw new Error(`Token not found: ${tokenId}`);
    }

    const revoked: TokenRecord = { ...token, revokedAt: new Date() };
    await this.storage.saveToken(revoked);
  }

  /**
   * Permanently delete a token record from storage.
   *
   * Prefer `revokeToken` for audit trails.  Use this only for explicit
   * cleanup (e.g., TTL-based garbage collection).
   */
  async deleteToken(tokenId: string): Promise<void> {
    await this.storage.deleteToken(tokenId);
  }

  // ---------------------------------------------------------------------------
  // Channel API keys
  // ---------------------------------------------------------------------------

  /**
   * Generate a new channel API key (`ot_ch_sk_*`) for the given channel.
   *
   * The returned `id` is passed to the channel owner and used in the
   * `Authorization: Bearer <key>` header for direct send requests.
   */
  async generateChannelApiKey(channelId: string): Promise<ChannelApiKeyRecord> {
    const key: ChannelApiKeyRecord = {
      id: generateChannelApiKeyId(),
      channelId,
      createdAt: new Date(),
    };

    await this.storage.saveChannelApiKey(key);
    return key;
  }

  /**
   * Validate a channel API key.
   *
   * When `channelId` is supplied the key must also be scoped to that channel,
   * which guards against using a key for the wrong channel in multi-tenant
   * scenarios.
   */
  async validateChannelApiKey(
    keyId: string,
    channelId?: string,
  ): Promise<ChannelApiKeyValidationResult> {
    const key = await this.storage.getChannelApiKey(keyId);

    if (!key) {
      return { valid: false, reason: 'not_found' };
    }

    if (key.revokedAt) {
      return { valid: false, reason: 'revoked', key };
    }

    if (channelId !== undefined && key.channelId !== channelId) {
      return { valid: false, reason: 'channel_mismatch', key };
    }

    return { valid: true, key };
  }

  /**
   * Revoke a channel API key immediately.
   *
   * After revocation the key will no longer pass `validateChannelApiKey`.
   *
   * @throws {Error} when the key does not exist.
   */
  async revokeChannelApiKey(keyId: string): Promise<void> {
    const key = await this.storage.getChannelApiKey(keyId);
    if (!key) {
      throw new Error(`Channel API key not found: ${keyId}`);
    }

    const revoked: ChannelApiKeyRecord = { ...key, revokedAt: new Date() };
    await this.storage.saveChannelApiKey(revoked);
  }

  /**
   * Permanently delete a channel API key record from storage.
   */
  async deleteChannelApiKey(keyId: string): Promise<void> {
    await this.storage.deleteChannelApiKey(keyId);
  }
}
