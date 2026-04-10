import type {
  A2HItem,
  A2HAuthorize,
  A2HCollect,
  A2HInform,
  MessageItem,
  TextMessage,
} from "./types.js";

/** Type guard: is this a MessageItem an A2H intent? */
export function isA2HItem(item: MessageItem): item is A2HItem {
  return typeof item === "object" && item !== null && "intent" in item;
}

/** Type guard: is this an A2H AUTHORIZE intent? */
export function isAuthorize(item: A2HItem): item is A2HAuthorize {
  return item.intent === "AUTHORIZE";
}

/** Type guard: is this an A2H COLLECT intent? */
export function isCollect(item: A2HItem): item is A2HCollect {
  return item.intent === "COLLECT";
}

/** Type guard: is this an A2H INFORM intent? */
export function isInform(item: A2HItem): item is A2HInform {
  return item.intent === "INFORM";
}

/** Type guard: is this a plain text/Chat SDK message? */
export function isTextMessage(item: MessageItem): item is TextMessage {
  return !isA2HItem(item);
}

/** Normalise the envelope `message` field to an array */
export function normaliseMessages(
  message: MessageItem | MessageItem[]
): MessageItem[] {
  return Array.isArray(message) ? message : [message];
}
