import { describe, it, expect } from 'bun:test';
import { TurnManager } from '../turn/index.js';
import { InMemoryStorageAdapter } from '../storage/in-memory.js';

function makeManager() {
  const storage = new InMemoryStorageAdapter();
  const manager = new TurnManager({ storage });
  return { storage, manager };
}

// ---------------------------------------------------------------------------
// Turn creation
// ---------------------------------------------------------------------------

describe('TurnManager — creation', () => {
  it('creates a turn with ot_turn_ prefix', async () => {
    const { manager } = makeManager();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'inbound',
      message: { text: 'Hello' },
    });

    expect(turn.id).toMatch(/^ot_turn_/);
    expect(turn.threadId).toBe('ot_thr_abc');
    expect(turn.direction).toBe('inbound');
  });

  it('stores an inbound turn with senderId', async () => {
    const { manager } = makeManager();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'inbound',
      message: { text: 'Hello' },
      senderId: 'U456',
    });

    expect(turn.direction).toBe('inbound');
    expect(turn.senderId).toBe('U456');
    expect(turn.recipientId).toBeUndefined();
  });

  it('stores an outbound turn with recipientId', async () => {
    const { manager } = makeManager();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'outbound',
      message: { text: 'Acknowledged' },
      recipientId: 'agent_007',
    });

    expect(turn.direction).toBe('outbound');
    expect(turn.recipientId).toBe('agent_007');
    expect(turn.senderId).toBeUndefined();
  });

  it('stores the raw message payload', async () => {
    const { manager } = makeManager();
    const payload = { intent: 'AUTHORIZE', context: { action: 'deploy' } };
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'outbound',
      message: payload,
    });

    expect(turn.message).toEqual(payload);
  });

  it('sets createdAt on creation', async () => {
    const { manager } = makeManager();
    const before = Date.now();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'inbound',
      message: {},
    });

    expect(turn.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(turn.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('persists the turn in storage', async () => {
    const { storage, manager } = makeManager();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'inbound',
      message: {},
    });

    const stored = await storage.getTurn(turn.id);
    expect(stored?.id).toBe(turn.id);
  });

  it('generates unique IDs for every turn', async () => {
    const { manager } = makeManager();
    const count = 100;
    const ids = await Promise.all(
      Array.from({ length: count }, () =>
        manager.createTurn({
          threadId: 'ot_thr_abc',
          direction: 'inbound',
          message: {},
        }).then((t) => t.id),
      ),
    );
    expect(new Set(ids).size).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// Turn lookups
// ---------------------------------------------------------------------------

describe('TurnManager — lookups', () => {
  it('getTurnById returns the correct turn', async () => {
    const { manager } = makeManager();
    const turn = await manager.createTurn({
      threadId: 'ot_thr_abc',
      direction: 'inbound',
      message: {},
    });

    const result = await manager.getTurnById(turn.id);
    expect(result?.id).toBe(turn.id);
  });

  it('getTurnById returns null for an unknown ID', async () => {
    const { manager } = makeManager();
    const result = await manager.getTurnById('ot_turn_nonexistent');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Listing turns (chronological order)
// ---------------------------------------------------------------------------

describe('TurnManager — listTurns', () => {
  it('returns an empty array when the thread has no turns', async () => {
    const { manager } = makeManager();
    const turns = await manager.listTurns('ot_thr_empty');
    expect(turns).toHaveLength(0);
  });

  it('returns turns in chronological order', async () => {
    const { manager } = makeManager();
    const threadId = 'ot_thr_abc';

    const t1 = await manager.createTurn({ threadId, direction: 'inbound', message: { seq: 1 } });
    // Tiny delay to ensure distinct timestamps.
    await Bun.sleep(2);
    const t2 = await manager.createTurn({ threadId, direction: 'outbound', message: { seq: 2 } });
    await Bun.sleep(2);
    const t3 = await manager.createTurn({ threadId, direction: 'inbound', message: { seq: 3 } });

    const turns = await manager.listTurns(threadId);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.id).toBe(t1.id);
    expect(turns[1]!.id).toBe(t2.id);
    expect(turns[2]!.id).toBe(t3.id);
  });

  it('only returns turns for the requested thread', async () => {
    const { manager } = makeManager();
    await manager.createTurn({ threadId: 'ot_thr_A', direction: 'inbound', message: {} });
    await manager.createTurn({ threadId: 'ot_thr_B', direction: 'inbound', message: {} });

    const turnsA = await manager.listTurns('ot_thr_A');
    expect(turnsA).toHaveLength(1);
    expect(turnsA[0]!.threadId).toBe('ot_thr_A');

    const turnsB = await manager.listTurns('ot_thr_B');
    expect(turnsB).toHaveLength(1);
    expect(turnsB[0]!.threadId).toBe('ot_thr_B');
  });

  it('logs both inbound and outbound turns', async () => {
    const { manager } = makeManager();
    const threadId = 'ot_thr_abc';
    await manager.createTurn({ threadId, direction: 'inbound', message: {} });
    await manager.createTurn({ threadId, direction: 'outbound', message: {} });

    const turns = await manager.listTurns(threadId);
    const directions = turns.map((t) => t.direction);
    expect(directions).toContain('inbound');
    expect(directions).toContain('outbound');
  });
});
