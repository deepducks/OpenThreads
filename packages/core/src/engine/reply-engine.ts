import type {
  MessageInput,
  A2HMessage,
  A2HResponse,
  ReplyContext,
  ReplyEngineOptions,
  ReplyEngineResult,
} from '../types/index.js';
import type { ChannelAdapter } from '../adapters/channel-adapter.js';
import { parseAndClassify } from './message-classifier.js';
import { selectMethod } from './method-selector.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FORM_BASE_URL = 'https://openthreads.host/form';

function generateFormUrl(baseUrl: string, turnId: string): string {
  return `${baseUrl}/${turnId}`;
}

/**
 * Dispatch a single A2H item to the appropriate reply method.
 * Returns a response promise for blocking intents, or null for fire-and-forget.
 */
async function dispatchA2HItem(
  message: A2HMessage,
  adapter: ChannelAdapter,
  context: ReplyContext,
  options: Required<ReplyEngineOptions>,
  a2hCount: number,
): Promise<A2HResponse | null> {
  // ESCALATE — notify and forget
  if (message.intent === 'ESCALATE') {
    await adapter.handleEscalation(message, context);
    return null;
  }

  // INFORM — fire-and-forget notification rendered as a plain message
  if (message.intent === 'INFORM') {
    const text = message.context?.details ?? message.context?.action ?? 'Notification';
    await adapter.renderChatSDK({ text: String(text) }, context);
    return null;
  }

  const capabilities = adapter.getCapabilities();
  const { method, captureMode } = selectMethod(message, capabilities, {
    trustLayerActive: options.trustLayerActive,
    a2hCount,
  });

  switch (method) {
    case 1:
      // Inline rendering — blocks until the human responds
      return adapter.renderA2HInline(message, context);

    case 2: {
      if (!captureMode) {
        // Safety: captureMode should always be set for method 2, but fall back just in case
        const formUrl = generateFormUrl(options.formBaseUrl, context.turnId);
        await adapter.sendFormLink(formUrl, message, context);
        return null;
      }
      return adapter.captureResponse(message, captureMode, context, options.responseTimeoutMs);
    }

    case 3:
    case 4: {
      // External form / batch form — send link, response arrives asynchronously
      const formUrl = generateFormUrl(options.formBaseUrl, context.turnId);
      await adapter.sendFormLink(formUrl, message, context);
      return null;
    }

    default:
      throw new Error(`Unknown reply method: ${method as number}`);
  }
}

// ---------------------------------------------------------------------------
// Reply Engine
// ---------------------------------------------------------------------------

/**
 * ReplyEngine — orchestrates the full lifecycle of a recipient inbound request.
 *
 * Responsibilities:
 *  1. Parse the `message` field and normalise it to an array.
 *  2. Classify each item (Chat SDK vs A2H) via duck typing.
 *  3. For Chat SDK items: delegate to `ChannelAdapter.renderChatSDK()`.
 *  4. For A2H items: select the reply method, dispatch to the adapter,
 *     and collect blocking responses (with timeout).
 *  5. Return all responses in the same order as the input items.
 */
export class ReplyEngine {
  private readonly options: Required<ReplyEngineOptions>;

  constructor(
    private readonly adapter: ChannelAdapter,
    options: ReplyEngineOptions = {},
  ) {
    this.options = {
      trustLayerActive: options.trustLayerActive ?? false,
      responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      formBaseUrl: options.formBaseUrl ?? DEFAULT_FORM_BASE_URL,
    };
  }

  /**
   * Process a recipient inbound request message.
   *
   * Items are processed sequentially in array order:
   * - Chat SDK messages are sent first (fire-and-forget).
   * - A2H intents are dispatched and their responses awaited immediately,
   *   preserving ordering.
   *
   * Returns a `ReplyEngineResult` with one slot per input item.
   * Slots for non-blocking items and fire-and-forget intents are null.
   */
  async process(message: MessageInput, context: ReplyContext): Promise<ReplyEngineResult> {
    const classified = parseAndClassify(message);
    const a2hCount = classified.filter((item) => item.type === 'a2h').length;

    const responses: Array<A2HResponse | null> = [];
    const errors: string[] = [];

    for (const item of classified) {
      if (item.type === 'chat-sdk') {
        try {
          await this.adapter.renderChatSDK(item.message, context);
          responses.push(null);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to render Chat SDK message: ${msg}`);
          responses.push(null);
        }
      } else {
        try {
          const response = await dispatchA2HItem(
            item.message,
            this.adapter,
            context,
            this.options,
            a2hCount,
          );
          // For method 3/4, response is null — it arrives asynchronously via form submit.
          responses.push(response);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to process A2H intent ${item.message.intent}: ${msg}`);
          responses.push(null);
        }
      }
    }

    return {
      success: errors.length === 0,
      responses,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
