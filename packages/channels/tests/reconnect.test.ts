/**
 * Unit tests for the generic ReconnectManager.
 */

import { describe, it, expect, mock } from 'bun:test';
import { ReconnectManager, computeReconnectDelay } from '../src/reconnect.js';

// ---------------------------------------------------------------------------
// computeReconnectDelay
// ---------------------------------------------------------------------------

describe('computeReconnectDelay', () => {
  it('returns initialDelayMs for attempt 1', () => {
    expect(computeReconnectDelay(1, { initialDelayMs: 1000 })).toBe(1000);
  });

  it('doubles for attempt 2 with default backoffFactor=2', () => {
    expect(computeReconnectDelay(2, { initialDelayMs: 1000 })).toBe(2000);
  });

  it('caps at maxDelayMs', () => {
    expect(
      computeReconnectDelay(20, { initialDelayMs: 1000, maxDelayMs: 5000 }),
    ).toBe(5000);
  });

  it('supports custom backoffFactor', () => {
    expect(
      computeReconnectDelay(3, { initialDelayMs: 100, backoffFactor: 3 }),
    ).toBe(900); // 100 * 3^2 = 900
  });
});

// ---------------------------------------------------------------------------
// ReconnectManager — connect()
// ---------------------------------------------------------------------------

describe('ReconnectManager — connect()', () => {
  it('calls connectFn and resolves on success', async () => {
    const fn = mock(async () => {});
    const manager = new ReconnectManager(fn);

    await manager.connect();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(manager.currentAttempts).toBe(0);
  });

  it('throws immediately when connectFn throws', async () => {
    const fn = mock(async () => {
      throw new Error('connect failed');
    });
    const manager = new ReconnectManager(fn);

    await expect(manager.connect()).rejects.toThrow('connect failed');
  });

  it('calls onConnected callback after successful connect()', async () => {
    const onConnected = mock(() => {});
    const manager = new ReconnectManager(async () => {}, { onConnected });

    await manager.connect();

    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ReconnectManager — scheduleReconnect()
// ---------------------------------------------------------------------------

describe('ReconnectManager — scheduleReconnect()', () => {
  it('reconnects successfully after a disconnect', async () => {
    let calls = 0;
    const onConnected = mock(() => {});
    const manager = new ReconnectManager(
      async () => { calls++; },
      { initialDelayMs: 1, onConnected },
    );

    await manager.connect();
    expect(calls).toBe(1);

    // Simulate a disconnect
    manager.scheduleReconnect(new Error('ws close'));

    // Wait for the reconnect to fire
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toBe(2);
    expect(manager.currentAttempts).toBe(0); // reset after success
  });

  it('increments attempt counter on failure', async () => {
    let shouldFail = true;
    const manager = new ReconnectManager(
      async () => {
        if (shouldFail) throw new Error('fail');
      },
      { initialDelayMs: 1, maxAttempts: 3 },
    );

    // First connection attempt — ignore failure here
    try { await manager.connect(); } catch { /* expected */ }

    manager.scheduleReconnect();
    await new Promise((r) => setTimeout(r, 5));

    // At least one attempt was made
    expect(manager.currentAttempts).toBeGreaterThan(0);

    shouldFail = false;
    manager.stop(); // stop to prevent further retries
  });

  it('calls onExhausted when maxAttempts is reached', async () => {
    const onExhausted = mock((_attempts: number) => {});
    const manager = new ReconnectManager(
      async () => { throw new Error('always fails'); },
      { maxAttempts: 2, initialDelayMs: 1, onExhausted },
    );

    // Manually schedule reconnects up to max
    manager['attempts'] = 2; // bypass initial connect
    manager.scheduleReconnect();

    // Should NOT fire a reconnect (maxAttempts already reached)
    await new Promise((r) => setTimeout(r, 10));
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0][0]).toBe(2);
  });

  it('calls onRetry before each retry attempt', async () => {
    const onRetry = mock((_attempt: number, _delay: number) => {});
    let connectCalls = 0;

    const manager = new ReconnectManager(
      async () => {
        if (++connectCalls < 3) throw new Error('fail');
      },
      { maxAttempts: 3, initialDelayMs: 1, onRetry },
    );

    // First connect
    try { await manager.connect(); } catch { /* expected */ }

    manager.scheduleReconnect();
    await new Promise((r) => setTimeout(r, 50));

    expect(onRetry.mock.calls.length).toBeGreaterThan(0);
    manager.stop();
  });
});

// ---------------------------------------------------------------------------
// ReconnectManager — stop()
// ---------------------------------------------------------------------------

describe('ReconnectManager — stop()', () => {
  it('does not reconnect after stop() is called', async () => {
    let calls = 0;
    const manager = new ReconnectManager(
      async () => { calls++; throw new Error('fail'); },
      { initialDelayMs: 1 },
    );

    // Schedule a reconnect then immediately stop
    manager.scheduleReconnect();
    manager.stop();

    // Give enough time for a reconnect to have fired if stop() didn't work
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toBe(0);
    expect(manager.isStopped).toBe(true);
  });

  it('calling stop() multiple times is safe', () => {
    const manager = new ReconnectManager(async () => {});
    expect(() => {
      manager.stop();
      manager.stop();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReconnectManager — isStopped / currentAttempts
// ---------------------------------------------------------------------------

describe('ReconnectManager — state accessors', () => {
  it('isStopped starts as false', () => {
    const manager = new ReconnectManager(async () => {});
    expect(manager.isStopped).toBe(false);
  });

  it('isStopped is true after stop()', () => {
    const manager = new ReconnectManager(async () => {});
    manager.stop();
    expect(manager.isStopped).toBe(true);
  });

  it('currentAttempts starts at 0', () => {
    const manager = new ReconnectManager(async () => {});
    expect(manager.currentAttempts).toBe(0);
  });

  it('resetAttempts sets currentAttempts to 0', () => {
    const manager = new ReconnectManager(async () => { throw new Error('x'); });
    manager['attempts'] = 3;
    manager.resetAttempts();
    expect(manager.currentAttempts).toBe(0);
  });
});
