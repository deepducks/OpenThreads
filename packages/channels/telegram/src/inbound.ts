/**
 * Inbound message parser for the Telegram adapter.
 *
 * Translates raw Telegram Update objects into normalised
 * InboundMessage / CallbackQuery objects.
 */

import type {
  InboundMessage,
  CallbackQuery,
  MessageAttachment,
} from "@openthreads/core";
import type { TelegramUpdate, TelegramMessage } from "./types.js";
import type { ThreadStore } from "./thread-store.js";

function generateMessageId(): string {
  return `tg_msg_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Extract attachments from a Telegram message.
 */
function extractAttachments(msg: TelegramMessage): MessageAttachment[] {
  const attachments: MessageAttachment[] = [];

  if (msg.photo !== undefined && msg.photo.length > 0) {
    // Use the largest photo variant
    const largest = msg.photo.reduce((a, b) => (a.file_size ?? 0) > (b.file_size ?? 0) ? a : b);
    attachments.push({
      type: "image",
      fileId: largest.file_id,
      fileSize: largest.file_size,
    });
  }

  if (msg.document !== undefined) {
    attachments.push({
      type: "document",
      fileId: msg.document.file_id,
      mimeType: msg.document.mime_type,
      fileName: msg.document.file_name,
      fileSize: msg.document.file_size,
    });
  }

  if (msg.audio !== undefined) {
    attachments.push({
      type: "audio",
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type,
      fileSize: msg.audio.file_size,
    });
  }

  if (msg.video !== undefined) {
    attachments.push({
      type: "video",
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type,
      fileSize: msg.video.file_size,
    });
  }

  if (msg.voice !== undefined) {
    attachments.push({
      type: "voice",
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type,
      fileSize: msg.voice.file_size,
    });
  }

  if (msg.sticker !== undefined) {
    attachments.push({
      type: "sticker",
      fileId: msg.sticker.file_id,
    });
  }

  return attachments;
}

/**
 * Parse a Telegram Message into a normalised InboundMessage.
 * Returns null if the message has no usable content (e.g. service messages).
 */
export function parseMessage(
  msg: TelegramMessage,
  channelId: string,
  threadStore: ThreadStore,
): InboundMessage | null {
  // Require a sender (service messages have no `from`)
  if (msg.from === undefined) return null;

  const chatId = String(msg.chat.id);
  const messageId = String(msg.message_id);
  const replyToId = msg.reply_to_message !== undefined
    ? String(msg.reply_to_message.message_id)
    : undefined;

  const threadId = threadStore.resolveThread(chatId, messageId, replyToId);
  const attachments = extractAttachments(msg);
  const text = msg.text ?? msg.caption;

  // Require either text or at least one attachment
  if (text === undefined && attachments.length === 0) return null;

  const sender = {
    id: String(msg.from.id),
    name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
    username: msg.from.username,
  };

  return {
    id: generateMessageId(),
    threadId,
    replyToMessageId: replyToId,
    channel: channelId,
    chatId,
    sender,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    raw: msg,
    receivedAt: new Date(msg.date * 1000),
  };
}

/**
 * Parse a Telegram Update into a normalised InboundMessage.
 * Returns null for non-message updates (callback queries, etc.).
 */
export function parseUpdateAsInbound(
  update: TelegramUpdate,
  channelId: string,
  threadStore: ThreadStore,
): InboundMessage | null {
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  if (msg === undefined) return null;
  return parseMessage(msg, channelId, threadStore);
}

/**
 * Parse a Telegram Update into a normalised CallbackQuery.
 * Returns null if the update does not contain a callback_query.
 */
export function parseUpdateAsCallbackQuery(
  update: TelegramUpdate,
): CallbackQuery | null {
  if (update.callback_query === undefined) return null;

  const cq = update.callback_query;
  const chatId = cq.message !== undefined ? String(cq.message.chat.id) : "";
  const originMessageId = cq.message !== undefined ? String(cq.message.message_id) : "";

  return {
    id: cq.id,
    data: cq.data ?? "",
    sender: {
      id: String(cq.from.id),
      name: [cq.from.first_name, cq.from.last_name].filter(Boolean).join(" "),
      username: cq.from.username,
    },
    originMessageId,
    chatId,
    raw: cq,
  };
}

/**
 * Determine whether a Telegram update is a bot command (e.g. /start).
 */
export function isCommand(update: TelegramUpdate): boolean {
  const msg = update.message;
  if (msg?.text === undefined || msg.entities === undefined) return false;
  return msg.entities.some((e) => e.type === "bot_command" && e.offset === 0);
}

/**
 * Extract the command name and arguments from a Telegram message.
 * Returns null if the message is not a command.
 */
export function parseCommand(
  update: TelegramUpdate,
): { command: string; args: string[] } | null {
  if (!isCommand(update)) return null;
  const text = update.message!.text!;
  // Strip @botname suffix from the command token
  const parts = text.split(/\s+/);
  const commandToken = (parts[0] ?? "").split("@")[0] ?? "";
  return {
    command: commandToken,
    args: parts.slice(1),
  };
}
