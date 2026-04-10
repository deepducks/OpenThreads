/**
 * Telegram channel adapter for OpenThreads.
 *
 * Implements the full ChannelAdapter interface using the Telegram Bot API.
 * Zero external dependencies — all HTTP calls use the built-in `fetch` API
 * via TelegramApiClient.
 *
 * A2H delivery methods:
 *   Method 1 (inline)        — AUTHORIZE → ✅ Approve / ❌ Deny inline keyboard
 *                            — COLLECT with options → one button per option
 *   Method 2 (reply capture) — COLLECT free-text → awaits a reply to the COLLECT msg
 *
 * Capabilities reported:
 *   { threads: false, buttons: true, selectMenus: false,
 *     replyMessages: true, dms: true, fileUpload: true }
 *
 * Thread model:
 *   Telegram has no native thread concept in regular chats. OpenThreads models
 *   reply chains as virtual threads: the root message ID acts as the thread ID.
 *   When a message has `reply_to_message`, its threadId = the replied-to message ID.
 *   Otherwise threadId = the message's own ID (starts a new implicit thread).
 *
 * Webhook vs. polling:
 *   The adapter is webhook-only by design. The host HTTP server (packages/server)
 *   should POST Telegram updates to `handleUpdate()`. Call `initialize()` to
 *   register the webhook URL with Telegram.
 */

import { randomUUID } from 'crypto';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundEnvelope,
  OutboundEnvelope,
  A2HIntentMessage,
  A2HAuthorizeIntent,
  A2HCollectIntent,
  A2HResponse,
  MessageHandler,
  SendResult,
  A2HSendOptions,
  MessageItem,
} from '@openthreads/core';
import type { TelegramApiClientLike } from './TelegramApiClient.js';
import { TelegramApiClient } from './TelegramApiClient.js';
import { buildAuthorizeKeyboard, buildCollectKeyboard, parseCallbackData } from './utils/markup.js';
import { collectReplyKey, buildReplyToUrl, deriveSenderName } from './utils/normalize.js';

// ---------------------------------------------------------------------------
// Config & dependencies
// ---------------------------------------------------------------------------

export interface TelegramAdapterConfig {
  /** Bot token from BotFather (format: `123456:ABC-DEF...`) */
  token: string;
  /** Full HTTPS URL that Telegram will POST updates to */
  webhookUrl?: string;
  /** Optional secret header for webhook validation */
  webhookSecret?: string;
  /** OpenThreads base URL, used to generate `replyTo` URLs (default: http://localhost:3001) */
  baseUrl?: string;
}

/**
 * Optional dependency overrides — primarily for testing.
 */
export interface TelegramAdapterDeps {
  client?: TelegramApiClientLike;
}

// ---------------------------------------------------------------------------
// Telegram update & message types (minimal — only what the adapter needs)
// ---------------------------------------------------------------------------

export interface TelegramFrom {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  /** Attachment presence flags — content is opaque to the adapter */
  photo?: unknown[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
  video?: { file_id: string };
  audio?: { file_id: string };
  voice?: { file_id: string };
  sticker?: { file_id: string };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramFrom;
  message?: TelegramMessage;
  data?: string;
}

/** A Telegram Bot API Update object (webhook payload). */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Resolves a pending A2H interaction with the human's response string. */
type PendingResolver = (value: string) => void;

interface PendingContext {
  /** Chat ID the intent was sent in — needed to edit the original message */
  chatId: string;
  /** Message ID of the sent A2H message — needed to edit it after resolution */
  messageId: string;
  /** For AUTHORIZE: the `action` label used in the resolution text */
  action?: string;
  /** For COLLECT select: the question text used in the resolution text */
  question?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTextItem(item: MessageItem): item is { text: string } {
  return !('intent' in item);
}

function isA2HItem(item: MessageItem): item is A2HIntentMessage {
  return 'intent' in item;
}

/** Default A2H timeout: 24 hours */
const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// TelegramAdapter
// ---------------------------------------------------------------------------

export class TelegramAdapter implements ChannelAdapter {
  readonly channelType = 'telegram';

  /**
   * Telegram supports buttons (inline keyboards) and reply chains (replyMessages),
   * but does NOT have native threads or select menus.
   */
  readonly capabilities: ChannelCapabilities = {
    threads: false,
    buttons: true,
    selectMenus: false,
    replyMessages: true,
    dms: true,
    fileUpload: true,
  };

  private readonly client: TelegramApiClientLike;
  private messageHandler?: MessageHandler;

  /**
   * Pending A2H interactions keyed by either:
   *   - `intentId`                               — for button interactions (method 1)
   *   - `reply:{chatId}:{collectMsgId}`          — for reply-capture (method 2)
   */
  private readonly pending = new Map<string, PendingResolver>();

  /**
   * Stores display context for each pending intent so we can edit the original
   * Telegram message after the human responds.
   */
  private readonly pendingCtx = new Map<string, PendingContext>();

  private readonly config: TelegramAdapterConfig;

