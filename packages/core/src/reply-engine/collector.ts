/**
 * Response collector — wraps blocking reply-method calls with a timeout and
 * returns an `A2HResponse | null` for each intent in the original array.
 *
 * Rules:
 *  - INFORM and ESCALATE intents produce `null` (no blocking response).
 *  - Blocking intents (AUTHORIZE, COLLECT) must resolve within
 *    `context.responseTimeoutMs` (default 24 h) or a `TimeoutError` is thrown.
 *  - The outer `processReply` function keeps responses parallel to the
 *    original `message` array — one slot per item.
 */

import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  FormStore,
  ReplyContext,
} from '../types/index.js';
import { TimeoutError } from '../types/index.js';
import { selectA2HMethod } from './selector.js';
import {
  executeMethod1,
  executeMethod2,
  executeMethod3,
  executeMethod4,
  executeInform,
  executeEscalate,
} from './methods.js';

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.
 * Rejects with `TimeoutError` if `timeoutMs` elapses first.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  intentType: A2HMessage['intent'],
  context: ReplyContext,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new TimeoutError(context.turnId, intentType, timeoutMs),
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Single-intent collector
// ---------------------------------------------------------------------------

/**
 * Process a single A2H item and return its response (or `null` for
 * fire-and-forget intents).
 *
 * The `allBlockingCount` parameter tells the collector how many *total*
 * blocking intents exist in this reply; when > 1, it defers to method 4.
 */
export async function collectSingle(
  message: A2HMessage,
  context: ReplyContext,
  adapter: ChannelAdapter,
  formStore: FormStore,
  allBlockingIntents: A2HMessage[],
): Promise<A2HResponse | null> {
  const timeoutMs = context.responseTimeoutMs ?? 86_400_000;

  // ── INFORM / ESCALATE — fire-and-forget ──────────────────────────────
  if (message.intent === 'INFORM' || message.intent === 'RESULT') {
    await executeInform(message, context, adapter);
    return null;
  }

  if (message.intent === 'ESCALATE') {
    await executeEscalate(message, context, adapter);
    return null;
  }

  // ── Multiple blocking intents in one reply → method 4 (batch form) ──
  if (allBlockingIntents.length > 1) {
    // This branch is only reached for the *first* item in the batch;
    // the caller (`collectAll`) handles the full batch in one shot.
    // This guard exists so that `collectSingle` is never accidentally
    // called in isolation for a batched intent.
    throw new Error(
      'collectSingle called for a batched intent — use collectAll instead.',
    );
  }

  // ── Single blocking intent ────────────────────────────────────────────
  const selection = selectA2HMethod(message, context);

  if (selection.method === 'inform-fire-forget') {
    await executeInform(message, context, adapter);
    return null;
  }

  if (selection.method === 'escalate') {
    await executeEscalate(message, context, adapter);
    return null;
  }

  switch (selection.method) {
    case 1: {
      return withTimeout(
        executeMethod1(message, context, adapter),
        timeoutMs,
        message.intent,
        context,
      );
    }

    case 2: {
      const response = await withTimeout(
        executeMethod2(message, context, adapter),
        timeoutMs,
        message.intent,
        context,
      );
      // If method 2 returns null the adapter signalled it cannot capture
      // (e.g. thread not found) — fall back to method 3.
      if (response === null) {
        const formResult = await withTimeout(
          executeMethod3([message], context, adapter, formStore),
          timeoutMs,
          message.intent,
          context,
        );
        return buildFormResponse(message, formResult);
      }
      return response;
    }

    case 3: {
      const formResult = await withTimeout(
        executeMethod3([message], context, adapter, formStore),
        timeoutMs,
        message.intent,
        context,
      );
      return buildFormResponse(message, formResult);
    }

    default:
      throw new Error(`Unexpected method: ${(selection as { method: number }).method}`);
  }
}

// ---------------------------------------------------------------------------
// Batch collector (method 4)
// ---------------------------------------------------------------------------

/**
 * Collect responses for *all* blocking intents via method 4 (batch form).
 * Returns an array of `A2HResponse` in the same order as `intents`.
 */
export async function collectBatch(
  intents: A2HMessage[],
  context: ReplyContext,
  adapter: ChannelAdapter,
  formStore: FormStore,
): Promise<A2HResponse[]> {
  const timeoutMs = context.responseTimeoutMs ?? 86_400_000;

  const formResult = await withTimeout(
    executeMethod4(intents, context, adapter, formStore),
    timeoutMs,
    // Use the first intent type as a representative label for the error
    intents[0]?.intent ?? 'COLLECT',
    context,
  );

  return intents.map((intent, idx) => {
    const key =
      intent.traceId ??
      intent.idempotencyKey ??
      `intent_${idx}`;
    const value = formResult[key] ?? formResult;
    return buildFormResponse(intent, { [key]: value });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFormResponse(
  message: A2HMessage,
  formResult: Record<string, unknown>,
): A2HResponse {
  return {
    intent: message.intent,
    response: formResult,
    respondedAt: new Date(),
  };
}
