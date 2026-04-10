/**
 * Normalization utilities for the Telegram adapter.
 */

// ---------------------------------------------------------------------------
// Reply capture key
// ---------------------------------------------------------------------------

/**
 * Generates the map key used to track free-text COLLECT listeners.
 *
 * A listener registered for `collectReplyKey(chatId, collectMsgId)` will be
 * triggered when the next message that replies to `collectMsgId` arrives in
 * `chatId`.
 *
 * Format: `reply:{chatId}:{collectMsgId}`
 */
export function collectReplyKey(chatId: string, collectMsgId: string): string {
  return `reply:${chatId}:${collectMsgId}`;
}

// ---------------------------------------------------------------------------
// replyTo URL builder
// ---------------------------------------------------------------------------

/**
 * Builds the OpenThreads `replyTo` URL for a given Telegram chat and message/thread.
 *
 * Format: `{baseUrl}/send/channel/telegram/target/{chatId}/thread/{messageId}`
 */
export function buildReplyToUrl(
  baseUrl: string,
  chatId: string,
  messageId: string,
): string {
  return `${baseUrl}/send/channel/telegram/target/${chatId}/thread/${messageId}`;
}

// ---------------------------------------------------------------------------
// Display name helpers
// ---------------------------------------------------------------------------

/**
 * Derives a human-readable display name from Telegram `from` fields.
 * Falls back through first+last → username → numeric ID.
 */
export function deriveSenderName(from: {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}): string {
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return full || from.username || String(from.id);
}
