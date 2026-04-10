import type {
  A2HMessage,
  A2HIntentType,
  ReplyMethod,
  ChannelCapabilities,
  CollectField,
} from '../types/index.js';

/** Text-capture mode used by method 2. */
export type CaptureMode = 'thread' | 'reply' | 'dm';

export interface MethodSelectionResult {
  method: ReplyMethod;
  /** Populated only when method === 2. */
  captureMode?: CaptureMode;
}

// ---------------------------------------------------------------------------
// Field classification helpers
// ---------------------------------------------------------------------------

const CLOSED_FIELD_TYPES: CollectField['type'][] = ['select', 'multiselect', 'checkbox'];

/**
 * A COLLECT is "closed" when every field has predefined options
 * (select, multiselect, checkbox).
 */
export function isClosedCollect(message: A2HMessage): boolean {
  const fields = message.fields;
  if (!fields || fields.length === 0) return false;
  return fields.every((f) => CLOSED_FIELD_TYPES.includes(f.type));
}

/**
 * A COLLECT is a free-text single-field collect when it has exactly one
 * open-input field (text, number, date).
 */
export function isFreeTextSingleFieldCollect(message: A2HMessage): boolean {
  const fields = message.fields;
  if (!fields || fields.length !== 1) return false;
  return !CLOSED_FIELD_TYPES.includes(fields[0].type);
}

// ---------------------------------------------------------------------------
// Capture mode determination (method 2 hierarchy)
// ---------------------------------------------------------------------------

/**
 * Walk the capture hierarchy to find the best method-2 capture mode.
 * Returns undefined when no capture mode is available (must fall back to method 3).
 *
 * Hierarchy (VISION.md):
 *   1. Native thread
 *   2. Native reply message
 *   3. DM implicit context
 */
export function determineCaptureMode(
  capabilities: ChannelCapabilities,
): CaptureMode | undefined {
  if (capabilities.supportsNativeThreads) return 'thread';
  if (capabilities.supportsReplyMessages) return 'reply';
  if (capabilities.isDM) return 'dm';
  return undefined;
}

// ---------------------------------------------------------------------------
// Main selection logic
// ---------------------------------------------------------------------------

export interface MethodSelectorOptions {
  /** When true, always use method 3 (required for strong auth). */
  trustLayerActive?: boolean;
  /** Total number of A2H intents in the message array. */
  a2hCount?: number;
}

/**
 * Select the reply method for a single A2H intent.
 *
 * Implements the automatic selection decision tree from VISION.md:
 *
 * ```
 * Trust layer active?              → method 3
 * Multiple A2H intents?            → method 4
 * INFORM                           → method 1 (fire-and-forget display)
 * AUTHORIZE
 *   channel supports buttons?      → method 1
 *   otherwise                      → method 3
 * COLLECT closed options
 *   channel supports buttons/sel?  → method 1
 *   otherwise                      → method 3
 * COLLECT free-text (1 field)
 *   capture mode available?        → method 2 (thread/reply/dm)
 *   otherwise                      → method 3
 * COLLECT multiple fields          → method 3
 * ESCALATE / RESULT                → method 3
 * ```
 */
export function selectMethod(
  message: A2HMessage,
  capabilities: ChannelCapabilities,
  options: MethodSelectorOptions = {},
): MethodSelectionResult {
  const { trustLayerActive = false, a2hCount = 1 } = options;
  const intent: A2HIntentType = message.intent;

  // Trust layer always forces the external form (needs WebAuthn/OTP surface)
  if (trustLayerActive) {
    return { method: 3 };
  }

  // Multiple A2H intents → batch everything into a single form page (method 4)
  if (a2hCount > 1) {
    return { method: 4 };
  }

  switch (intent) {
    case 'INFORM':
      // Fire-and-forget — render inline as a simple notification
      return { method: 1 };

    case 'AUTHORIZE':
      return capabilities.supportsButtons ? { method: 1 } : { method: 3 };

    case 'COLLECT': {
      const fields = message.fields ?? [];

      if (fields.length > 1) {
        // Multiple fields always need the external form
        return { method: 3 };
      }

      if (fields.length === 0 || isClosedCollect(message)) {
        // Closed options (or unspecified): use inline if the channel can render them
        if (capabilities.supportsButtons || capabilities.supportsSelectMenus) {
          return { method: 1 };
        }
        return { method: 3 };
      }

      // Single free-text field: try method 2 capture hierarchy
      if (isFreeTextSingleFieldCollect(message)) {
        const captureMode = determineCaptureMode(capabilities);
        if (captureMode !== undefined) {
          return { method: 2, captureMode };
        }
        return { method: 3 };
      }

      return { method: 3 };
    }

    case 'ESCALATE':
    case 'RESULT':
      return { method: 3 };

    default:
      return { method: 3 };
  }
}
