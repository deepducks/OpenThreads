import type { A2HMessage, ChannelCapabilities, CaptureMethod, ReplyMethod } from '../types/index.js';

/**
 * Select the appropriate reply method for a single A2H intent.
 *
 * Decision tree (from VISION.md — Automatic selection logic):
 *
 *   Trust layer active? → method 3 (always — required for strong auth)
 *   Simple AUTHORIZE
 *     └─ channel supports buttons? → method 1 (inline)
 *     └─ otherwise                → method 3 (external form)
 *   COLLECT with closed options (select/multiselect/checkbox)
 *     └─ channel supports select/buttons? → method 1 (inline)
 *     └─ otherwise                        → method 3 (external form)
 *   Free-text COLLECT (1 text/textarea field or no fields with a question)
 *     └─ see selectCaptureHierarchy() — returns method 2 or 3
 *   COLLECT with multiple fields → method 3 (external form)
 *   INFORM → method 1 (fire-and-forget, rendered as plain message)
 *   ESCALATE → caller should use the escalation handler; returns method 3 as fallback
 *
 * For arrays with multiple A2H intents, call selectBatchMethod() instead.
 *
 * @param item          Single A2H message to evaluate.
 * @param capabilities  Capabilities of the destination channel.
 * @param trustLayerActive  When true, always forces method 3.
 */
export function selectReplyMethod(
  item: A2HMessage,
  capabilities: ChannelCapabilities,
  trustLayerActive: boolean,
): ReplyMethod {
  // Trust layer is active — only external form supports strong authentication.
  if (trustLayerActive) {
    return 3;
  }

  switch (item.intent) {
    case 'INFORM':
      // Fire-and-forget: rendered as a plain channel message (uses Chat SDK path).
      return 1;

    case 'AUTHORIZE':
      // Simple approve/deny — uses inline buttons when the channel supports them.
      return capabilities.supportsButtons ? 1 : 3;

    case 'COLLECT':
      return selectCollectMethod(item, capabilities);

    case 'ESCALATE':
      // ESCALATE is handled by an optional escalation handler in ReplyEngine.
      // This method only determines the fallback when no handler is configured.
      return 3;

    case 'RESULT':
      // RESULT is an outbound-only intent (agent sending a result to the human).
      // Treat as a plain message.
      return 1;

    default:
      return 3;
  }
}

/**
 * Select method 4 when the message array contains multiple A2H intents.
 * Method 4 groups all intents into a single external form page.
 */
export function selectBatchMethod(): ReplyMethod {
  return 4;
}

/**
 * Determine the capture hierarchy for method 2 (text capture).
 *
 * Hierarchy (most to least explicit):
 *   1. Native thread  (Slack, Discord)
 *   2. Native reply   (Telegram in groups, WhatsApp)
 *   3. DM             (next message from sender = response)
 *   4. None           → caller should fall back to method 3
 */
export function resolveCaptureMethod(capabilities: ChannelCapabilities): CaptureMethod {
  if (capabilities.supportsNativeThreads) return 'thread';
  if (capabilities.supportsNativeReplies) return 'reply';
  if (capabilities.isDM) return 'dm';
  return 'none';
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function selectCollectMethod(item: A2HMessage, capabilities: ChannelCapabilities): ReplyMethod {
  const fields = item.collect?.fields ?? [];

  if (fields.length > 1) {
    // Multiple fields → external form (can't render a multi-field survey inline).
    return 3;
  }

  if (fields.length === 0) {
    // No fields defined: the intent carries a free-text question.
    return selectFreeTextMethod(capabilities);
  }

  const [field] = fields;
  const isClosedOption =
    field.type === 'select' ||
    field.type === 'multiselect' ||
    field.type === 'checkbox';

  if (isClosedOption) {
    // Closed options can be rendered as buttons or select menus inline.
    return capabilities.supportsSelectMenus || capabilities.supportsButtons ? 1 : 3;
  }

  // Single free-text field (text / textarea / date / number).
  return selectFreeTextMethod(capabilities);
}

function selectFreeTextMethod(capabilities: ChannelCapabilities): ReplyMethod {
  const captureMethod = resolveCaptureMethod(capabilities);
  return captureMethod === 'none' ? 3 : 2;
}
