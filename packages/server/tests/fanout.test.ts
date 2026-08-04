/**
 * Unit tests for the fan-out delivery layer including retry behaviour.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Recipient } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: 'recipient-001',
    webhookUrl: 'https://example.com/webhook',
    apiKey: 'test-api-key',
    ...overrides,
  };
}

// Keep a reference to the original global fetch so we can restore it.
const originalFetch = globalThis.fetch;

function mockFetch(responses: Array<{ status: number; ok: boolean; body?: string }>) {
  let callIndex = 0;
  globalThis.fetch = mock(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return new Response(resp.body ?? '{}', { status: resp.status });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// deliverToRecipient
// ---------------------------------------------------------------------------

describe('deliverToRecipient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success:true for 2xx responses', async () => {
    mockFetch([{ status: 200, ok: true }]);

    const { deliverToRecipient } = await import('../src/lib/fanout.js');
    const result = await deliverToRecipient({
      recipient: makeRecipient(),
      payload: { message: 'test' },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it('returns success:false for 5xx responses', async () => {
    mockFetch([{ status: 503, ok: false }]);

    const { deliverToRecipient } = await import('../src/lib/fanout.js');
    const result = await deliverToRecipient({
      recipient: makeRecipient(),
      payload: { message: 'test' },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
  });

  it('includes Authorization header when apiKey is provided', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = mock(async (input, init) => {
      calls.push([input as RequestInfo | URL, init]);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { deliverToRecipient } = await import('../src/lib/fanout.js');
    await deliverToRecipient({
      recipient: makeRecipient({ apiKey: 'my-key' }),
      payload: {},
    });

    const headers = calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer my-key');
  });

  it('returns success:false and error message on network failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    const { deliverToRecipient } = await import('../src/lib/fanout.js');
    const result = await deliverToRecipient({
      recipient: makeRecipient(),
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// deliverWithRetry
// ---------------------------------------------------------------------------

describe('deliverWithRetry', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success on first attempt', async () => {
    mockFetch([{ status: 200, ok: true }]);

    const { deliverWithRetry } = await import('../src/lib/fanout.js');
    const result = await deliverWithRetry({
      recipient: makeRecipient(),
      payload: {},
      retryOptions: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(result.success).toBe(true);
    expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it('retries on 5xx and succeeds on second attempt', async () => {
    mockFetch([
      { status: 503, ok: false },
      { status: 200, ok: true },
    ]);

    const { deliverWithRetry } = await import('../src/lib/fanout.js');
    const result = await deliverWithRetry({
      recipient: makeRecipient(),
      payload: {},
      retryOptions: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(result.success).toBe(true);
    expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls.length).toBe(2);
  });

  it('does NOT retry on 4xx (non-retryable)', async () => {
    mockFetch([
      { status: 401, ok: false },
      { status: 200, ok: true }, // should never be reached
    ]);

    const { deliverWithRetry } = await import('../src/lib/fanout.js');
    const result = await deliverWithRetry({
      recipient: makeRecipient(),
      payload: {},
      retryOptions: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    // Only one call — no retries on 4xx
    expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it('returns failure after exhausting all retries', async () => {
    mockFetch([
      { status: 503, ok: false },
      { status: 503, ok: false },
      { status: 503, ok: false },
    ]);

    const { deliverWithRetry } = await import('../src/lib/fanout.js');
    const result = await deliverWithRetry({
      recipient: makeRecipient(),
      payload: {},
      retryOptions: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(result.success).toBe(false);
    expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fanOut
// ---------------------------------------------------------------------------

describe('fanOut', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('delivers to all recipients concurrently', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { fanOut } = await import('../src/lib/fanout.js');
    const recipients: Recipient[] = [
      makeRecipient({ id: 'r1', webhookUrl: 'https://r1.example.com/webhook' }),
      makeRecipient({ id: 'r2', webhookUrl: 'https://r2.example.com/webhook' }),
      makeRecipient({ id: 'r3', webhookUrl: 'https://r3.example.com/webhook' }),
    ];

    const results = await fanOut(recipients, { message: 'test' });

    expect(calls).toBe(3);
    expect(results.get('r1')?.success).toBe(true);
    expect(results.get('r2')?.success).toBe(true);
    expect(results.get('r3')?.success).toBe(true);
  });

  it('records individual failures without affecting other deliveries', async () => {
    let callCount = 0;
    globalThis.fetch = mock(async (input) => {
      callCount++;
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('r2')) {
        return new Response('{}', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { fanOut } = await import('../src/lib/fanout.js');
    const recipients: Recipient[] = [
      makeRecipient({ id: 'r1', webhookUrl: 'https://r1.example.com/webhook' }),
      makeRecipient({ id: 'r2', webhookUrl: 'https://r2.example.com/webhook' }),
    ];

    const results = await fanOut(recipients, {});

    expect(results.get('r1')?.success).toBe(true);
    expect(results.get('r2')?.success).toBe(false);
  });
});
