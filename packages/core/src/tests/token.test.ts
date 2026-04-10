import { describe, it, expect, beforeEach } from 'bun:test';
import { TokenManager, DEFAULT_TOKEN_TTL_MS } from '../token/index.js';
import { InMemoryStorageAdapter } from '../storage/in-memory.js';

function makeManager(defaultTtlMs?: number) {
  const storage = new InMemoryStorageAdapter();
  const manager = new TokenManager({ storage, defaultTtlMs });
  return { storage, manager };
}

// ---------------------------------------------------------------------------
// Ephemeral tokens
// ---------------------------------------------------------------------------

describe('TokenManager — ephemeral tokens', () => {
  it('generates a token with ot_tk_ prefix', async () => {
    const { manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    expect(token.id).toMatch(/^ot_tk_/);
    expect(token.channelId).toBe('ch_1');
    expect(token.targetId).toBe('tgt_1');
    expect(token.threadId).toBe('ot_thr_abc');
    expect(token.revokedAt).toBeUndefined();
  });

  it('uses the default TTL (24h) when none is specified', async () => {
    const { manager } = makeManager();
    const before = Date.now();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    const expectedExpiry = before + DEFAULT_TOKEN_TTL_MS;
    expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 50);
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 50);
  });

  it('respects a custom global TTL', async () => {
    const customTtl = 60_000; // 1 minute
    const { manager } = makeManager(customTtl);
    const before = Date.now();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + customTtl - 50);
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(before + customTtl + 50);
  });

  it('respects a per-token TTL override', async () => {
    const { manager } = makeManager();
    const perTokenTtl = 5_000; // 5 seconds
    const before = Date.now();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
      ttlMs: perTokenTtl,
    });

    expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + perTokenTtl - 50);
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(before + perTokenTtl + 50);
  });

  it('persists the token so it can be retrieved from storage', async () => {
    const { storage, manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    const stored = await storage.getToken(token.id);
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(token.id);
  });

  // --- validation ---

  it('validates a valid token', async () => {
    const { manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    const result = await manager.validateToken(token.id);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.token.id).toBe(token.id);
    }
  });

  it('returns not_found for an unknown token', async () => {
    const { manager } = makeManager();
    const result = await manager.validateToken('ot_tk_nonexistent');
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('not_found');
  });

  it('returns expired for a token past its TTL', async () => {
    const { manager } = makeManager();
    // Generate with a TTL that has already elapsed.
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
      ttlMs: -1, // immediately expired
    });

    const result = await manager.validateToken(token.id);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('expired');
  });

  it('returns revoked for a revoked token', async () => {
    const { manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    await manager.revokeToken(token.id);

    const result = await manager.validateToken(token.id);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('revoked');
  });

  // --- revocation ---

  it('revokes a token by setting revokedAt', async () => {
    const { storage, manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    await manager.revokeToken(token.id);

    const stored = await storage.getToken(token.id);
    expect(stored?.revokedAt).toBeDefined();
  });

  it('throws when revoking a non-existent token', async () => {
    const { manager } = makeManager();
    expect(manager.revokeToken('ot_tk_nonexistent')).rejects.toThrow();
  });

  it('deletes a token from storage', async () => {
    const { storage, manager } = makeManager();
    const token = await manager.generateEphemeralToken({
      channelId: 'ch_1',
      targetId: 'tgt_1',
      threadId: 'ot_thr_abc',
    });

    await manager.deleteToken(token.id);

    const stored = await storage.getToken(token.id);
    expect(stored).toBeNull();
  });

  it('generates unique IDs for every token', async () => {
    const { manager } = makeManager();
    const count = 100;
    const ids = await Promise.all(
      Array.from({ length: count }, () =>
        manager.generateEphemeralToken({
          channelId: 'ch_1',
          targetId: 'tgt_1',
          threadId: 'ot_thr_abc',
        }).then((t) => t.id),
      ),
    );
    expect(new Set(ids).size).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// Channel API keys
// ---------------------------------------------------------------------------

describe('TokenManager — channel API keys', () => {
  it('generates a key with ot_ch_sk_ prefix', async () => {
    const { manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    expect(key.id).toMatch(/^ot_ch_sk_/);
    expect(key.channelId).toBe('ch_slack');
    expect(key.revokedAt).toBeUndefined();
  });

  it('persists the key in storage', async () => {
    const { storage, manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    const stored = await storage.getChannelApiKey(key.id);
    expect(stored?.id).toBe(key.id);
    expect(stored?.channelId).toBe('ch_slack');
  });

  // --- validation ---

  it('validates a valid key without channelId constraint', async () => {
    const { manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    const result = await manager.validateChannelApiKey(key.id);
    expect(result.valid).toBe(true);
  });

  it('validates a valid key with matching channelId constraint', async () => {
    const { manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    const result = await manager.validateChannelApiKey(key.id, 'ch_slack');
    expect(result.valid).toBe(true);
  });

  it('returns channel_mismatch when key belongs to a different channel', async () => {
    const { manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    const result = await manager.validateChannelApiKey(key.id, 'ch_discord');
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('channel_mismatch');
  });

  it('returns not_found for an unknown key', async () => {
    const { manager } = makeManager();
    const result = await manager.validateChannelApiKey('ot_ch_sk_nonexistent');
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('not_found');
  });

  it('returns revoked for a revoked key', async () => {
    const { manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');
    await manager.revokeChannelApiKey(key.id);

    const result = await manager.validateChannelApiKey(key.id);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('revoked');
  });

  // --- revocation ---

  it('sets revokedAt on the key record', async () => {
    const { storage, manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    await manager.revokeChannelApiKey(key.id);

    const stored = await storage.getChannelApiKey(key.id);
    expect(stored?.revokedAt).toBeDefined();
  });

  it('throws when revoking a non-existent key', async () => {
    const { manager } = makeManager();
    expect(manager.revokeChannelApiKey('ot_ch_sk_nonexistent')).rejects.toThrow();
  });

  it('deletes a key from storage', async () => {
    const { storage, manager } = makeManager();
    const key = await manager.generateChannelApiKey('ch_slack');

    await manager.deleteChannelApiKey(key.id);

    const stored = await storage.getChannelApiKey(key.id);
    expect(stored).toBeNull();
  });

  it('generates unique IDs for every key', async () => {
    const { manager } = makeManager();
    const count = 100;
    const ids = await Promise.all(
      Array.from({ length: count }, () =>
        manager.generateChannelApiKey('ch_slack').then((k) => k.id),
      ),
    );
    expect(new Set(ids).size).toBe(count);
  });
});
