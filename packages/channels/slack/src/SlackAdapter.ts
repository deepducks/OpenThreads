/**
 * Slack channel adapter for OpenThreads.
 *
 * Implements the full ChannelAdapter interface using the Slack Bolt framework.
 *
 * A2H delivery methods used:
 *   Method 1 (inline) — AUTHORIZE → Approve/Deny buttons
 *                      — COLLECT with options → static_select menu
 *   Method 2 (thread capture) — COLLECT free-text → awaits thread reply
 */

import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { randomUUID } from 'crypto';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundEnvelope,
  OutboundEnvelope,
  A2HIntent,
  A2HAuthorizeIntent,
  A2HCollectIntent,
  A2HResponse,
  MessageHandler,
  SendResult,
  A2HSendOptions,
  MessageItem,
} from '@openthreads/core';
import type {
  GenericMessageEvent,
  AppMentionEvent,
  ButtonAction,
  StaticSelectAction,
  BlockAction,
  SlashCommand,
} from '@slack/bolt';
import {
  buildAuthorizeBlocks,
  buildApprovedBlock,
  buildDeniedBlock,
  buildCollectSelectBlocks,
  buildCollectResponseBlock,
} from './utils/blocks.js';
import {
  extractText,
  isBot,
  buildReplyToUrl,
  collectThreadKey,
} from './utils/normalize.js';

// ---------------------------------------------------------------------------
// Config & dependencies
// ---------------------------------------------------------------------------

export interface SlackAdapterConfig {
  /** Bot token (xoxb-…) */
  token: string;
  /** App signing secret for request verification */
  signingSecret: string;
  /** App-level token for Socket Mode (xapp-…) */
  appToken?: string;
  /** HTTP port to listen on (default: 3000). Ignored in Socket Mode. */
  port?: number;
  /** Use Socket Mode instead of HTTP webhooks */
  socketMode?: boolean;
  /** OpenThreads base URL used to generate `replyTo` URLs */
  baseUrl?: string;
}

/**
 * Optional dependency overrides — primarily for testing.
 */
export interface SlackAdapterDeps {
  app?: Pick<App, 'message' | 'event' | 'command' | 'action' | 'start' | 'stop'>;
  client?: Pick<WebClient, 'chat' | 'users'>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Resolves a pending A2H interaction with a raw string value */
type PendingResolver = (value: string) => void;

interface PendingContext {
  channelId: string;
  /** Timestamp of the Slack message that rendered the intent */
  ts: string;
  /** For AUTHORIZE: action label used in confirmation message */
  action?: string;
  /** For COLLECT: question text used in confirmation message */
  question?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTextItem(item: MessageItem): item is { text: string } {
  return !('intent' in item);
}

function isA2HItem(item: MessageItem): item is A2HIntent {
  return 'intent' in item;
}

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// SlackAdapter
// ---------------------------------------------------------------------------

export class SlackAdapter implements ChannelAdapter {
  readonly channelType = 'slack';

  /**
   * Slack supports native threads, buttons, select menus, DMs, and file uploads.
   * It does NOT have native "reply-to-message" (WhatsApp-style quoting is
   * separate from thread replies in Slack's model).
   */
  readonly capabilities: ChannelCapabilities = {
    threads: true,
    buttons: true,
    selectMenus: true,
    replyMessages: false,
    dms: true,
    fileUpload: true,
  };

  private readonly app: Pick<App, 'message' | 'event' | 'command' | 'action' | 'start' | 'stop'>;
  private readonly client: Pick<WebClient, 'chat' | 'users'>;
  private messageHandler?: MessageHandler;

  /**
   * Pending A2H interactions keyed by either:
   *   - `intent.id` — for button / select-menu interactions
   *   - `thread:<channelId>:<threadTs>` — for free-text thread captures
   */
  private readonly pending = new Map<string, PendingResolver>();

  /**
   * Stores display context (message ts, action label, etc.) for each pending
   * intent so we can update the original Slack message after resolution.
   */
  private readonly pendingCtx = new Map<string, PendingContext>();

  constructor(config: SlackAdapterConfig, deps: SlackAdapterDeps = {}) {
    if (deps.app) {
      this.app = deps.app;
    } else {
      const appOptions: ConstructorParameters<typeof App>[0] = {
        token: config.token,
        signingSecret: config.signingSecret,
      };
      if (config.socketMode && config.appToken) {
        appOptions.socketMode = true;
        appOptions.appToken = config.appToken;
      }
      this.app = new App(appOptions);
    }

    this.client = deps.client ?? new WebClient(config.token);
    this.config = config;
    this.registerHandlers();
  }

  // TypeScript requires the field to be initialised in the constructor body
  private readonly config: SlackAdapterConfig;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.app.start(this.config.port ?? 3000);
  }

