/**
 * SlackAdapter — implements the OpenThreads ChannelAdapter interface for Slack.
 *
 * Uses @slack/bolt for event listening and @slack/web-api for sending messages.
 *
 * Supported inbound events:
 *  - message (channel messages, DMs)
 *  - app_mention (@bot)
 *  - slash commands
 *
 * Supported A2H methods:
 *  - Method 1 (inline): AUTHORIZE → buttons, COLLECT w/ options → select menu
 *  - Method 2 (thread capture): COLLECT free-text → thread reply listener
 */

import { App, type AppOptions } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundMessage,
  MessageItem,
  MessageHandler,
  InteractionHandler,
  AuthorizeResponse,
  CollectResponse,
} from "@openthreads/core";

import { SLACK_CAPABILITIES } from "./capabilities.js";
import { parseMessageEvent, parseSlashCommand } from "./inbound.js";
import { sendMessages, type PendingFreeTextCollect } from "./outbound.js";
import { parseActionId } from "./a2h.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SlackAdapterConfig {
  /** Slack Bot Token (xoxb-…) */
  botToken: string;
  /** Slack Signing Secret (for request verification) */
  signingSecret: string;
  /**
   * Socket Mode app token (xapp-…).
   * When provided, the adapter uses Socket Mode instead of HTTP.
   */
  appToken?: string;
  /**
   * HTTP port for event subscriptions.
   * Required when not using Socket Mode.
   */
  port?: number;
  /**
   * Path for the Slack events endpoint.
   * Defaults to "/slack/events".
   */
  path?: string;
}

// ---------------------------------------------------------------------------
// SlackAdapter
// ---------------------------------------------------------------------------

export class SlackAdapter implements ChannelAdapter {
  private readonly config: SlackAdapterConfig;
  private readonly app: App;
  private readonly webClient: WebClient;

  private messageHandler: MessageHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;

  /**
   * Free-text COLLECT requests awaiting a thread reply.
   * Keyed by `${channelId}__${threadTs}`.
   */
  private pendingFreeTextCollects = new Map<string, PendingFreeTextCollect>();

  constructor(config: SlackAdapterConfig) {
    this.config = config;

    const appOptions: AppOptions = {
      token: config.botToken,
      signingSecret: config.signingSecret,
    };

    if (config.appToken) {
      appOptions.socketMode = true;
      appOptions.appToken = config.appToken;
    } else {
      appOptions.port = config.port ?? 3000;
    }

    this.app = new App(appOptions);
    this.webClient = new WebClient(config.botToken);

    this._registerHandlers();
  }

  // -------------------------------------------------------------------------
  // ChannelAdapter interface
  // -------------------------------------------------------------------------

  getCapabilities(): ChannelCapabilities {
    return SLACK_CAPABILITIES;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onInteraction(handler: InteractionHandler): void {
    this.interactionHandler = handler;
  }

  async start(): Promise<void> {
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async send(
    channelId: string,
    threadId: string | null,
    messages: MessageItem[]
  ): Promise<void> {
    const result = await sendMessages(this.webClient, messages, {
      channelId,
      threadTs: threadId,
    });

    // Register pending free-text collect listeners
    for (const pending of result.pendingFreeTextCollects) {
      const key = `${pending.channelId}__${pending.threadTs}`;
      this.pendingFreeTextCollects.set(key, pending);
    }
  }

  // -------------------------------------------------------------------------
  // Internal event registration
  // -------------------------------------------------------------------------

  private _registerHandlers(): void {
    this._registerMessageHandlers();
    this._registerInteractionHandlers();
    this._registerSlashCommandHandlers();
  }

  private _registerMessageHandlers(): void {
    // Regular channel messages and DMs
    this.app.message(async ({ message, say: _say }) => {
      if (!this.messageHandler) return;

      // Ignore bot messages and message_changed/deleted sub-types
      if ("subtype" in message && message.subtype) return;
      if ("bot_id" in message && message.bot_id) return;

      const msg = message as Parameters<typeof parseMessageEvent>[0];

      // Check if this is a reply to a pending free-text COLLECT
      if (msg.thread_ts) {
        const key = `${msg.channel}__${msg.thread_ts}`;
        const pending = this.pendingFreeTextCollects.get(key);
        if (pending && this.interactionHandler) {
          this.pendingFreeTextCollects.delete(key);
          const response: CollectResponse = {
            requestId: pending.requestId,
            value: msg.text?.trim() ?? "",
            respondedBy: msg.user ?? "unknown",
            respondedAt: new Date().toISOString(),
          };
          await this.interactionHandler(response);
          return; // Don't also fire the messageHandler for this reply
        }
      }

      const inbound = parseMessageEvent(msg);
      await this.messageHandler(inbound);
    });

    // App mentions (@bot text…)
    this.app.event("app_mention", async ({ event, say: _say }) => {
      if (!this.messageHandler) return;

      const inbound: InboundMessage = {
        threadId: null,
        nativeThreadId: event.thread_ts ?? null,
        sender: {
          id: event.user,
          name: event.user,
        },
        content: event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim(),
        timestamp: new Date(parseFloat(event.ts) * 1000).toISOString(),
        raw: event,
        channelId: event.channel,
        isDM: false,
      };

      await this.messageHandler(inbound);
    });
  }

  private _registerInteractionHandlers(): void {
    // Block Kit button clicks and select menu changes
    this.app.action(/^ot_/, async ({ action, ack, body }) => {
      await ack();

      if (!this.interactionHandler) return;

      const actionId =
        "action_id" in action ? (action.action_id as string) : "";
      const selectedValue =
        action.type === "static_select"
          ? (action as { selected_option?: { value: string } }).selected_option
              ?.value
          : undefined;

      const parsed = parseActionId(actionId, selectedValue);
      if (!parsed) return;

      const userId =
        body.user?.id ?? "unknown";
      const respondedAt = new Date().toISOString();

      if (parsed.type === "authorize") {
        const response: AuthorizeResponse = {
          requestId: parsed.requestId,
          approved: parsed.approved,
          respondedBy: userId,
          respondedAt,
        };
        await this.interactionHandler(response);
      } else if (parsed.type === "collect") {
        const response: CollectResponse = {
          requestId: parsed.requestId,
          value: parsed.value,
          respondedBy: userId,
          respondedAt,
        };
        await this.interactionHandler(response);
      }
    });
  }

  private _registerSlashCommandHandlers(): void {
    // Generic slash command handler — registers a wildcard listener.
    // Individual commands can be routed by the messageHandler based on content.
    this.app.command(/.*/, async ({ command, ack }) => {
      await ack();

      if (!this.messageHandler) return;

      const inbound = parseSlashCommand(command);
      await this.messageHandler(inbound);
    });
  }
}
