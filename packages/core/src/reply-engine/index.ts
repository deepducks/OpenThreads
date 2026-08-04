import type {
  A2HMessage,
  A2HResponse,
  ChannelAdapter,
  ChatSDKMessage,
  EscalationHandler,
  ReplyEngineConfig,
  ReplyEngineResult,
  ReplyEnvelope,
} from '../types/index.js';
import { normalizeMessage } from './normalizer.js';
import { isA2HMessage, isChatSDKMessage } from './classifier.js';
import {
  selectReplyMethod,
  selectBatchMethod,
  resolveCaptureMethod,
} from './method-selector.js';
import {
  ResponseRegistry,
  TimeoutError,
  withTimeout,
} from './response-collector.js';

export { normalizeMessage } from './normalizer.js';
export { isA2HMessage, isChatSDKMessage, classifyMessage } from './classifier.js';
export { selectReplyMethod, selectBatchMethod, resolveCaptureMethod } from './method-selector.js';
export { ResponseRegistry, TimeoutError, withTimeout } from './response-collector.js';

/** Default timeout: 5 minutes */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_FORM_BASE_URL = 'https://openthreads.host/form';

/**
 * Reply Engine — the core component that processes the recipient inbound envelope.
 *
 * Responsibilities:
 *   1. Parse the `message` field and normalize to an array.
 *   2. Classify each item (Chat SDK vs A2H) via duck typing.
 *   3. For Chat SDK items: delegate to `ChannelAdapter.renderChatSDK()`.
 *   4. For A2H items: select the best reply method and execute it.
 *   5. Block on blocking intents (COLLECT, AUTHORIZE, ESCALATE) until a
 *      human responds, then return responses in the same order as the intents.
 *
 * ### Method selection decision tree
 *
 * ```
 * Trust layer active?          → method 3 (external form, required for strong auth)
 * AUTHORIZE                    → method 1 (inline) if buttons, else method 3
 * COLLECT closed options       → method 1 if select/buttons, else method 3
 * COLLECT free-text (1 field)  → method 2 (capture hierarchy), fallback method 3
 * COLLECT multiple fields      → method 3
 * Multiple A2H intents         → method 4 (batch form)
 * INFORM                       → fire-and-forget (plain message, no blocking)
 * ESCALATE                     → escalation handler if configured, else method 3
 * ```
 *
 * ### Form responses (methods 3 & 4)
 *
 * The Reply Engine blocks until the human submits the external form. Use
 * `replyEngine.registry.submit(formKey, response)` to deliver the human's
 * answer from the form server webhook. The form key is `${turnId}` for single
 * intents and `${turnId}_batch` for batched intents.
 *
 * @example
 * ```ts
 * const engine = new ReplyEngine(slackAdapter, { timeoutMs: 60_000 });
 *
 * // Process inbound reply from recipient system
 * const result = await engine.process(
 *   { message: [{ text: 'Done!' }, { intent: 'AUTHORIZE', context: { action: 'deploy' } }] },
 *   'ot_turn_001',
 * );
 *
 * // result.responses[0] === null  (Chat SDK message, no response needed)
 * // result.responses[1] === { intent: 'AUTHORIZE', response: true, ... }
 * ```
 */
export class ReplyEngine {
  /** Registry for pending external form responses (methods 3 & 4). */
  readonly registry: ResponseRegistry;

  private readonly config: Required<Omit<ReplyEngineConfig, 'escalationHandler'>> & {
    escalationHandler: EscalationHandler | null;
  };

