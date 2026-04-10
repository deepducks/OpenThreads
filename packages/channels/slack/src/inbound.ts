/**
 * Inbound message parsing: Slack events → InboundMessage.
 *
 * Handles:
 *  - Regular channel messages
 *  - App mentions (@bot)
 *  - Slash commands
 *  - Thread replies
 *  - DMs
 */

import type { InboundMessage } from "@openthreads/core";

/** Minimal shape of a Slack message event body */
export interface SlackMessageEvent {
  type: string;
  channel: string;
  user?: string;
  username?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  channel_type?: "im" | "mpim" | "channel" | "group";
}

/** Slack app_mention event body */
export interface SlackMentionEvent extends SlackMessageEvent {
  type: "app_mention";
}

/** Slack slash command payload */
export interface SlackSlashCommand {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  trigger_id: string;
  ts?: string;
}

/**
 * Parse a Slack message event into a normalised InboundMessage.
 *
 * @param event       Raw Slack event payload
 * @param botUserId   The bot's own user ID (used to strip @mentions from text)
 */
export function parseMessageEvent(
  event: SlackMessageEvent,
  botUserId?: string
): InboundMessage {
  const text = stripBotMention(event.text ?? "", botUserId);
  const isDM = event.channel_type === "im";

  return {
    threadId: null,
    nativeThreadId: event.thread_ts ?? null,
    sender: {
      id: event.user ?? "unknown",
      name: event.username ?? event.user ?? "unknown",
    },
    content: text.trim(),
    timestamp: slackTsToISO(event.ts),
    raw: event,
    channelId: event.channel,
    isDM,
  };
}

/**
 * Parse a Slack slash command into a normalised InboundMessage.
 * Slash commands don't have a native thread context.
 */
export function parseSlashCommand(
  payload: SlackSlashCommand
): InboundMessage {
  return {
    threadId: null,
    nativeThreadId: null,
    sender: {
      id: payload.user_id,
      name: payload.user_name,
    },
    content: `${payload.command} ${payload.text}`.trim(),
    timestamp: payload.ts ? slackTsToISO(payload.ts) : new Date().toISOString(),
    raw: payload,
    channelId: payload.channel_id,
    isDM: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Slack timestamp (Unix epoch with microseconds, e.g. "1700000000.123456")
 * to an ISO-8601 string.
 */
export function slackTsToISO(ts: string): string {
  const epochMs = parseFloat(ts) * 1000;
  return new Date(epochMs).toISOString();
}

/**
 * Remove a @-mention of the bot from text.
 * Slack sends mentions as `<@U1234567>` in the event text.
 */
export function stripBotMention(text: string, botUserId?: string): string {
  if (!botUserId) return text;
  return text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "");
}
