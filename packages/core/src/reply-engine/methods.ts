/**
 * Reply-method implementations (1–4) plus INFORM/ESCALATE handlers.
 *
 * Each function accepts the resolved adapter and form-store, which are
 * provided by the caller (Reply Engine). This keeps the method functions
 * pure and easily testable with mock adapters.
 */

import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  FormStore,
  ReplyContext,
  TurnId,
} from '../types/index.js';
import { deriveCaptureMode } from './selector.js';

// ---------------------------------------------------------------------------
// Method 1 — Inline in channel (buttons / select menus)
// ---------------------------------------------------------------------------

/**
 * Render the A2H intent using native channel primitives (buttons, inline
 * keyboard, select menus) and block until the human responds.
 */
export async function executeMethod1(
  message: A2HMessage,
  context: ReplyContext,
  adapter: ChannelAdapter,
): Promise<A2HResponse> {
  return adapter.renderA2HInline(message, context);
}

// ---------------------------------------------------------------------------
// Method 2 — Text capture (thread / reply / DM)
// ---------------------------------------------------------------------------

/**
 * Post the question in the channel and capture the textual reply using the
 * capture mode derived from the channel's capabilities.
 *
 * Returns `null` if the adapter signals that capture is not possible
 * (e.g. the expected thread disappeared); the caller should fall back to
 * method 3 in that case.
 */
export async function executeMethod2(
  message: A2HMessage,
  context: ReplyContext,
  adapter: ChannelAdapter,
): Promise<A2HResponse | null> {
  const mode = deriveCaptureMode(context);
  return adapter.captureResponse(message, mode, context);
}

// ---------------------------------------------------------------------------
// Method 3 — External form (temporary link)
// ---------------------------------------------------------------------------

/**
 * Generate a temporary form URL, post the link in the channel, and block
 * until the form is submitted.
 *
 * `intents` is usually a 1-item array; method 4 passes multiple items.
 */
export async function executeMethod3(
  intents: A2HMessage[],
  context: ReplyContext,
  adapter: ChannelAdapter,
  formStore: FormStore,
): Promise<Record<string, unknown>> {
  const turnId: TurnId = context.turnId ?? `ot_turn_${Date.now()}`;
  const timeoutMs = context.responseTimeoutMs ?? 86_400_000; // 24 h

  const formUrl = await formStore.createForm(turnId, intents);
  await adapter.sendFormLink(formUrl, intents, context);
  return formStore.waitForSubmit(formUrl, timeoutMs);
}

// ---------------------------------------------------------------------------
// Method 4 — Batch form (multiple A2H intents on one page)
// ---------------------------------------------------------------------------

/**
 * Group all blocking A2H intents into a single external-form page.
 * This is an OpenThreads extension over the A2H spec; from the recipient's
 * perspective, it still receives an array of responses in intent order.
 *
 * Internally, this is identical to method 3 with multiple intents.
 */
export async function executeMethod4(
  intents: A2HMessage[],
  context: ReplyContext,
  adapter: ChannelAdapter,
  formStore: FormStore,
): Promise<Record<string, unknown>> {
  return executeMethod3(intents, context, adapter, formStore);
}

// ---------------------------------------------------------------------------
// INFORM — fire-and-forget
// ---------------------------------------------------------------------------

/**
 * Deliver an INFORM intent as a plain message and return immediately.
 * No response is collected; the intent is non-blocking.
 */
export async function executeInform(
  message: A2HMessage,
  context: ReplyContext,
  adapter: ChannelAdapter,
): Promise<void> {
  const text = extractInformText(message);
  await adapter.sendMessage(text, context);
}

function extractInformText(message: A2HMessage): string {
  const ctx = message.context ?? {};

  if (typeof ctx['message'] === 'string') return ctx['message'];
  if (typeof ctx['details'] === 'string') return ctx['details'];
  if (typeof ctx['action'] === 'string') return ctx['action'];

  const ctxStr = JSON.stringify(ctx);
  return ctxStr !== '{}' ? ctxStr : `[INFORM: ${message.intent}]`;
}

// ---------------------------------------------------------------------------
// ESCALATE handler
// ---------------------------------------------------------------------------

/**
 * Hand the ESCALATE intent off to the channel adapter.
 * The adapter is responsible for routing to a human operator
 * (paging, creating a ticket, opening a live-chat session, etc.).
 */
export async function executeEscalate(
  message: A2HMessage,
  context: ReplyContext,
  adapter: ChannelAdapter,
): Promise<void> {
  await adapter.handleEscalation(message, context);
}
