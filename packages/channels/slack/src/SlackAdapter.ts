/**
 * SlackAdapter — implements ChannelAdapter using @slack/bolt.
 *
 * Capabilities:
 *   threads: true, buttons: true, selectMenus: true,
 *   replyMessages: false, dms: true, fileUpload: true
 *
 * A2H methods supported:
 *   AUTHORIZE  → Block Kit Approve/Deny buttons (method 1)
 *   COLLECT    → static_select menu for closed options (method 1)
 *              → thread reply capture for free-text (method 2)
 *   INFORM     → plain-text fire-and-forget
 */

import { App, type AppOptions } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundEnvelope,
  OutboundMessage,
  A2HRequest,
  A2HResponse,
} from "@openthreads/core";
import { isA2HContent } from "@openthreads/core";
import {
  buildAuthorizeBlocks,
  buildSelectBlocks,
  buildTextBlocks,
} from "./utils/blocks.js";
import {
  normalizeSlackMessage,
  isBotMessage,
  type SlackMessagePayload,
} from "./utils/normalize.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackAdapterOptions {
  /** Slack bot OAuth token (xoxb-...) */
  token: string;
  /** Slack app signing secret */
  signingSecret: string;
  /** App-level token (xapp-...) — required when socketMode is true */
  appToken?: string;
  /** Use Socket Mode instead of HTTP (no public URL required) */
  socketMode?: boolean;
  /** HTTP port for the Bolt receiver (default: 3000) */
  port?: number;
}

/** Internal record for a pending A2H promise */
interface PendingA2H {
  resolve: (value: A2HResponse) => void;
  reject: (reason: Error) => void;
}

// ---------------------------------------------------------------------------
// BoltApp abstraction (allows injection of a mock in tests)
// ---------------------------------------------------------------------------

export interface BoltApp {
  message(handler: Function): void;
  event(eventName: string, handler: Function): void;
  command(commandName: string, handler: Function): void;
  action(
    pattern: string | RegExp | { action_id: string | RegExp },
    handler: Function
  ): void;
  start(port?: number): Promise<unknown>;
  stop(): Promise<unknown>;
  client: WebClient;
}

// ---------------------------------------------------------------------------
// SlackAdapter
// ---------------------------------------------------------------------------

export class SlackAdapter implements ChannelAdapter {
  private readonly boltApp: BoltApp;
  private readonly webClient: WebClient;
  private messageHandler?: (envelope: InboundEnvelope) => Promise<void>;

  /** Map from requestId (or thread key) → pending A2H promise */
  private readonly pending = new Map<string, PendingA2H>();

  private readonly port: number;

  /**
   * @param options  Slack credentials & mode settings
   * @param boltApp  Optional Bolt App instance (inject a mock in tests)
   * @param webClient  Optional WebClient instance (inject a mock in tests)
   */
  constructor(
    options: SlackAdapterOptions,
    boltApp?: BoltApp,
    webClient?: WebClient
  ) {
    this.port = options.port ?? 3000;

    if (boltApp) {
      this.boltApp = boltApp;
      this.webClient = webClient ?? boltApp.client;
    } else {
      const appOptions: AppOptions = {
        token: options.token,
        signingSecret: options.signingSecret,
      };
      if (options.socketMode && options.appToken) {
        appOptions.socketMode = true;
        appOptions.appToken = options.appToken;
      }
      const app = new App(appOptions);
      this.boltApp = app as unknown as BoltApp;
      this.webClient = webClient ?? new WebClient(options.token);
    }

    this.registerHandlers();
  }

  // ---------------------------------------------------------------------------
  // ChannelAdapter interface
  // ---------------------------------------------------------------------------

  capabilities(): ChannelCapabilities {
    return {
      threads: true,
      buttons: true,
      selectMenus: true,
      replyMessages: false,
      dms: true,
      fileUpload: true,
    };
  }

  onMessage(handler: (envelope: InboundEnvelope) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    await this.boltApp.start(this.port);
  }

  async stop(): Promise<void> {
    await this.boltApp.stop();
  }

  async send(message: OutboundMessage): Promise<void> {
    for (const item of message.content) {
      if (isA2HContent(item)) {
        if (item.intent === "INFORM") {
          await this.webClient.chat.postMessage({
            channel: message.targetId,
            text: item.context.details ?? item.context.question ?? "",
            ...(message.threadId ? { thread_ts: message.threadId } : {}),
          });
        }
        // Other A2H intents in send() are no-ops — use requestA2H() instead
      } else {
        const text = item.text ?? "";
        await this.webClient.chat.postMessage({
          channel: message.targetId,
          text,
          blocks: text ? buildTextBlocks(text) : undefined,
          ...(message.threadId ? { thread_ts: message.threadId } : {}),
        });
      }
    }
  }

