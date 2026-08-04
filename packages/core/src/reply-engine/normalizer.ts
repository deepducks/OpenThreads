import type { MessageItem, ReplyEnvelope } from '../types/index.js';

/**
 * Normalize the `message` field from the recipient inbound envelope.
 *
 * The spec allows `message` to be either a single object or an array.
 * This function always returns an array of 1 or more items so the rest of the
 * Reply Engine can iterate uniformly.
 */
export function normalizeMessage(message: ReplyEnvelope['message']): MessageItem[] {
  if (Array.isArray(message)) {
    return message;
  }
  return [message];
}
