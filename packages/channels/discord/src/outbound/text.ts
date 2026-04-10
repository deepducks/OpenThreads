import {
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  ForumChannel,
  BaseMessageOptions,
  AnyThreadChannel,
} from "discord.js";
import { TextMessage } from "../types.js";

type SendableChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | ThreadChannel
  | AnyThreadChannel;

/**
 * Build Discord message options from an OpenThreads TextMessage.
 */
export function buildTextPayload(msg: TextMessage): BaseMessageOptions {
  return {
    content: msg.text || undefined,
  };
}

/**
 * Send a plain-text message to a Discord channel or thread.
 * Returns the Discord message ID of the sent message.
 */
export async function sendTextMessage(
  channel: SendableChannel | ForumChannel,
  msg: TextMessage,
  threadId?: string
): Promise<string> {
  const payload = buildTextPayload(msg);

  // If a thread ID is provided, send inside that thread
  if (threadId && "threads" in channel) {
    const thread = await (channel as TextChannel).threads.fetch(threadId);
    if (thread) {
      const sent = await thread.send(payload);
      return sent.id;
    }
  }

  // Send directly in the channel (which may already be a thread channel)
  if ("send" in channel) {
    const sent = await (channel as SendableChannel).send(payload);
    return sent.id;
  }

  throw new Error(`Channel type does not support sending messages: ${channel.type}`);
}