  async requestA2H(request: A2HRequest): Promise<A2HResponse> {
    switch (request.intent) {
      case "INFORM":
        return this.sendInform(request);
      case "AUTHORIZE":
        return this.sendAuthorize(request);
      case "COLLECT":
        return this.sendCollect(request);
      default:
        // ESCALATE / RESULT — not yet rendered inline; fall back to text
        await this.webClient.chat.postMessage({
          channel: request.targetId,
          text: request.context.details ?? request.context.question ?? `[${request.intent}]`,
          ...(request.threadId ? { thread_ts: request.threadId } : {}),
        });
        return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers — A2H rendering
  // ---------------------------------------------------------------------------

  private async sendInform(request: A2HRequest): Promise<A2HResponse> {
    await this.webClient.chat.postMessage({
      channel: request.targetId,
      text: request.context.details ?? request.context.question ?? "",
      ...(request.threadId ? { thread_ts: request.threadId } : {}),
    });
    return {};
  }

  private sendAuthorize(request: A2HRequest): Promise<A2HResponse> {
    const requestId = generateRequestId();

    return new Promise<A2HResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });

      const blocks = buildAuthorizeBlocks(request.context, requestId);
      const text = `Approval required: ${request.context.action ?? "Action"}`;

      this.webClient.chat
        .postMessage({
          channel: request.targetId,
          text,
          blocks,
          ...(request.threadId ? { thread_ts: request.threadId } : {}),
        })
        .catch((err: unknown) => {
          this.pending.delete(requestId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private sendCollect(request: A2HRequest): Promise<A2HResponse> {
    const hasOptions =
      Array.isArray(request.context.options) &&
      request.context.options.length > 0;

    if (hasOptions) {
      return this.sendCollectSelect(request);
    }
    return this.sendCollectFreeText(request);
  }

  /** COLLECT with closed options — renders as static_select Block Kit menu */
  private sendCollectSelect(request: A2HRequest): Promise<A2HResponse> {
    const requestId = generateRequestId();

    return new Promise<A2HResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });

      const blocks = buildSelectBlocks(request.context, requestId);
      const text = request.context.question ?? "Please select an option";

      this.webClient.chat
        .postMessage({
          channel: request.targetId,
          text,
          blocks,
          ...(request.threadId ? { thread_ts: request.threadId } : {}),
        })
        .catch((err: unknown) => {
          this.pending.delete(requestId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /**
   * COLLECT free-text — posts the question, then captures the next reply
   * in the same thread (method 2: thread reply capture).
   */
  private sendCollectFreeText(request: A2HRequest): Promise<A2HResponse> {
    return new Promise<A2HResponse>((resolve, reject) => {
      const text = request.context.question ?? "Please provide your answer";

      this.webClient.chat
        .postMessage({
          channel: request.targetId,
          text,
          ...(request.threadId ? { thread_ts: request.threadId } : {}),
        })
        .then((result) => {
          // The pending key is based on the thread_ts of the conversation.
          // We watch for any reply in this thread from any user.
          const threadKey = buildThreadKey(
            request.threadId ?? (result as any).ts,
            request.targetId
          );
          this.pending.set(threadKey, { resolve, reject });
        })
        .catch((err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /** After receiving an A2H response, update the original message */
  private async updateInteractionMessage(
    channelId: string,
    ts: string,
    newText: string
  ): Promise<void> {
    try {
      await this.webClient.chat.update({
        channel: channelId,
        ts,
        text: newText,
        blocks: [],
      });
    } catch {
      // Best effort — don't fail the adapter if the update fails
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers — Bolt handler registration
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    this.registerMessageHandler();
    this.registerAppMentionHandler();
    this.registerSlashCommandHandler();
    this.registerAuthorizeActionHandler();
    this.registerCollectSelectHandler();
  }

  private registerMessageHandler(): void {
    this.boltApp.message(
      async ({ message }: { message: Record<string, unknown> }) => {
        const msg = message as unknown as SlackMessagePayload;

        // Ignore bot messages and message subtypes we don't handle
        if (isBotMessage(msg)) return;
        if (msg.subtype && msg.subtype !== "thread_broadcast") return;

        // Check if this is a reply to a pending free-text COLLECT
        if (msg.thread_ts) {
          const threadKey = buildThreadKey(msg.thread_ts, msg.channel);
          const pending = this.pending.get(threadKey);
          if (pending) {
            this.pending.delete(threadKey);
            pending.resolve({ value: msg.text ?? "" });
            return;
          }
        }

        if (this.messageHandler) {
          const envelope = normalizeSlackMessage(msg);
          await this.messageHandler(envelope);
        }
      }
    );
  }

  private registerAppMentionHandler(): void {
    this.boltApp.event(
      "app_mention",
      async ({ event }: { event: Record<string, unknown> }) => {
        if (!this.messageHandler) return;
        const envelope = normalizeSlackMessage(
          event as unknown as SlackMessagePayload
        );
        await this.messageHandler(envelope);
      }
    );
  }

  private registerSlashCommandHandler(): void {
    this.boltApp.command(
      "/openthreads",
      async ({
        command,
        ack,
      }: {
        command: Record<string, string>;
        ack: () => Promise<void>;
      }) => {
        await ack();
        if (!this.messageHandler) return;

        const envelope: InboundEnvelope = {
          threadId: command.channel_id,
          turnId: `slash_${Date.now()}`,
          replyTo: "",
          source: {
            channel: "slack",
            channelId: command.channel_id,
            sender: { id: command.user_id, name: command.user_name },
          },
          message: [{ text: command.text }],
        };

        await this.messageHandler(envelope);
      }
    );
  }

  private registerAuthorizeActionHandler(): void {
    this.boltApp.action(
      { action_id: /^a2h_authorize_(approve|deny)_/ },
      async ({
        action,
        ack,
        body,
      }: {
        action: Record<string, unknown>;
        ack: () => Promise<void>;
        body: Record<string, unknown>;
      }) => {
        await ack();

        const actionId = String(action["action_id"] ?? "");
        // action_id format: a2h_authorize_{approve|deny}_{requestId}
        const match = actionId.match(/^a2h_authorize_(approve|deny)_(.+)$/);
        if (!match) return;

        const decision = match[1]; // "approve" or "deny"
        const requestId = match[2];

        const pending = this.pending.get(requestId);
        if (!pending) return;

        this.pending.delete(requestId);
        pending.resolve({ approved: decision === "approve" });

        const channelId = String(
          (body["channel"] as Record<string, unknown>)?.["id"] ?? ""
        );
        const messageTs = String(
          (body["message"] as Record<string, unknown>)?.["ts"] ?? ""
        );

        if (channelId && messageTs) {
          const resultText =
            decision === "approve" ? "Approved ✓" : "Denied ✗";
          await this.updateInteractionMessage(channelId, messageTs, resultText);
        }
      }
    );
  }

  private registerCollectSelectHandler(): void {
    this.boltApp.action(
      { action_id: /^a2h_collect_select_/ },
      async ({
        action,
        ack,
        body,
      }: {
        action: Record<string, unknown>;
        ack: () => Promise<void>;
        body: Record<string, unknown>;
      }) => {
        await ack();

        const actionId = String(action["action_id"] ?? "");
        // action_id format: a2h_collect_select_{requestId}
        const requestId = actionId.replace("a2h_collect_select_", "");

        const selectedOption = action["selected_option"] as
          | Record<string, unknown>
          | undefined;
        const selectedValue = String(selectedOption?.["value"] ?? "");
        const selectedLabel = String(
          (selectedOption?.["text"] as Record<string, unknown>)?.["text"] ?? selectedValue
        );

        const pending = this.pending.get(requestId);
        if (!pending) return;

        this.pending.delete(requestId);
        pending.resolve({ value: selectedValue });

        const channelId = String(
          (body["channel"] as Record<string, unknown>)?.["id"] ?? ""
        );
        const messageTs = String(
          (body["message"] as Record<string, unknown>)?.["ts"] ?? ""
        );

        if (channelId && messageTs) {
          await this.updateInteractionMessage(
            channelId,
            messageTs,
            `Selected: ${selectedLabel}`
          );
        }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}${rnd}`;
}

/** Builds the pending-map key for a free-text COLLECT thread watcher */
function buildThreadKey(threadTs: string, channelId: string): string {
  return `thread:${channelId}:${threadTs}`;
}
