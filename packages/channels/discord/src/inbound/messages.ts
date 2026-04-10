import {
  Message,
  MessageType as DjsMessageType,
  PartialMessage,
} from "discord.js";
import { IncomingMessage } from "../types.js";

/**
 * Convert a Discord.js Message into the OpenThreads IncomingMessage shape.
 *
 * Returns null for messages sent by bots (including the bot itself), system
 * messages, and webhook messages so that callers can safely skip them.
 */
export function parseMessage(
  message: Message | PartialMessage
): IncomingMessage | null {
  // Ignore partial messages that couldn't be fetched
  if (message.partial) return null;
  // Ignore bots and webhooks
  if (message.author.bot || message.webhookId) return null;
  // Ignore system messages
  if (message.type !== DjsMessageType.Default && message.type !== DjsMessageType.Reply) {
    return null;
  }

  const isMention = message.mentions.users.has(message.client.user?.id ?? "");
  const threadId = message.channel.isThread() ? message.channelId : undefined;

  return {
    id: message.id,
    channelId: message.channelId,
    threadId,
    sender: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.username,
    },
    type: isMention ? "mention" : "text",
    text: message.content,
    attachments: message.attachments.map((a) => a.url),
    raw: message,
    timestamp: message.createdAt,
  };
}
