/**
 * Normalizes raw Slack event payloads into OpenThreads InboundEnvelope format.
 */

import type { InboundEnvelope, MessageItem } from "@openthreads/core";

/** Minimal shape of a Slack message/event we care about */
export interface SlackMessagePayload {
  ts: string;
  thread_ts?: string;
  channel: string;
  user?: string;
  username?: string;
  text?: string;
  subtype?: string;
  files?: unknown[];
}

/**
 * Normalizes a Slack message event into an InboundEnvelope.
 *
 * threadId mapping:
 *   - message in a thread: threadId = thread_ts (the parent message timestamp)
 *   - message at channel root: threadId = ts (becomes the thread root if someone replies)
 *
 * turnId = ts of this specific message.
 * replyTo is left empty — the server layer fills it in with the ephemeral token URL.
 */
export function normalizeSlackMessage(
  msg: SlackMessagePayload,
  channelAdapterId = "slack"
): InboundEnvelope {
  const threadId = msg.thread_ts ?? msg.ts;

  const messageItems: MessageItem[] = [
    {
      text: msg.text ?? "",
      attachments: msg.files ? (msg.files as unknown[]) : [],
    },
  ];

  return {
    threadId,
    turnId: msg.ts,
    replyTo: "",
    source: {
      channel: channelAdapterId,
      channelId: msg.channel,
      sender: {
        id: msg.user ?? "",
        name: msg.username ?? msg.user ?? "",
      },
    },
    message: messageItems,
  };
}

/**
 * Determines whether a Slack message payload is a thread reply.
 */
export function isThreadReply(msg: SlackMessagePayload): boolean {
  return !!msg.thread_ts && msg.thread_ts !== msg.ts;
}

/**
 * Determines whether a Slack message is from a bot (should usually be ignored).
 */
export function isBotMessage(msg: SlackMessagePayload): boolean {
  return msg.subtype === "bot_message";
}
