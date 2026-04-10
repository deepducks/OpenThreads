/**
 * Inline keyboard builders for Telegram A2H intents.
 *
 * Callback data format: `a2h:{intentId}:{value}`
 *
 * Encoding the intentId in callback_data lets the callback handler resolve the
 * pending interaction without maintaining a separate message-ID→intentId map.
 * The value is the human's choice (e.g., "approve", "deny", or an option value).
 *
 * Telegram's callback_data is limited to 64 bytes. Intent IDs should be kept
 * short (UUIDs are 36 chars; `a2h:` prefix + `:` + value leaves ~20 chars for value).
 */

import type { A2HCollectOption } from '@openthreads/core';

// ---------------------------------------------------------------------------
// Inline keyboard types
// ---------------------------------------------------------------------------

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Builds an inline keyboard for AUTHORIZE intent.
 *
 * Renders as a single row with two buttons:
 *   [✅ Approve]  [❌ Deny]
 */
export function buildAuthorizeKeyboard(intentId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `a2h:${intentId}:approve` },
        { text: '❌ Deny', callback_data: `a2h:${intentId}:deny` },
      ],
    ],
  };
}

/**
 * Builds an inline keyboard for COLLECT intent with closed options.
 *
 * Options are laid out in rows of up to 2 buttons each.
 * The button text is the option label; the callback value is the option value.
 */
export function buildCollectKeyboard(
  intentId: string,
  options: A2HCollectOption[],
): InlineKeyboard {
  if (options.length === 0) {
    throw new Error('buildCollectKeyboard: options array must not be empty');
  }

  const buttons: InlineKeyboardButton[] = options.map((opt) => ({
    text: opt.label,
    callback_data: `a2h:${intentId}:${opt.value}`,
  }));

  // Group into rows of 2
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return { inline_keyboard: rows };
}

/**
 * Parses a Telegram callback_data string of the form `a2h:{intentId}:{value}`.
 * Returns null when the string is not a valid A2H callback.
 */
export function parseCallbackData(
  data: string,
): { intentId: string; value: string } | null {
  if (!data.startsWith('a2h:')) return null;

  // Split on first two colons only — value may itself contain colons
  const firstColon = data.indexOf(':', 4);
  if (firstColon === -1) return null;

  const intentId = data.slice(4, firstColon);
  const value = data.slice(firstColon + 1);

  if (!intentId) return null;

  return { intentId, value };
}