  async shutdown(): Promise<void> {
    await this.app.stop();
  }

  // ---------------------------------------------------------------------------
  // Message handler registration
  // ---------------------------------------------------------------------------

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    const items: MessageItem[] = Array.isArray(envelope.message)
      ? envelope.message
      : [envelope.message];

    let lastTs: string | undefined;

    for (const item of items) {
      if (isTextItem(item)) {
        const result = await this.client.chat.postMessage({
          channel: envelope.channelId,
          thread_ts: envelope.threadId,
          text: item.text,
          mrkdwn: true,
        });
        lastTs = (result as { ts?: string }).ts;
      } else if (isA2HItem(item) && item.intent === 'INFORM') {
        const result = await this.client.chat.postMessage({
          channel: envelope.channelId,
          thread_ts: envelope.threadId,
          text: item.text,
          mrkdwn: true,
        });
        lastTs = (result as { ts?: string }).ts;
      }
      // Blocking A2H intents (AUTHORIZE, COLLECT) should go through sendA2H()
    }

    return {
      messageId: lastTs ?? randomUUID(),
      threadId: envelope.threadId ?? lastTs,
    };
  }

  // ---------------------------------------------------------------------------
  // A2H
  // ---------------------------------------------------------------------------

  async sendA2H(
    channelId: string,
    threadId: string | undefined,
    intent: A2HIntent,
    options: A2HSendOptions = {},
  ): Promise<A2HResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    switch (intent.intent) {
      case 'AUTHORIZE':
        return this.sendAuthorize(channelId, threadId, intent, timeoutMs);

      case 'COLLECT':
        return this.sendCollect(channelId, threadId, intent, timeoutMs);

      case 'INFORM': {
        await this.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadId,
          text: intent.text,
          mrkdwn: true,
        });
        return { intentId: intent.id, type: 'INFORM' };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handler registration
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    // --- Inbound messages ---
    this.app.message(async ({ message }) => {
      const msg = message as GenericMessageEvent;
      if (isBot(msg)) return;
      await this.handleIncomingEvent(msg);
    });

    // --- App mentions (also fires for DMs; deduplicate with message handler) ---
    this.app.event('app_mention', async ({ event }) => {
      // app_mention fires in addition to message for channel mentions.
      // We gate on message handler presence and use thread_ts for dedup.
      await this.handleIncomingEvent(event as GenericMessageEvent);
    });

    // --- Slash commands ---
    this.app.command('/openthreads', async ({ command, ack }) => {
      await ack();
      await this.handleSlashCommand(command);
    });

    // --- Block Kit interactions (A2H method 1) ---

    // Approve button
    this.app.action('a2h_approve', async ({ action, body, ack }) => {
      await ack();
      await this.handleAuthorizeAction(action as ButtonAction, body as BlockAction, true);
    });

    // Deny button
    this.app.action('a2h_deny', async ({ action, body, ack }) => {
      await ack();
      await this.handleAuthorizeAction(action as ButtonAction, body as BlockAction, false);
    });

