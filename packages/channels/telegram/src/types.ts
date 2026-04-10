/**
 * Telegram Bot API type definitions.
 *
 * These are minimal, focused definitions for the Telegram API objects
 * used by the OpenThreads Telegram adapter. They mirror the official
 * Telegram Bot API schema (https://core.telegram.org/bots/api).
 */

// ---------------------------------------------------------------------------
// Telegram Bot API objects
// ---------------------------------------------------------------------------

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  type: "regular" | "mask" | "custom_emoji";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  audio?: TelegramAudio;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  sticker?: TelegramSticker;
  reply_to_message?: TelegramMessage;
}

export interface TelegramMessageEntity {
  type:
    | "mention"
    | "hashtag"
    | "cashtag"
    | "bot_command"
    | "url"
    | "email"
    | "phone_number"
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "spoiler"
    | "code"
    | "pre"
    | "text_link"
    | "text_mention"
    | "custom_emoji";
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ---------------------------------------------------------------------------
// Telegram Bot API request/response objects
// ---------------------------------------------------------------------------

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true;
  selective?: boolean;
}

export type TelegramReplyMarkup =
  | TelegramInlineKeyboardMarkup
  | TelegramReplyKeyboardMarkup
  | TelegramReplyKeyboardRemove;

export interface SendMessageParams {
  chat_id: string | number;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
  reply_markup?: TelegramReplyMarkup;
}

export interface AnswerCallbackQueryParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface SetWebhookParams {
  url: string;
  secret_token?: string;
  drop_pending_updates?: boolean;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Adapter-specific types
// ---------------------------------------------------------------------------

export interface TelegramAdapterConfig {
  /** Telegram Bot API token from BotFather */
  botToken: string;
  /** Public HTTPS webhook URL */
  webhookUrl?: string;
  /**
   * Secret token sent by Telegram in the X-Telegram-Bot-Api-Secret-Token header.
   * Used to verify that requests come from Telegram.
   */
  webhookSecretToken?: string;
}

/**
 * Stored state for a virtual thread.
 * A virtual thread groups a sequence of reply-chain messages under a single threadId.
 */
export interface VirtualThread {
  threadId: string;
  chatId: string;
  /** The message IDs that form this reply chain */
  messageIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Callback data structure embedded in A2H inline keyboard buttons.
 * Must fit within Telegram's 64-byte callback_data limit.
 */
export interface A2HCallbackData {
  /** "a" = a2h (differentiates from other callback data) */
  t: "a";
  /** turnId (abbreviated) */
  tid: string;
  /** response value */
  v: string;
}
