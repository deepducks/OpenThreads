/**
 * Telegram channel adapter for OpenThreads.
 *
 * Implements the ChannelAdapter interface using the Telegram Bot API.
 *
 * Capabilities:
 *   threads: false       — Telegram has no native thread/reply chains as named threads
 *   buttons: true        — inline keyboards via callback_query
 *   selectMenus: false   — no native select-menu control
 *   replyMessages: true  — reply-to message capture for free-text COLLECT
 *   dms: true            — private chat support
 *   fileUpload: true     — documents, photos, audio, video
 *
 * Virtual threads:
 *   Telegram DMs and groups do not have named threads. OpenThreads emulates threads
 *   by tracking reply chains. A reply to message X belongs to the same virtual thread
 *   as X. Messages with no reply start a new virtual thread.
 *
 * A2H rendering:
 *   AUTHORIZE        → inline keyboard (✅ Approve / ❌ Deny)
 *   COLLECT+options  → inline keyboard (one button per option)
 *   COLLECT free     → question message; response captured via reply-to
 *   INFORM           → plain notification, no response
 */

import type {
  ChannelAdapter,
  ChannelCapabilities,
  AdapterConfig,
  InboundMessage,
  CallbackQuery,
  OutboundMessage,
  SentMessage,
  SendTarget,
  A2HIntent,
  A2HRenderResult,
  A2HResponse,
} from "@openthreads/core";

import { TelegramApiClient } from "./api-client.js";
import { InMemoryThreadStore, type ThreadStore } from "./thread-store.js";
import type {
  SetWebhookParams,
  AnswerCallbackQueryParams,
  TelegramAdapterConfig,
  TelegramUpdate,
} from "./types.js";
import {
  parseUpdateAsInbound,
  parseUpdateAsCallbackQuery,
} from "./inbound.js";
import { buildSendMessageParams } from "./outbound.js";
import {
  renderA2HIntent as _renderA2HIntent,
  captureA2HResponse as _captureA2HResponse,
} from "./a2h-renderer.js";

// ---------------------------------------------------------------------------
// Telegram adapter
// ---------------------------------------------------------------------------

export interface TelegramAdapterOptions {
  threadStore?: ThreadStore;
  /**
   * Optional pre-built API client. When provided, the adapter uses this
   * client instead of constructing one from the botToken credential.
   * Useful for testing and dependency injection.
   */
  apiClient?: TelegramApiClient;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly capabilities: ChannelCapabilities = {
    threads: false,
    buttons: true,
    selectMenus: false,
    replyMessages: true,
    dms: true,
    fileUpload: true,
  };

  private api: TelegramApiClient | undefined;
  private threadStore: ThreadStore;
  private channelId = "";
  private readonly injectedApiClient?: TelegramApiClient;

  constructor(options?: TelegramAdapterOptions | ThreadStore) {
    // Accept either an options object or a bare ThreadStore for backwards compat
    if (options !== undefined && "resolveThread" in options) {
      this.threadStore = options as ThreadStore;
    } else {
      const opts = (options ?? {}) as TelegramAdapterOptions;
      this.threadStore = opts.threadStore ?? new InMemoryThreadStore();
      this.injectedApiClient = opts.apiClient;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async setup(config: AdapterConfig): Promise<void> {
    this.channelId = config.channelId;

    if (this.injectedApiClient !== undefined) {
      // Use the pre-injected client (e.g. in tests)
      this.api = this.injectedApiClient;
    } else {
      const botToken = config.credentials["botToken"];
      if (botToken === undefined || botToken === "") {
        throw new Error("TelegramAdapter: credentials.botToken is required");
      }
      this.api = new TelegramApiClient(botToken);
    }

    if (config.webhookUrl !== undefined && config.webhookUrl !== "") {
      const secretToken = config.credentials["webhookSecretToken"];
      const webhookParams: SetWebhookParams = {
        url: config.webhookUrl,
        drop_pending_updates: false,
      };
      if (secretToken !== undefined) webhookParams.secret_token = secretToken;
      await this.api.setWebhook(webhookParams);
    }
  }

  async teardown(): Promise<void> {
    if (this.api !== undefined) {
      await this.api.deleteWebhook();
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  async parseInbound(payload: unknown): Promise<InboundMessage | null> {
    const update = payload as TelegramUpdate;
    return parseUpdateAsInbound(update, this.channelId, this.threadStore);
  }

  async parseCallbackQuery(payload: unknown): Promise<CallbackQuery | null> {
    const update = payload as TelegramUpdate;
    return parseUpdateAsCallbackQuery(update);
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async send(target: SendTarget, message: OutboundMessage): Promise<SentMessage> {
    const api = this.requireApi();
    const params = buildSendMessageParams(target.chatId, message);
    const sent = await api.sendMessage(params);
    return {
      messageId: String(sent.message_id),
      sentAt: new Date(sent.date * 1000),
    };
  }

  async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    const params: AnswerCallbackQueryParams = { callback_query_id: queryId };
    if (text !== undefined) params.text = text;
    await this.requireApi().answerCallbackQuery(params);
  }

  // ---------------------------------------------------------------------------
  // A2H
  // ---------------------------------------------------------------------------

  async renderA2HIntent(
    chatId: string,
    intent: A2HIntent,
    replyToMessageId?: string,
  ): Promise<A2HRenderResult> {
    return _renderA2HIntent(this.requireApi(), chatId, intent, replyToMessageId);
  }

  async captureA2HResponse(
    payload: unknown,
    pendingTurnId: string,
    pendingMessageId: string,
  ): Promise<A2HResponse | null> {
    return _captureA2HResponse(payload, pendingTurnId, pendingMessageId);
  }

  // ---------------------------------------------------------------------------
  // Accessors (useful in integration tests)
  // ---------------------------------------------------------------------------

  private requireApi(): TelegramApiClient {
    if (this.api === undefined) {
      throw new Error("TelegramAdapter: setup() must be called before using the adapter");
    }
    return this.api;
  }

  getThreadStore(): ThreadStore {
    return this.threadStore;
  }

  getApiClient(): TelegramApiClient {
    return this.requireApi();
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { TelegramAdapterConfig, VirtualThread } from "./types.js";
export { InMemoryThreadStore } from "./thread-store.js";
export type { ThreadStore } from "./thread-store.js";
export { encodeA2HCallbackData, decodeA2HCallbackData } from "./a2h-renderer.js";
export { escapeMarkdownV2 } from "./outbound.js";
export { parseCommand, isCommand } from "./inbound.js";