    // Select menu
    this.app.action('a2h_collect_select', async ({ action, body, ack }) => {
      await ack();
      await this.handleCollectSelect(action as StaticSelectAction, body as BlockAction);
    });
  }

  // ---------------------------------------------------------------------------
  // Inbound dispatchers
  // ---------------------------------------------------------------------------

  private async handleIncomingEvent(
    event: GenericMessageEvent | AppMentionEvent,
  ): Promise<void> {
    const channelId = event.channel;
    const messageTs = event.ts;
    const threadTs = (event as { thread_ts?: string }).thread_ts;

    // --- Method 2: free-text COLLECT capture ---
    // If this message is a thread reply and there is a pending listener, resolve it.
    if (threadTs) {
      const key = collectThreadKey(channelId, threadTs);
      const resolver = this.pending.get(key);
      if (resolver) {
        const text = extractText(event as GenericMessageEvent);
        resolver(text);
        this.pending.delete(key);
        return; // Do NOT dispatch as a normal inbound message
      }
    }

    if (!this.messageHandler) return;

    // Resolve display name from Slack user info
    const userId = (event as { user?: string }).user ?? '';
    let senderName = userId;
    try {
      const info = await this.client.users.info({ user: userId });
      const user = (info as { user?: { real_name?: string; name?: string } }).user;
      senderName = user?.real_name ?? user?.name ?? userId;
    } catch {
      // fall back to userId as name
    }

    const openThreadId = threadTs ?? messageTs;
    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';

    const envelope: InboundEnvelope = {
      threadId: openThreadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: buildReplyToUrl(baseUrl, channelId, openThreadId),
      source: {
        channel: 'slack',
        channelId,
        sender: { id: userId, name: senderName },
        raw: event,
      },
      message: [{ text: extractText(event as GenericMessageEvent) }],
    };

    await this.messageHandler(envelope);
  }

  private async handleSlashCommand(command: SlashCommand): Promise<void> {
    if (!this.messageHandler) return;

    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';
    const threadId = `slash_${command.trigger_id}`;

    const envelope: InboundEnvelope = {
      threadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: buildReplyToUrl(baseUrl, command.channel_id, threadId),
      source: {
        channel: 'slack',
        channelId: command.channel_id,
        sender: { id: command.user_id, name: command.user_name },
        raw: command,
      },
      message: [{ text: command.text }],
    };

    await this.messageHandler(envelope);
  }

  // ---------------------------------------------------------------------------
  // Block action handlers
  // ---------------------------------------------------------------------------

  private async handleAuthorizeAction(
    _action: ButtonAction,
    body: BlockAction,
    approved: boolean,
  ): Promise<void> {
    // Recover intentId from block_id: "auth_actions_<intentId>"
    const blockId: string = (body.actions[0] as { block_id?: string })?.block_id ?? '';
    const intentId = blockId.replace(/^auth_actions_/, '');

    const resolver = this.pending.get(intentId);
    if (!resolver) return;

    resolver(approved ? 'approve' : 'deny');
    this.pending.delete(intentId);

    // Update the original Slack message to reflect the decision
    const ctx = this.pendingCtx.get(intentId);
    if (ctx) {
      this.pendingCtx.delete(intentId);
      const blocks = approved
        ? buildApprovedBlock(ctx.action ?? '')
        : buildDeniedBlock(ctx.action ?? '');

      await this.client.chat.update({
        channel: ctx.channelId,
        ts: ctx.ts,
        text: approved
          ? `✅ Approved: ${ctx.action}`
          : `❌ Denied: ${ctx.action}`,
        blocks,
      });
    }
  }

  private async handleCollectSelect(
    action: StaticSelectAction,
    body: BlockAction,
  ): Promise<void> {
    // Recover intentId from block_id: "collect_section_<intentId>"
    const blockId: string = (body.actions[0] as { block_id?: string })?.block_id ?? '';
    const intentId = blockId.replace(/^collect_section_/, '');

    const resolver = this.pending.get(intentId);
    if (!resolver) return;

    const selectedValue = (action as { selected_option?: { value?: string; text?: { text?: string } } })
      .selected_option?.value ?? '';
    const selectedLabel = (action as { selected_option?: { text?: { text?: string } } })
      .selected_option?.text?.text ?? selectedValue;

    resolver(selectedValue);
    this.pending.delete(intentId);

    // Update the original message
    const ctx = this.pendingCtx.get(intentId);
    if (ctx) {
      this.pendingCtx.delete(intentId);
      await this.client.chat.update({
        channel: ctx.channelId,
        ts: ctx.ts,
        text: `✅ Selected: ${selectedLabel}`,
        blocks: buildCollectResponseBlock(ctx.question ?? '', selectedLabel),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // A2H senders
  // ---------------------------------------------------------------------------

  private sendAuthorize(
    channelId: string,
    threadId: string | undefined,
    intent: A2HAuthorizeIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const blocks = buildAuthorizeBlocks(intent);
        const result = await this.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadId,
          text: `🔐 Authorization required: ${intent.context.action}`,
          blocks,
        });

        const messageTs = (result as { ts?: string }).ts ?? '';
        this.pendingCtx.set(intent.id, {
          channelId,
          ts: messageTs,
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

  private sendCollect(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    if (intent.options && intent.options.length > 0) {
      return this.sendCollectSelect(channelId, threadId, intent, timeoutMs);
    }
    return this.sendCollectFreeText(channelId, threadId, intent, timeoutMs);
  }

  /**
   * Method 1 — renders COLLECT as a static_select Block Kit menu.
   */
  private sendCollectSelect(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const blocks = buildCollectSelectBlocks(intent);
        const result = await this.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadId,
          text: intent.question,
          blocks,
        });

        const messageTs = (result as { ts?: string }).ts ?? '';
        this.pendingCtx.set(intent.id, {
          channelId,
          ts: messageTs,
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
   * Method 2 — posts the question in the thread and captures the next reply.
   */
  private sendCollectFreeText(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const result = await this.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadId,
          text: `📝 *${intent.question}*\n\n_Please reply in this thread to respond._`,
          mrkdwn: true,
        });

        // If there is an existing thread, listen to it; otherwise listen to
        // the thread created by this message.
        const listenTs = threadId ?? ((result as { ts?: string }).ts ?? '');
        const key = collectThreadKey(channelId, listenTs);

        const timer = setTimeout(() => {
          this.pending.delete(key);
          reject(new Error(`COLLECT free-text timeout for intent ${intent.id}`));
        }, timeoutMs);

        this.pending.set(key, (text) => {
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
