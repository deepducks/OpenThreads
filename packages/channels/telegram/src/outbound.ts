/**
 * Outbound message formatter for the Telegram adapter.
 *
 * Converts normalised OutboundMessage objects into Telegram Bot API request params.
 */

import type { OutboundMessage } from "@openthreads/core";
import type {
  SendMessageParams,
  TelegramInlineKeyboardMarkup,
  TelegramReplyKeyboardMarkup,
  TelegramReplyKeyboardRemove,
  TelegramReplyMarkup,
} from "./types.js";

/**
 * Build the Telegram reply_markup from an OutboundMessage.
 */
function buildReplyMarkup(msg: OutboundMessage): TelegramReplyMarkup | undefined {
  if (msg.removeKeyboard === true) {
    const remove: TelegramReplyKeyboardRemove = { remove_keyboard: true };
    return remove;
  }

  if (msg.inlineKeyboard !== undefined && msg.inlineKeyboard.length > 0) {
    const markup: TelegramInlineKeyboardMarkup = {
      inline_keyboard: msg.inlineKeyboard.map((row) =>
        row.map((btn) => ({
          text: btn.text,
          callback_data: btn.callbackData,
          url: btn.url,
        })),
      ),
    };
    return markup;
  }

  if (msg.replyKeyboard !== undefined && msg.replyKeyboard.length > 0) {
    const markup: TelegramReplyKeyboardMarkup = {
      keyboard: msg.replyKeyboard.map((row) =>
        row.map((btn) => ({
          text: btn.text,
          request_contact: btn.requestContact,
          request_location: btn.requestLocation,
        })),
      ),
      resize_keyboard: true,
      one_time_keyboard: true,
    };
    return markup;
  }

  return undefined;
}

/**
 * Convert a normalised OutboundMessage into Telegram Bot API sendMessage params.
 */
export function buildSendMessageParams(
  chatId: string | number,
  msg: OutboundMessage,
): SendMessageParams {
  let text: string;
  let parseMode: "HTML" | "MarkdownV2" | "Markdown" | undefined;

  if (msg.html !== undefined) {
    text = msg.html;
    parseMode = "HTML";
  } else if (msg.markdown !== undefined) {
    text = msg.markdown;
    parseMode = "MarkdownV2";
  } else {
    text = msg.text ?? "";
    parseMode = undefined;
  }

  const params: SendMessageParams = {
    chat_id: chatId,
    text,
  };

  if (parseMode !== undefined) params.parse_mode = parseMode;
  if (msg.disableWebPagePreview !== undefined) params.disable_web_page_preview = msg.disableWebPagePreview;
  if (msg.replyToMessageId !== undefined) params.reply_to_message_id = Number(msg.replyToMessageId);

  const markup = buildReplyMarkup(msg);
  if (markup !== undefined) params.reply_markup = markup;

  return params;
}

/**
 * Escape special characters for Telegram MarkdownV2 parse mode.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
