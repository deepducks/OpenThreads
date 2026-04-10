/**
 * Unit tests for the graceful storage degradation utilities.
 */

import { describe, it, expect, mock } from 'bun:test';
import {
  withGracefulStorage,
  StorageHealthMonitor,
  getDefaultStorageMonitor,
} from '../src/lib/graceful-storage.js';

// ---------------------------------------------------------------------------
// withGracefulStorage
// ---------------------------------------------------------------------------

describe('withGracefulStorage', () => {
  it('returns the operation result when it succeeds', async () => {
    const result = await withGracefulStorage(
      async () => ({ id: 'ch_1' }),
      null,
    );
    expect(result).toEqual({ id: 'ch_1' });
  });

  it('returns the fallback when the operation throws', async () => {
    const result = await withGracefulStorage(
      async () => { throw new Error('MongoDB unavailable'); },
      null,
    );
    expect(result).toBeNull();
  });

  it('calls onError with the label and error when the operation throws', async () => {
    const errors: Array<{ label: string; error: unknown }> = [];

    await withGracefulStorage(
      async () => { throw new Error('connection refused'); },
      [],
      'channels.list',
      { onError: (label, err) => errors.push({ label, error: err }) },
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].label).toBe('channels.list');
    expect((errors[0].error as Error).message).toBe('connection refused');
  });

  it('does NOT call onError when the operation succeeds', async () => {
    const onError = mock((_l: string, _e: unknown) => {});

    await withGracefulStorage(
      async () => 'ok',
      'fallback',
      'operation',
      { onError },
    );

    expect(onError).not.toHaveBeenCalled();
  });

  it('returns fallback even when fallback is undefined', async () => {
    const result = await withGracefulStorage(
      async () => { throw new Error('err'); },
      undefined,
    );
    expect(result).toBeUndefined();
  });

  it('returns an empty array as fallback for list operations', async () => {
    const result = await withGracefulStorage<unknown[]>(
      async () => { throw new Error('err'); },
      [],
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// StorageHealthMonitor
// ---------------------------------------------------------------------------

describe('StorageHealthMonitor — basic health tracking', () => {
  it('reports healthy when no outcomes have been recorded', () => {
    const monitor = new StorageHealthMonitor();
    expect(monitor.isHealthy()).toBe(true);
  });

  it('reports healthy when all outcomes are successes', () => {
    const monitor = new StorageHealthMonitor(5, 0.5);
    for (let i = 0; i < 5; i++) monitor.recordSuccess();
    expect(monitor.isHealthy()).toBe(true);
  });

  it('reports unhealthy when failure rate exceeds threshold', () => {
    const monitor = new StorageHealthMonitor(4, 0.5);
    // 3 failures, 1 success → 75% failure rate > 50% threshold
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordSuccess();
    expect(monitor.isHealthy()).toBe(false);
  });

  it('reports healthy when failure rate is below threshold', () => {
    const monitor = new StorageHealthMonitor(4, 0.5);
    // 1 failure, 3 success → 25% failure rate < 50% threshold
    monitor.recordFailure();
    monitor.recordSuccess();
    monitor.recordSuccess();
    monitor.recordSuccess();
    expect(monitor.isHealthy()).toBe(true);
  });

  it('reset() clears all outcomes and reports healthy', () => {
    const monitor = new StorageHealthMonitor(4, 0.5);
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();
    expect(monitor.isHealthy()).toBe(false);

    monitor.reset();
    expect(monitor.isHealthy()).toBe(true);
  });

  it('sliding window: old outcomes fall off as new ones come in', () => {
    const monitor = new StorageHealthMonitor(4, 0.5);

    // Fill with failures
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();
    expect(monitor.isHealthy()).toBe(false);

    // Push successes — old failures slide out
    monitor.recordSuccess();
    monitor.recordSuccess();
    monitor.recordSuccess();
    monitor.recordSuccess();
    expect(monitor.isHealthy()).toBe(true);
  });
});

describe('StorageHealthMonitor — not enough data', () => {
  it('reports healthy when fewer outcomes than windowSize exist', () => {
    const monitor = new StorageHealthMonitor(10, 0.3);

    // Only 3 outcomes — below windowSize of 10 — should be healthy regardless
    monitor.recordFailure();
    monitor.recordFailure();
    monitor.recordFailure();

    expect(monitor.isHealthy()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDefaultStorageMonitor
// ---------------------------------------------------------------------------

describe('getDefaultStorageMonitor', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getDefaultStorageMonitor();
    const b = getDefaultStorageMonitor();
    expect(a).toBe(b);
  });

  it('instance is a StorageHealthMonitor', () => {
    expect(getDefaultStorageMonitor()).toBeInstanceOf(StorageHealthMonitor);
  });
});
