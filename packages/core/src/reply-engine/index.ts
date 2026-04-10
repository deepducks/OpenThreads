/**
 * Reply Engine — public entry point.
 *
 * `processReply` is the single function that the Recipient Inbound handler
 * calls after routing. It:
 *
 *   1. Parses the `message` field (normalises object → 1-item array).
 *   2. Classifies each item (duck typing: `intent` → A2H, else Chat SDK).
 *   3. Processes Chat SDK items via `ChannelAdapter.renderChatSDK`.
 *   4. Handles fire-and-forget A2H intents (INFORM, ESCALATE).
 *   5. Selects the appropriate reply method for blocking intents using the
 *      automatic-selection decision tree from VISION.md.
 *   6. Collects responses, applying timeouts where configured.
 *   7. Returns `ReplyResult` — an array of `A2HResponse | null` that is
 *      parallel to the original `message` array.
 */

import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  FormStore,
  MessageField,
  ReplyContext,
  ReplyResult,
} from '../types/index.js';
import { parseMessage, classifyAll } from './parser.js';
import { collectSingle, collectBatch } from './collector.js';
import { executeInform, executeEscalate } from './methods.js';

export { parseMessage, classifyAll } from './parser.js';
export { selectA2HMethod, deriveCaptureMode } from './selector.js';
export type { ClassifiedItem } from './parser.js';

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Process an inbound reply from a recipient.
 *
 * @param message  The raw `message` field from the recipient's POST body.
 * @param context  Runtime context: channel, capabilities, trust layer, etc.
 * @param adapter  The channel adapter to use for rendering.
 * @param formStore  Storage / wait handle for external forms (methods 3/4).
 * @returns        A `ReplyResult` whose `responses` array is parallel to the
 *                 normalised message array.
 */
export async function processReply(
  message: MessageField,
  context: ReplyContext,
  adapter: ChannelAdapter,
  formStore: FormStore,
): Promise<ReplyResult> {
  // ── Step 1 & 2: parse + classify ────────────────────────────────────
  const items = parseMessage(message);
  const classified = classifyAll(items);

  const responses: Array<A2HResponse | null> = new Array(items.length).fill(null);

  // ── Step 3: render Chat SDK items ────────────────────────────────────
  // Chat SDK items are processed sequentially in order, fire-and-forget.
  let chatSDKCount = 0;
  let a2hCount = 0;

  for (let i = 0; i < classified.length; i++) {
    const cls = classified[i]!;
    if (cls.type === 'chat-sdk') {
      await adapter.renderChatSDK(cls.item, context);
      chatSDKCount++;
    }
  }

  // Gather A2H items together with their original indices.
  const a2hIndexed = classified
    .map((cls, idx) => (cls.type === 'a2h' ? { item: cls.item, idx } : null))
    .filter((x): x is { item: A2HMessage; idx: number } => x !== null);

  a2hCount = a2hIndexed.length;

  if (a2hCount === 0) {
    return { responses, chatSDKCount, a2hCount };
  }

  // ── Step 4: handle fire-and-forget intents ───────────────────────────
  for (const { item, idx } of a2hIndexed) {
    if (item.intent === 'INFORM' || item.intent === 'RESULT') {
      await executeInform(item, context, adapter);
      responses[idx] = null;
    } else if (item.intent === 'ESCALATE') {
      await executeEscalate(item, context, adapter);
      responses[idx] = null;
    }
  }

  // ── Step 5: collect blocking intents ────────────────────────────────
  const blockingIndexed = a2hIndexed.filter(
    ({ item }) =>
      item.intent !== 'INFORM' &&
      item.intent !== 'ESCALATE' &&
      item.intent !== 'RESULT',
  );

  if (blockingIndexed.length === 0) {
    return { responses, chatSDKCount, a2hCount };
  }

  const blockingItems = blockingIndexed.map(({ item }) => item);

  // Multiple blocking intents in one array → method 4 (batch form),
  // unless the trust layer is active (also routes to method 3/4 externally).
  if (blockingItems.length > 1) {
    const batchResponses = await collectBatch(
      blockingItems,
      context,
      adapter,
      formStore,
    );
    blockingIndexed.forEach(({ idx }, batchIdx) => {
      responses[idx] = batchResponses[batchIdx] ?? null;
    });
  } else {
    // Single blocking intent — let collectSingle apply the full decision tree.
    const { item, idx } = blockingIndexed[0]!;
    responses[idx] = await collectSingle(
      item,
      context,
      adapter,
      formStore,
      blockingItems, // length === 1
    );
  }

  return { responses, chatSDKCount, a2hCount };
}
