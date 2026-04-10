/**
 * Message normalization utilities for the Discord adapter.
 */

/**
 * Extracts plain text from a Discord message, stripping leading/trailing
 * whitespace. Returns empty string for non-text messages.
 */
export function extractText(content: string | null | undefined): string {
  return (content ?? '').trim();
}

/**
 * Returns true when a Discord message was sent by a bot user.
 */
export function isBot(author: { bot?: boolean } | null | undefined): boolean {
  return !!(author?.bot);
}

/**
 * Builds the OpenThreads replyTo URL for a given channel + thread.
 *
 * Format: `{baseUrl}/send/channel/discord/target/{channelId}/thread/{threadId}`
 */
export function buildReplyToUrl(
  baseUrl: string,
  channelId: string,
  threadId: string,
): string {
  return `${baseUrl}/send/channel/discord/target/${channelId}/thread/${threadId}`;
}

/**
 * Generates the cache key used to track free-text COLLECT listeners.
 */
export function collectThreadKey(channelId: string, threadId: string): string {
  return `thread:${channelId}:${threadId}`;
}