  constructor(
    private readonly adapter: ChannelAdapter,
    config: ReplyEngineConfig = {},
  ) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      trustLayerActive: config.trustLayerActive ?? false,
      formBaseUrl: config.formBaseUrl ?? DEFAULT_FORM_BASE_URL,
      escalationHandler: config.escalationHandler ?? null,
    };
    this.registry = new ResponseRegistry();
  }

  /**
   * Process a recipient inbound envelope and return the collected responses.
   *
   * @param envelope  The inbound JSON body from the recipient system.
   * @param turnId    The turn identifier assigned by the Router. Used as the form key.
   */
  async process(envelope: ReplyEnvelope, turnId: string): Promise<ReplyEngineResult> {
    const items = normalizeMessage(envelope.message);

    // Partition items: Chat SDK messages and A2H intents.
    const a2hItems = items.filter(isA2HMessage);

    // When there are multiple A2H intents, batch all of them to method 4.
    if (a2hItems.length > 1) {
      return this.processMixed(items, a2hItems, turnId);
    }

    // Single A2H intent (or none): process sequentially.
    const responses: (A2HResponse | null)[] = [];
    for (const item of items) {
      if (isChatSDKMessage(item)) {
        await this.adapter.renderChatSDK(item as ChatSDKMessage);
        responses.push(null);
      } else {
        const response = await this.processA2HItem(item as A2HMessage, turnId);
        responses.push(response);
      }
    }

    return { responses };
  }

  // ---------------------------------------------------------------------------
  // Private — message processing
  // ---------------------------------------------------------------------------

  /**
   * Process a mixed array where multiple A2H intents require method 4 (batch form).
   * Chat SDK items are sent first in order, then all A2H items are batched.
   */
  private async processMixed(
    items: Array<ChatSDKMessage | A2HMessage>,
    a2hItems: A2HMessage[],
    turnId: string,
  ): Promise<ReplyEngineResult> {
    const responses: (A2HResponse | null)[] = new Array(items.length).fill(null);

    // Send Chat SDK items first (they appear in document order).
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (isChatSDKMessage(item)) {
        await this.adapter.renderChatSDK(item as ChatSDKMessage);
        // responses[i] remains null
      }
    }

    // Batch all A2H intents into method 4.
    const batchKey = `${turnId}_batch`;
    const batchFormUrl = this.generateFormUrl(batchKey);
    await this.adapter.sendFormLink(batchFormUrl, a2hItems);

    // Block until the human submits the batch form.
    const batchResponses = await this.waitForBatchResponse(batchKey, a2hItems, turnId);

    // Distribute batch responses back into the original positions.
    let batchIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (isA2HMessage(items[i])) {
        responses[i] = batchResponses[batchIdx++] ?? null;
      }
    }

    return { responses };
  }

  /** Process a single A2H item using the selected reply method. */
  private async processA2HItem(item: A2HMessage, turnId: string): Promise<A2HResponse | null> {
    // INFORM is fire-and-forget — render as plain message, no response needed.
    if (item.intent === 'INFORM') {
      const text = item.context?.details ?? item.context?.action ?? '';
      await this.adapter.renderChatSDK({ text });
      return null;
    }

    // ESCALATE has a dedicated handler path.
    if (item.intent === 'ESCALATE') {
      return this.processEscalate(item, turnId);
    }

    const method = selectReplyMethod(
      item,
      this.adapter.capabilities,
      this.config.trustLayerActive,
    );

    switch (method) {
      case 1:
        return this.withTimeout(
          this.adapter.renderA2HInline(item),
          item,
          turnId,
        );

      case 2:
        return this.processMethod2(item, turnId);

      case 3:
        return this.processMethod3(item, turnId);

      default:
        return this.processMethod3(item, turnId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — reply methods
  // ---------------------------------------------------------------------------

  /** Method 2: text capture via the channel's native affordances. */
  private async processMethod2(item: A2HMessage, turnId: string): Promise<A2HResponse> {
    const captureMethod = resolveCaptureMethod(this.adapter.capabilities);

    if (captureMethod === 'none') {
      // Channel can't capture free-text natively — fall back to method 3.
      return this.processMethod3(item, turnId);
    }

    return this.withTimeout(
      this.adapter.captureResponse(item, captureMethod),
      item,
      turnId,
    );
  }

  /**
   * Method 3: generate a temporary form URL, send the link in the channel,
   * and block until the human submits the form.
   */
  private async processMethod3(item: A2HMessage, turnId: string): Promise<A2HResponse> {
    const formUrl = this.generateFormUrl(turnId);
    await this.adapter.sendFormLink(formUrl, item);

    // Block until the form server delivers the response via registry.submit().
    const pendingPromise = this.registry.wait(turnId, item.intent);
    return this.withTimeout(pendingPromise, item, turnId);
  }

  /** ESCALATE: delegate to the configured escalation handler, or fall back to method 3. */
  private async processEscalate(item: A2HMessage, turnId: string): Promise<A2HResponse> {
    if (this.config.escalationHandler) {
      return this.withTimeout(
        this.config.escalationHandler.handle(item),
        item,
        turnId,
      );
    }
    return this.processMethod3(item, turnId);
  }

  /**
   * Wait for batch form responses (method 4).
   * Each A2H intent in the batch gets a sub-key `${batchKey}_${i}`.
   * The form server must call `registry.submit()` for each sub-key.
   */
  private async waitForBatchResponse(
    batchKey: string,
    a2hItems: A2HMessage[],
    turnId: string,
  ): Promise<A2HResponse[]> {
    const pending = a2hItems.map((item, i) => {
      const subKey = `${batchKey}_${i}`;
      const promise = this.registry.wait(subKey, item.intent);
      return this.withTimeout(promise, item, turnId);
    });
    return Promise.all(pending);
  }

  // ---------------------------------------------------------------------------
  // Private — utilities
  // ---------------------------------------------------------------------------

  private generateFormUrl(key: string): string {
    return `${this.config.formBaseUrl}/${key}`;
  }

  private withTimeout<T>(
    promise: Promise<T>,
    item: A2HMessage,
    turnId: string,
  ): Promise<T> {
    return withTimeout(promise, this.config.timeoutMs, item.intent, turnId);
  }
}
