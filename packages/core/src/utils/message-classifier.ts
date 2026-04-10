import type { OpenThreadsMessage, ChatSDKMessage, EnvelopeMessage } from '../types/message.js';
import type { A2HMessage, A2HIntent } from '../types/a2h.js';

/** All valid A2H intent strings for runtime validation. */
const A2H_INTENTS: readonly A2HIntent[] = [
  'INFORM',
  'COLLECT',
  'AUTHORIZE',
  'ESCALATE',
  'RESULT',
];

/**
 * Type guard: returns true if `message` is an A2H message.
 *
 * Duck-typing discriminator: presence of a valid `intent` field marks a message as A2H.
 * This mirrors the protocol definition in VISION.md:
 * "presence of `intent` = A2H, otherwise = Chat SDK"
 */
export function isA2HMessage(message: OpenThreadsMessage): message is A2HMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'intent' in message &&
    typeof (message as Record<string, unknown>)['intent'] === 'string' &&
    A2H_INTENTS.includes((message as Record<string, unknown>)['intent'] as A2HIntent)
  );
}

/**
 * Type guard: returns true if `message` is a Chat SDK message.
 *
 * A message is a Chat SDK message when it does NOT have a valid `intent` field.
 */
export function isChatSDKMessage(message: OpenThreadsMessage): message is ChatSDKMessage {
  return !isA2HMessage(message);
}

/**
 * Classify an `EnvelopeMessage` (single or array) into its constituent parts.
 * Returns an object with Chat SDK messages and A2H messages separated.
 */
export function classifyMessages(envelope: EnvelopeMessage): {
  chatSDK: ChatSDKMessage[];
  a2h: A2HMessage[];
} {
  const messages = Array.isArray(envelope) ? envelope : [envelope];
  const chatSDK: ChatSDKMessage[] = [];
  const a2h: A2HMessage[] = [];

  for (const message of messages) {
    if (isA2HMessage(message)) {
      a2h.push(message);
    } else {
      chatSDK.push(message as ChatSDKMessage);
    }
  }

  return { chatSDK, a2h };
}

/**
 * Normalise an `EnvelopeMessage` to an array, regardless of whether
 * a single message or an array was passed.
 */
export function normaliseToArray(envelope: EnvelopeMessage): OpenThreadsMessage[] {
  return Array.isArray(envelope) ? envelope : [envelope];
}

/**
 * Returns true when an envelope contains at least one A2H message.
 */
export function hasA2HMessages(envelope: EnvelopeMessage): boolean {
  return normaliseToArray(envelope).some(isA2HMessage);
}

/**
 * Returns true when an envelope contains at least one Chat SDK message.
 */
export function hasChatSDKMessages(envelope: EnvelopeMessage): boolean {
  return normaliseToArray(envelope).some(isChatSDKMessage);
}
