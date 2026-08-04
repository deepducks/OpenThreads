/**
 * Fan-out: deliver an envelope to a recipient's webhook URL.
 *
 * Used by both the webhook handler (inbound channel → recipients)
 * and the send handler (recipient inbound → response delivery).
 */

import type { Recipient } from '@openthreads/core';
import { withRetry, type RetryOptions } from './retry.js';

export interface DeliverOptions {
  recipient: Recipient;
  payload: unknown;
  /** Timeout in milliseconds (default: 30s) */
  timeoutMs?: number;
}

export interface DeliverWithRetryOptions extends DeliverOptions {
  /** Retry configuration. Defaults: maxAttempts=3, initialDelayMs=1000, backoffFactor=2 */
  retryOptions?: Partial<RetryOptions>;
}

export interface DeliverResult {
  success: boolean;
  status?: number;
  error?: string;
}

/**
 * POST the envelope payload to the recipient's webhook URL.
 *
 * Uses the recipient's `apiKey` as a Bearer token if configured.
 * Returns the HTTP status from the recipient's server.
 */
export async function deliverToRecipient(options: DeliverOptions): Promise<DeliverResult> {
  const { recipient, payload, timeoutMs = 30_000 } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'OpenThreads/1.0',
  };

  if (recipient.apiKey) {
    headers['Authorization'] = `Bearer ${recipient.apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(recipient.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return { success: response.ok, status: response.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST the envelope payload to the recipient's webhook URL with automatic
 * retry on transient failures (network errors, 5xx responses).
 *
 * Uses exponential backoff — initial 1 s delay, doubling up to 30 s.
 * 4xx responses (client errors) are considered non-retryable.
 */
export async function deliverWithRetry(
  options: DeliverWithRetryOptions,
): Promise<DeliverResult> {
  const { retryOptions = {}, ...deliverOptions } = options;

  return withRetry(
    async () => {
      const result = await deliverToRecipient(deliverOptions);

      // Treat 4xx as non-retryable client errors — the caller sent bad data.
      if (!result.success && result.status !== undefined && result.status >= 400 && result.status < 500) {
        // Signal to withRetry to not retry by throwing a non-retryable sentinel.
        const err = new NonRetryableError(`Recipient returned ${result.status}`);
        (err as unknown as { result: DeliverResult }).result = result;
        throw err;
      }

      if (!result.success) {
        throw new Error(result.error ?? `Delivery failed (status ${result.status ?? 'unknown'})`);
      }

      return result;
    },
    {
      ...retryOptions,
      retryable: (err) => !(err instanceof NonRetryableError),
    },
  ).catch((err: unknown) => {
    // If the final error wraps a DeliverResult (from a 4xx), return it directly.
    if (err instanceof NonRetryableError) {
      const wrapped = (err as unknown as { result?: DeliverResult }).result;
      if (wrapped) return wrapped;
    }
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error } as DeliverResult;
  });
}

/** Sentinel error type used to stop retrying on 4xx responses. */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Fan out to multiple recipients concurrently.
 * Returns a map of recipientId → delivery result.
 */
export async function fanOut(
  recipients: Recipient[],
  payload: unknown,
): Promise<Map<string, DeliverResult>> {
  const results = await Promise.allSettled(
    recipients.map((r) => deliverToRecipient({ recipient: r, payload })),
  );

  const map = new Map<string, DeliverResult>();
  for (let i = 0; i < recipients.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      map.set(recipients[i].id, result.value);
    } else {
      map.set(recipients[i].id, {
        success: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  return map;
}
