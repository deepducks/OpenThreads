import type { A2HIntentType, A2HResponse } from '../types/index.js';

/** Intents that block the Reply Engine until a human responds. */
const BLOCKING_INTENTS: ReadonlySet<A2HIntentType> = new Set(['AUTHORIZE', 'COLLECT']);

/**
 * Return true when the intent requires waiting for a human response before
 * the engine can continue.
 */
export function isBlockingIntent(intent: A2HIntentType): boolean {
  return BLOCKING_INTENTS.has(intent);
}

/**
 * Race a promise against a timeout.
 * Rejects with a descriptive error if the timeout fires first.
 */
export async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  intentType: A2HIntentType,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout: no response received for ${intentType} intent after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export interface CollectableItem {
  message: { intent: A2HIntentType };
  /** Promise to await for a response, or null for non-blocking intents. */
  responsePromise: Promise<A2HResponse> | null;
}

/**
 * Collect responses for a batch of A2H items.
 *
 * - Blocking intents (AUTHORIZE, COLLECT): awaited with timeout.
 * - Non-blocking intents (INFORM, ESCALATE, RESULT): resolved to null immediately.
 * - Items with a null responsePromise: resolved to null immediately.
 *
 * Individual failures do NOT abort the collection — the slot is set to null
 * and the error is surfaced via the returned errors array.
 */
export async function collectResponses(
  items: CollectableItem[],
  timeoutMs: number,
): Promise<{ responses: Array<A2HResponse | null>; errors: string[] }> {
  const errors: string[] = [];

  const settled = await Promise.allSettled(
    items.map(async ({ message, responsePromise }) => {
      if (responsePromise === null || !isBlockingIntent(message.intent)) {
        return null;
      }
      return awaitWithTimeout(responsePromise, timeoutMs, message.intent);
    }),
  );

  const responses = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    errors.push(
      `Response collection failed for item ${index} (${items[index].message.intent}): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
    return null;
  });

  return { responses, errors };
}