  constructor(config: TelegramAdapterConfig, deps: TelegramAdapterDeps = {}) {
    this.config = config;
    this.client = deps.client ?? new TelegramApiClient(config.token);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.config.webhookUrl) {
      await this.client.setWebhook({
        url: this.config.webhookUrl,
        secret_token: this.config.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
    }
  }

  async shutdown(): Promise<void> {
    // In webhook mode there is nothing to tear down on the adapter side.
    // The server that owns the HTTP listener handles its own cleanup.
    // If needed, callers can invoke `client.deleteWebhook()` directly.
  }

  // ---------------------------------------------------------------------------
  // Message handler registration
  // ---------------------------------------------------------------------------

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Outbound (non-blocking)
  // ---------------------------------------------------------------------------

  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    const items: MessageItem[] = Array.isArray(envelope.message)
      ? envelope.message
      : [envelope.message];

    let lastMessageId: string | undefined;

    for (const item of items) {
      if (isTextItem(item)) {
        const result = await this.client.sendMessage({
          chat_id: envelope.channelId,
          text: item.text,
          reply_to_message_id: envelope.threadId
            ? parseInt(envelope.threadId, 10)
            : undefined,
        });
        lastMessageId = String(
          (result as { message_id?: number }).message_id ?? randomUUID(),
        );
      } else if (isA2HItem(item) && item.intent === 'INFORM') {
        // Non-blocking INFORM — render as plain text
        const result = await this.client.sendMessage({
          chat_id: envelope.channelId,
          text: item.text,
          reply_to_message_id: envelope.threadId
            ? parseInt(envelope.threadId, 10)
            : undefined,
        });
        lastMessageId = String(
          (result as { message_id?: number }).message_id ?? randomUUID(),
        );
      }
      // Blocking intents (AUTHORIZE, COLLECT) must go through sendA2H()
    }

    return {
      messageId: lastMessageId ?? randomUUID(),
      threadId: envelope.threadId ?? lastMessageId,
    };
  }

  // ---------------------------------------------------------------------------
  // A2H (blocking)
  // ---------------------------------------------------------------------------

  async sendA2H(
    channelId: string,
    threadId: string | undefined,
    intent: A2HIntentMessage,
    options: A2HSendOptions = {},
  ): Promise<A2HResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    switch (intent.intent) {
      case 'AUTHORIZE':
        return this.sendAuthorize(
          channelId,
          threadId,
          intent as A2HAuthorizeIntent,
          timeoutMs,
        );

      case 'COLLECT':
        return this.sendCollect(
          channelId,
          threadId,
          intent as A2HCollectIntent,
          timeoutMs,
        );

      case 'INFORM': {
        await this.client.sendMessage({
          chat_id: channelId,
          text: intent.text,
          reply_to_message_id: threadId ? parseInt(threadId, 10) : undefined,
        });
        return { intentId: intent.id, type: 'INFORM' };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook handler — called by the host HTTP server for each Telegram update
  // ---------------------------------------------------------------------------

  /**
   * Process a single Telegram update (webhook POST body).
   *
   * The host server (packages/server) must parse the JSON body and call this
   * method. It handles all supported update types:
   *   - `message`        → dispatches to inbound message handler (or captures COLLECT)
   *   - `callback_query` → resolves pending AUTHORIZE / COLLECT-select interactions
   *   - `edited_message` → ignored
   *
   * @param update Parsed TelegramUpdate object from Telegram's webhook POST.
   */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    if (update.message) {
      await this.handleMessage(update.message);
      return;
    }

    // edited_message, channel_post, etc. are intentionally ignored
  }

  // ---------------------------------------------------------------------------
  // Private — inbound
  // ---------------------------------------------------------------------------

  private async handleMessage(msg: TelegramMessage): Promise<void> {
    // Ignore bot messages
    if (msg.from?.is_bot) return;

    const chatId = String(msg.chat.id);
    const messageId = String(msg.message_id);
    const replyToId = msg.reply_to_message
      ? String(msg.reply_to_message.message_id)
      : undefined;
    const text = msg.text ?? msg.caption ?? '';

    // --- Method 2: free-text COLLECT capture ---
    // If this message is a reply to a COLLECT message, resolve the listener.
    if (replyToId) {
      const key = collectReplyKey(chatId, replyToId);
      const resolver = this.pending.get(key);
      if (resolver) {
        resolver(text);
        this.pending.delete(key);
        this.pendingCtx.delete(key);
        return; // Consumed — do NOT dispatch as normal inbound message
      }
    }

    if (!this.messageHandler) return;

    const senderId = msg.from ? String(msg.from.id) : 'unknown';
    const senderName = msg.from ? deriveSenderName(msg.from) : senderId;

    // Virtual thread ID: the root of the reply chain, or the message itself
    const threadId = replyToId ?? messageId;
    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';

    const envelope: InboundEnvelope = {
      threadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: buildReplyToUrl(baseUrl, chatId, threadId),
      source: {
        channel: 'telegram',
        channelId: chatId,
        sender: { id: senderId, name: senderName },
        raw: msg,
      },
      message: [{ text }],
    };

    await this.messageHandler(envelope);
  }

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    const parsed = parseCallbackData(data);
    if (!parsed) return;

    const { intentId, value } = parsed;
    const resolver = this.pending.get(intentId);
    if (!resolver) return;

    resolver(value);
    this.pending.delete(intentId);

    // Acknowledge the callback to remove the loading state in Telegram
    await this.client.answerCallbackQuery({ callback_query_id: query.id });

    // Edit the original message to reflect the human's choice
    const ctx = this.pendingCtx.get(intentId);
    if (ctx && query.message) {
      this.pendingCtx.delete(intentId);

      let resultText: string;
      if (ctx.action !== undefined) {
        // AUTHORIZE resolution
        const approved = value === 'approve';
        resultText = approved
          ? `✅ Approved: ${ctx.action}`
          : `❌ Denied: ${ctx.action}`;
      } else {
        // COLLECT select resolution — value IS the selected option value
        // Look up the label from the option list if available
        resultText = `✅ Selected: ${value}`;
        if (ctx.question) {
          resultText = `📋 ${ctx.question}\n\n${resultText}`;
        }
      }

      await this.client.editMessageText({
        chat_id: ctx.chatId,
        message_id: parseInt(ctx.messageId, 10),
        text: resultText,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private — A2H senders
  // ---------------------------------------------------------------------------

  /**
   * Method 1 — renders AUTHORIZE as a two-button inline keyboard (Approve / Deny).
   */
  private sendAuthorize(
    channelId: string,
    threadId: string | undefined,
    intent: A2HAuthorizeIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const keyboard = buildAuthorizeKeyboard(intent.id);
        const detailsLine = intent.context.details
          ? `\nDetails: ${intent.context.details}`
          : '';
        const text =
          `🔐 Authorization Required\nAction: ${intent.context.action}${detailsLine}`;

        const result = await this.client.sendMessage({
          chat_id: channelId,
          text,
          reply_to_message_id: threadId ? parseInt(threadId, 10) : undefined,
          reply_markup: keyboard,
        });

        const messageId = String(
          (result as { message_id?: number }).message_id ?? '',
        );
        this.pendingCtx.set(intent.id, {
          chatId: channelId,
          messageId,
          action: intent.context.action,
        });

        const timer = setTimeout(() => {
          this.pending.delete(intent.id);
          this.pendingCtx.delete(intent.id);
          reject(new Error(`AUTHORIZE timeout for intent ${intent.id}`));
        }, timeoutMs);

        this.pending.set(intent.id, (value) => {
          clearTimeout(timer);
          resolve({
            intentId: intent.id,
            type: 'AUTHORIZE',
            approved: value === 'approve',
          });
        });
      })().catch(reject);
    });
  }

