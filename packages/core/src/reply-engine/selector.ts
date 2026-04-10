/**
 * A2H method selector — implements the automatic-selection decision tree
 * described in VISION.md §4 "Reply Methods / Automatic selection logic".
 *
 *   Trust layer active?          → method 3 (external form, always)
 *   Multiple blocking intents?   → method 4 (batch form)
 *   Simple AUTHORIZE             → method 1 (inline) if buttons, else method 3
 *   COLLECT – closed options     → method 1 if selects/buttons, else method 3
 *   COLLECT – free-text 1 field  → method 2 (capture hierarchy), else method 3
 *   COLLECT – multiple fields    → method 3
 *   INFORM                       → fire-and-forget (no blocking)
 *   ESCALATE                     → escalation handler
 */

import type {
  A2HMessage,
  CaptureMode,
  ChannelCapabilities,
  MethodSelection,
  ReplyContext,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A "simple" AUTHORIZE is one that only needs an approve/deny answer —
 * i.e. no additional schema fields beyond the default pair.
 */
function isSimpleAuthorize(message: A2HMessage): boolean {
  const { schema } = message;
  return !schema || schema.fields.length === 0;
}

/**
 * Return true when all answers are chosen from a closed set — either via
 * top-level `options` or when every schema field is a select/boolean type.
 */
function hasClosedOptions(message: A2HMessage): boolean {
  const { options, schema } = message;

  if (options && options.length > 0) {
    return true;
  }

  if (schema && schema.fields.length > 0) {
    return schema.fields.every(
      (f) =>
        f.type === 'select' ||
        f.type === 'multiselect' ||
        f.type === 'boolean',
    );
  }

  return false;
}

/** Count how many schema fields the COLLECT intent exposes (default: 1). */
function getFieldCount(message: A2HMessage): number {
  if (message.schema && message.schema.fields.length > 0) {
    return message.schema.fields.length;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the reply method for a *single* A2H intent.
 *
 * Note: the caller is responsible for applying the "multiple blocking intents
 * → method 4" rule *before* calling this function (see `processReply`).
 */
export function selectA2HMethod(
  message: A2HMessage,
  context: ReplyContext,
): MethodSelection {
  const { capabilities, isDM, trustLayerActive } = context;

  // ── Trust layer ────────────────────────────────────────────────────────
  // When active, method 3 is mandatory: WebAuthn / OTP require a proper
  // web surface; they cannot be delivered inline inside a chat message.
  if (trustLayerActive) {
    return { method: 3 };
  }

  // ── Intent-specific rules ──────────────────────────────────────────────
  switch (message.intent) {
    // INFORM is fire-and-forget — no blocking, no response collection.
    case 'INFORM':
      return { method: 'inform-fire-forget' };

    // ESCALATE hands off to a human operator; no structured response needed.
    case 'ESCALATE':
      return { method: 'escalate' };

    case 'AUTHORIZE': {
      if (isSimpleAuthorize(message) && capabilities.supportsButtons) {
        return { method: 1 }; // inline approve/deny buttons
      }
      return { method: 3 }; // complex or no-button channel → external form
    }

    case 'COLLECT': {
      // ── Closed options (select / button choices) ──────────────────────
      if (hasClosedOptions(message)) {
        if (
          capabilities.supportsSelectMenus ||
          capabilities.supportsButtons
        ) {
          return { method: 1 };
        }
        return { method: 3 };
      }

      // ── Multiple fields ───────────────────────────────────────────────
      if (getFieldCount(message) > 1) {
        return { method: 3 };
      }

      // ── Free-text, single field — capture hierarchy ───────────────────
      // 1. Native thread  →  method 2 (thread capture)
      if (capabilities.hasNativeThreads) {
        return { method: 2 };
      }
      // 2. Native reply message  →  method 2 (reply capture)
      if (capabilities.hasReplyMessages) {
        return { method: 2 };
      }
      // 3. DM / private chat  →  method 2 (implicit context)
      if (isDM) {
        return { method: 2 };
      }
      // 4. Fallback  →  external form
      return { method: 3 };
    }

    // RESULT is a response intent coming back from a human — treat as
    // informational when it appears in an outbound message array.
    case 'RESULT':
      return { method: 'inform-fire-forget' };

    default:
      return { method: 3 };
  }
}

/**
 * Derive the capture mode for method 2, matching the same hierarchy used
 * in `selectA2HMethod`.
 */
export function deriveCaptureMode(context: ReplyContext): CaptureMode {
  const { capabilities, isDM } = context;
  if (capabilities.hasNativeThreads) return 'thread';
  if (capabilities.hasReplyMessages) return 'reply';
  if (isDM) return 'dm';
  // Should not be reached if selectA2HMethod correctly fell back to method 3
  // for non-DM channels without thread/reply support.
  return 'dm';
}
