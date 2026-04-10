/**
 * Message normalization utilities for the Slack adapter.
 */

import type { GenericMessageEvent, AppMentionEvent } from '@slack/bolt';

/**
 * Extracts plain text from a Slack message or mention event.
 * Strips leading/trailing whitespace.
 */
export function extractText(
  event: GenericMessageEvent | AppMentionEvent,
): string {
  const raw = 'text' in event ? (event.text ?? '') : '';
  return raw.trim();
}

/**
 * Returns true when the event originates from a bot (not a human).
 */
export function isBot(event: GenericMessageEvent): boolean {
  return !!(event.bot_id ?? (event as { subtype?: string }).subtype === 'bot_message');
}

/**
 * Builds the OpenThreads replyTo URL for a given channel + thread.
 *
 * Format: `{baseUrl}/send/channel/slack/target/{channelId}/thread/{threadTs}`
 */
export function buildReplyToUrl(
  baseUrl: string,
  channelId: string,
  threadTs: string,
): string {
  return `${baseUrl}/send/channel/slack/target/${channelId}/thread/${threadTs}`;
}

/**
 * Generates the cache key used to track free-text COLLECT listeners.
 */
export function collectThreadKey(channelId: string, threadTs: string): string {
  return `thread:${channelId}:${threadTs}`;
}