  /**
   * Dispatches to select (method 1) or free-text (method 2) COLLECT.
   */
  private sendCollect(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return intent.options && intent.options.length > 0
      ? this.sendCollectSelect(channelId, threadId, intent, timeoutMs)
      : this.sendCollectFreeText(channelId, threadId, intent, timeoutMs);
  }

  /**
   * Method 1 — renders COLLECT options as an inline keyboard (one button per option).
   */
  private sendCollectSelect(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const keyboard = buildCollectKeyboard(intent.id, intent.options!);
        const result = await this.client.sendMessage({
          chat_id: channelId,
          text: `📋 ${intent.question}`,
          reply_to_message_id: threadId ? parseInt(threadId, 10) : undefined,
          reply_markup: keyboard,
        });

        const messageId = String(
          (result as { message_id?: number }).message_id ?? '',
        );
        this.pendingCtx.set(intent.id, {
          chatId: channelId,
          messageId,
          question: intent.question,
        });

        const timer = setTimeout(() => {
          this.pending.delete(intent.id);
          this.pendingCtx.delete(intent.id);
          reject(new Error(`COLLECT select timeout for intent ${intent.id}`));
        }, timeoutMs);

        this.pending.set(intent.id, (value) => {
          clearTimeout(timer);
          resolve({
            intentId: intent.id,
            type: 'COLLECT',
            response: value,
          });
        });
      })().catch(reject);
    });
  }

  /**
   * Method 2 — sends the question and captures the next reply-to-message from the human.
   */
  private sendCollectFreeText(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const result = await this.client.sendMessage({
          chat_id: channelId,
          text: `📝 ${intent.question}\n\nPlease reply to this message to respond.`,
          reply_to_message_id: threadId ? parseInt(threadId, 10) : undefined,
        });

        const collectMsgId = String(
          (result as { message_id?: number }).message_id ?? '',
        );
        const listenKey = collectReplyKey(channelId, collectMsgId);

        const timer = setTimeout(() => {
          this.pending.delete(listenKey);
          reject(
            new Error(`COLLECT free-text timeout for intent ${intent.id}`),
          );
        }, timeoutMs);

        this.pending.set(listenKey, (text) => {
          clearTimeout(timer);
          resolve({
            intentId: intent.id,
            type: 'COLLECT',
            response: text,
          });
        });
      })().catch(reject);
    });
  }
}
