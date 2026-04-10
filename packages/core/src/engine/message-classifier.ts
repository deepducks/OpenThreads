import type { MessageItem, ChatSDKMessage, A2HMessage, MessageInput } from '../types/index.js';

/** Discriminated union representing a classified message item. */
export type ClassifiedItem =
  | { type: 'chat-sdk'; message: ChatSDKMessage }
  | { type: 'a2h'; message: A2HMessage };

/**
 * Detect an A2H message by duck typing.
 * The presence of the `intent` field is the distinguishing marker.
 */
export function isA2HMessage(item: MessageItem): item is A2HMessage {
  return (
    typeof item === 'object' &&
    item !== null &&
    'intent' in item &&
    typeof (item as A2HMessage).intent === 'string'
  );
}

/**
 * Normalize the `message` field to an array.
 * A single object is treated as a 1-item array per the envelope spec.
 */
export function normalizeMessageInput(message: MessageInput): MessageItem[] {
  return Array.isArray(message) ? message : [message];
}

/** Classify a single message item. */
export function classifyItem(item: MessageItem): ClassifiedItem {
  if (isA2HMessage(item)) {
    return { type: 'a2h', message: item };
  }
  return { type: 'chat-sdk', message: item as ChatSDKMessage };
}

/**
 * Parse the `message` field from a recipient inbound request and classify each item.
 * Single object → normalised to 1-item array, then classified.
 */
export function parseAndClassify(message: MessageInput): ClassifiedItem[] {
  return normalizeMessageInput(message).map(classifyItem);
}
