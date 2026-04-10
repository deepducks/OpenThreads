/**
 * Message parser — normalises the `message` field and classifies each item
 * via duck typing (presence of `intent` → A2H; otherwise → Chat SDK).
 */

import type {
  A2HMessage,
  ChatSDKMessage,
  MessageField,
  MessageItem,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassifiedItem =
  | { type: 'a2h'; item: A2HMessage }
  | { type: 'chat-sdk'; item: ChatSDKMessage };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Normalise the `message` field to an array.
 * A single object is wrapped in a 1-item array; an existing array is returned
 * as-is (without copying, for performance).
 */
export function parseMessage(message: MessageField): MessageItem[] {
  if (Array.isArray(message)) {
    return message;
  }
  return [message];
}

// ---------------------------------------------------------------------------
// Classification (duck typing)
// ---------------------------------------------------------------------------

/**
 * Return true when `item` is an A2H message.
 * Detection is based solely on the presence of the `intent` string field —
 * the A2H spec guarantees every intent message carries this field, while
 * Chat SDK messages never do.
 */
export function isA2HItem(item: MessageItem): item is A2HMessage {
  return (
    typeof item === 'object' &&
    item !== null &&
    'intent' in item &&
    typeof (item as Record<string, unknown>)['intent'] === 'string'
  );
}

/** Classify a single message item. */
export function classifyItem(item: MessageItem): ClassifiedItem {
  if (isA2HItem(item)) {
    return { type: 'a2h', item };
  }
  return { type: 'chat-sdk', item: item as ChatSDKMessage };
}

/** Classify every item in the parsed array. */
export function classifyAll(items: MessageItem[]): ClassifiedItem[] {
  return items.map(classifyItem);
}
