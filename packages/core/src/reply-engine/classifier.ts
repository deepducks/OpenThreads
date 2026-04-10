import type { A2HMessage, ChatSDKMessage, MessageItem } from '../types/index.js';

/**
 * Type guard: returns true when `item` is an A2H message.
 *
 * Classification is done by duck typing per the spec:
 *   presence of `intent` field → A2H protocol message
 *   otherwise                  → Vercel Chat SDK message
 */
export function isA2HMessage(item: MessageItem): item is A2HMessage {
  return (
    typeof item === 'object' &&
    item !== null &&
    'intent' in item &&
    typeof (item as A2HMessage).intent === 'string'
  );
}

/** Inverse of isA2HMessage. */
export function isChatSDKMessage(item: MessageItem): item is ChatSDKMessage {
  return !isA2HMessage(item);
}

/** Returns a discriminated label for use in conditional logic. */
export function classifyMessage(item: MessageItem): 'a2h' | 'chatSdk' {
  return isA2HMessage(item) ? 'a2h' : 'chatSdk';
}
