import { describe, it, expect } from 'bun:test';
import { ThreadManager } from '../thread/index.js';
import { InMemoryStorageAdapter } from '../storage/in-memory.js';

function makeManager() {
  const storage = new InMemoryStorageAdapter();
  const manager = new ThreadManager({ storage });
  return { storage, manager };
}

// ---------------------------------------------------------------------------
// Native threads
// ---------------------------------------------------------------------------

describe('ThreadManager — native threads', () => {
  it('creates a thread with ot_thr_ prefix', async () => {
    const { manager } = makeManager();
    const thread = await manager.createThread({ channelId: 'ch_slack' });

    expect(thread.id).toMatch(/^ot_thr_/);
    expect(thread.channelId).toBe('ch_slack');
    expect(thread.kind).toBe('native');
  });

  it('stores channelId and optional targetId', async () => {
    const { manager } = makeManager();
    const thread = await manager.createThread({
      channelId: 'ch_slack',
      targetId: 'C0123',
    });

    expect(thread.channelId).toBe('ch_slack');
    expect(thread.targetId).toBe('C0123');
  });

  it('stores the nativeThreadId when provided', async () => {
    const { manager } = makeManager();
    const thread = await manager.createThread({
      channelId: 'ch_slack',
      nativeThreadId: 'slack-ts-1234',
    });

    expect(thread.nativeThreadId).toBe('slack-ts-1234');
  });

  it('returns existing thread instead of creating a duplicate for the same nativeThreadId', async () => {
    const { manager } = makeManager();
    const first = await manager.createThread({
      channelId: 'ch_slack',
      nativeThreadId: 'slack-ts-1234',
    });
    const second = await manager.createThread({
      channelId: 'ch_slack',
      nativeThreadId: 'slack-ts-1234',
    });

    expect(second.id).toBe(first.id);
  });

  it('creates separate threads for different nativeThreadIds', async () => {
    const { manager } = makeManager();
    const a = await manager.createThread({ channelId: 'ch_slack', nativeThreadId: 'ts-1' });
    const b = await manager.createThread({ channelId: 'ch_slack', nativeThreadId: 'ts-2' });

    expect(a.id).not.toBe(b.id);
  });

  it('persists the thread in storage', async () => {
    const { storage, manager } = makeManager();
    const thread = await manager.createThread({ channelId: 'ch_slack' });

    const stored = await storage.getThread(thread.id);
    expect(stored?.id).toBe(thread.id);
  });
});

// ---------------------------------------------------------------------------
// Virtual threads
// ---------------------------------------------------------------------------

describe('ThreadManager — virtual threads', () => {
  it('creates a virtual thread with the given reply chain', async () => {
    const { manager } = makeManager();
    const thread = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root', 'msg-reply-1'],
    });

    expect(thread.id).toMatch(/^ot_thr_/);
    expect(thread.kind).toBe('virtual');
    expect(thread.replyChain).toEqual(['msg-root', 'msg-reply-1']);
  });

  it('returns the existing thread when the root message ID matches', async () => {
    const { manager } = makeManager();
    const first = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root'],
    });
    const second = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root', 'msg-reply-1'],
    });

    expect(second.id).toBe(first.id);
  });

  it('merges new message IDs into an existing virtual thread chain', async () => {
    const { manager } = makeManager();
    await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root'],
    });
    const updated = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root', 'msg-reply-1', 'msg-reply-2'],
    });

    expect(updated.replyChain).toContain('msg-root');
    expect(updated.replyChain).toContain('msg-reply-1');
    expect(updated.replyChain).toContain('msg-reply-2');
  });

  it('does not duplicate message IDs in the chain', async () => {
    const { manager } = makeManager();
    await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root', 'msg-reply-1'],
    });
    const result = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root', 'msg-reply-1'], // same chain
    });

    const occurrences = result.replyChain!.filter((id) => id === 'msg-root').length;
    expect(occurrences).toBe(1);
  });

  it('creates separate threads for different root messages', async () => {
    const { manager } = makeManager();
    const a = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root-A'],
    });
    const b = await manager.detectOrCreateVirtualThread({
      channelId: 'ch_telegram',
      targetId: 'group_42',
      replyChain: ['msg-root-B'],
    });

    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Main thread
// ---------------------------------------------------------------------------

describe('ThreadManager — main thread', () => {
  it('creates a main thread with kind=main', async () => {
    const { manager } = makeManager();
    const thread = await manager.getOrCreateMainThread('ch_slack', 'C0123');

    expect(thread.id).toMatch(/^ot_thr_/);
    expect(thread.kind).toBe('main');
    expect(thread.channelId).toBe('ch_slack');
    expect(thread.targetId).toBe('C0123');
  });

  it('returns the same thread on subsequent calls', async () => {
    const { manager } = makeManager();
    const first = await manager.getOrCreateMainThread('ch_slack', 'C0123');
    const second = await manager.getOrCreateMainThread('ch_slack', 'C0123');

    expect(second.id).toBe(first.id);
  });

  it('creates separate main threads for different targets', async () => {
    const { manager } = makeManager();
    const a = await manager.getOrCreateMainThread('ch_slack', 'C0123');
    const b = await manager.getOrCreateMainThread('ch_slack', 'C0456');

    expect(a.id).not.toBe(b.id);
  });

  it('creates separate main threads for different channels', async () => {
    const { manager } = makeManager();
    const a = await manager.getOrCreateMainThread('ch_slack', 'C0123');
    const b = await manager.getOrCreateMainThread('ch_discord', 'C0123');

    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe('ThreadManager — lookups', () => {
  it('getThreadById returns the correct thread', async () => {
    const { manager } = makeManager();
    const thread = await manager.createThread({ channelId: 'ch_slack' });

    const result = await manager.getThreadById(thread.id);
    expect(result?.id).toBe(thread.id);
  });

  it('getThreadById returns null for unknown ID', async () => {
    const { manager } = makeManager();
    const result = await manager.getThreadById('ot_thr_nonexistent');
    expect(result).toBeNull();
  });

  it('getThreadByNativeId finds a native thread', async () => {
    const { manager } = makeManager();
    const thread = await manager.createThread({
      channelId: 'ch_slack',
      nativeThreadId: 'slack-ts-9999',
    });

    const result = await manager.getThreadByNativeId('ch_slack', 'slack-ts-9999');
    expect(result?.id).toBe(thread.id);
  });

  it('getThreadByNativeId returns null when not found', async () => {
    const { manager } = makeManager();
    const result = await manager.getThreadByNativeId('ch_slack', 'nonexistent');
    expect(result).toBeNull();
  });

  it('getThreadsByChannelAndTarget returns all matching threads', async () => {
    const { manager } = makeManager();
    const native = await manager.createThread({ channelId: 'ch_slack', targetId: 'C0123' });
    const main = await manager.getOrCreateMainThread('ch_slack', 'C0123');

    const results = await manager.getThreadsByChannelAndTarget('ch_slack', 'C0123');
    const ids = results.map((t) => t.id);
    expect(ids).toContain(native.id);
    expect(ids).toContain(main.id);
  });

  it('getThreadsByChannelAndTarget returns empty array when no match', async () => {
    const { manager } = makeManager();
    const results = await manager.getThreadsByChannelAndTarget('ch_slack', 'no-such-target');
    expect(results).toHaveLength(0);
  });
});
