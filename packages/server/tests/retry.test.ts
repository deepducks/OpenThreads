/**
 * Unit tests for the exponential backoff retry utility.
 */

import { describe, it, expect, mock } from 'bun:test';
import { withRetry, computeRetryDelay } from '../src/lib/retry.js';

// ---------------------------------------------------------------------------
// computeRetryDelay
// ---------------------------------------------------------------------------

describe('computeRetryDelay', () => {
  it('returns initialDelayMs for attempt 1', () => {
    expect(computeRetryDelay(1, { initialDelayMs: 1000 })).toBe(1000);
  });

  it('doubles the delay for attempt 2 (default backoffFactor=2)', () => {
    expect(computeRetryDelay(2, { initialDelayMs: 1000 })).toBe(2000);
  });

  it('quadruples the delay for attempt 3', () => {
    expect(computeRetryDelay(3, { initialDelayMs: 1000 })).toBe(4000);
  });

  it('caps at maxDelayMs', () => {
    expect(
      computeRetryDelay(10, { initialDelayMs: 1000, maxDelayMs: 5000 }),
    ).toBe(5000);
  });

  it('uses custom backoffFactor', () => {
    // backoffFactor = 3: 1000, 3000, 9000...
    expect(computeRetryDelay(2, { initialDelayMs: 1000, backoffFactor: 3 })).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// withRetry — success paths
// ---------------------------------------------------------------------------

describe('withRetry — success paths', () => {
  it('returns the result immediately when the first attempt succeeds', async () => {
    const fn = mock(async () => 'ok');

    const result = await withRetry(fn, { maxAttempts: 3 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and returns the result when the second attempt succeeds', async () => {
    let calls = 0;
    const fn = mock(async () => {
      if (++calls < 2) throw new Error('transient');
      return 'recovered';
    });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 1,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxAttempts times', async () => {
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'final';
    });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 1,
    });

    expect(result).toBe('final');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// withRetry — failure paths
// ---------------------------------------------------------------------------

describe('withRetry — failure paths', () => {
  it('throws after maxAttempts when all attempts fail', async () => {
    const fn = mock(async () => {
      throw new Error('always fails');
    });

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 }),
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately when retryable returns false', async () => {
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      throw new Error('non-retryable');
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 1,
        retryable: () => false,
      }),
    ).rejects.toThrow('non-retryable');

    // Should have called only once — no retries
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback before each retry', async () => {
    const retryCalls: Array<{ attempt: number; delayMs: number }> = [];

    let calls = 0;
    await expect(
      withRetry(
        async () => {
          if (++calls <= 2) throw new Error('fail');
          return 'done';
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1,
          onRetry: (attempt, delayMs) => retryCalls.push({ attempt, delayMs }),
        },
      ),
    ).resolves.toBe('done');

    expect(retryCalls).toHaveLength(2);
    expect(retryCalls[0].attempt).toBe(1);
    expect(retryCalls[1].attempt).toBe(2);
  });

  it('throws the last error (not the first) when all attempts fail', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          throw new Error(`attempt ${++calls}`);
        },
        { maxAttempts: 3, initialDelayMs: 1 },
      ),
    ).rejects.toThrow('attempt 3');
  });
});

// ---------------------------------------------------------------------------
// withRetry — defaults
// ---------------------------------------------------------------------------

describe('withRetry — defaults', () => {
  it('uses maxAttempts=3 by default', async () => {
    let calls = 0;
    await expect(
      // Override initialDelayMs to 1ms so the test doesn't actually wait 3s
      withRetry(async () => { calls++; throw new Error('fail'); }, { initialDelayMs: 1 }),
    ).rejects.toThrow();

    expect(calls).toBe(3);
  });
});
