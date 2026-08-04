/**
 * Unit tests for the message deduplication store and helpers.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  InMemoryDeduplicationStore,
  slackEventKey,
  telegramUpdateKey,
  whatsappMessageKey,
  genericMessageKey,
  getDefaultDeduplicationStore,
} from '../src/lib/deduplication.js';

// ---------------------------------------------------------------------------
// InMemoryDeduplicationStore — basic operations
// ---------------------------------------------------------------------------

describe('InMemoryDeduplicationStore — check / seen', () => {
  let store: InMemoryDeduplicationStore;

  beforeEach(() => {
    store = new InMemoryDeduplicationStore();
  });

  it('check returns false for unseen keys', () => {
    expect(store.check('key_001')).toBe(false);
  });

  it('check returns true after seen() is called', () => {
    store.seen('key_001');
    expect(store.check('key_001')).toBe(true);
  });

  it('check returns false for a different key', () => {
    store.seen('key_001');
    expect(store.check('key_002')).toBe(false);
  });

  it('check returns false for an expired key', async () => {
    store.seen('key_ttl', 1); // 1ms TTL — expires almost immediately
    await new Promise((r) => setTimeout(r, 10));
    expect(store.check('key_ttl')).toBe(false);
  });

  it('seen() with the same key is idempotent', () => {
    store.seen('key_dup');
    store.seen('key_dup');
    expect(store.check('key_dup')).toBe(true);
    expect(store.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// InMemoryDeduplicationStore — LRU eviction
// ---------------------------------------------------------------------------

describe('InMemoryDeduplicationStore — LRU eviction', () => {
  it('evicts the oldest key when maxSize is reached', () => {
    const small = new InMemoryDeduplicationStore(3);

    small.seen('k1');
    small.seen('k2');
    small.seen('k3');
    expect(small.size).toBe(3);

    // Adding a 4th key should evict k1
    small.seen('k4');
    expect(small.size).toBe(3);
    expect(small.check('k1')).toBe(false); // evicted
    expect(small.check('k2')).toBe(true);
    expect(small.check('k3')).toBe(true);
    expect(small.check('k4')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InMemoryDeduplicationStore — purgeExpired
// ---------------------------------------------------------------------------

describe('InMemoryDeduplicationStore — purgeExpired', () => {
  it('removes expired entries and returns the count', async () => {
    const store = new InMemoryDeduplicationStore();

    store.seen('valid', 60_000);   // 60s — will not expire
    store.seen('expired_a', 1);    // 1ms — will expire
    store.seen('expired_b', 1);    // 1ms — will expire

    await new Promise((r) => setTimeout(r, 10));

    const purged = store.purgeExpired();
    expect(purged).toBe(2);
    expect(store.size).toBe(1);
    expect(store.check('valid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

describe('Key builders', () => {
  it('slackEventKey produces a namespaced key', () => {
    expect(slackEventKey('Ev01234ABCDE')).toBe('slack:Ev01234ABCDE');
  });

  it('telegramUpdateKey produces a namespaced key', () => {
    expect(telegramUpdateKey('bot_123456789', 42)).toBe('telegram:bot_123456789:42');
  });

  it('whatsappMessageKey produces a namespaced key', () => {
    const key = whatsappMessageKey('15551234567@s.whatsapp.net', 'msg_abc123');
    expect(key).toBe('whatsapp:15551234567@s.whatsapp.net:msg_abc123');
  });

  it('genericMessageKey produces a namespaced key', () => {
    expect(genericMessageKey('my-channel', 'native_msg_001')).toBe('msg:my-channel:native_msg_001');
  });
});

// ---------------------------------------------------------------------------
// Deduplication flow simulation
// ---------------------------------------------------------------------------

describe('Deduplication flow', () => {
  it('correctly deduplicates a Slack event delivered twice', () => {
    const store = new InMemoryDeduplicationStore();
    const key = slackEventKey('Ev01234ABCDE');

    // First delivery
    const firstTime = store.check(key);
    store.seen(key);

    // Second delivery (Slack retry)
    const secondTime = store.check(key);

    expect(firstTime).toBe(false); // not a duplicate
    expect(secondTime).toBe(true); // duplicate — skip processing
  });

  it('correctly deduplicates a Telegram update delivered twice', () => {
    const store = new InMemoryDeduplicationStore();
    const key = telegramUpdateKey('bot_987', 100);

    expect(store.check(key)).toBe(false);
    store.seen(key);
    expect(store.check(key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------

describe('getDefaultDeduplicationStore', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getDefaultDeduplicationStore();
    const b = getDefaultDeduplicationStore();
    expect(a).toBe(b);
  });

  it('instance is an InMemoryDeduplicationStore', () => {
    expect(getDefaultDeduplicationStore()).toBeInstanceOf(InMemoryDeduplicationStore);
  });
});
