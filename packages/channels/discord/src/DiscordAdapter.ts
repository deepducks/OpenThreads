/**
 * Discord channel adapter for OpenThreads.
 *
 * Implements the full ChannelAdapter interface using discord.js.
 *
 * Inbound:
 *   - messageCreate — regular messages and @mentions
 *   - interactionCreate — slash commands
 *
 * Outbound:
 *   - Text messages and rich embeds
 *   - Discord message components (buttons, select menus) for A2H
 *
 * Thread support:
 *   - TextChannel threads (thread created from an existing message)
 *   - ForumChannel threads (forum posts)
 *   - 1:1 mapping between OpenThreads threadId and Discord thread/channel ID
 *
 * A2H delivery methods:
 *   Method 1 (inline) — AUTHORIZE → Approve/Deny buttons
 *                     — COLLECT with options → StringSelectMenu
 *   Method 2 (thread capture) — COLLECT free-text → awaits next message in thread
 */

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
import {
  buildAuthorizeEmbed,
  buildAuthorizeComponents,
  buildApprovedEmbed,
  buildDeniedEmbed,
  buildCollectEmbed,
  buildCollectSelectComponents,
  buildCollectResponseEmbed,
  buildInformEmbed,
} from './utils/components.js';
import {
  extractText,
  isBot,
  buildReplyToUrl,
  collectThreadKey,
} from './utils/normalize.js';

// ---------------------------------------------------------------------------
// Config & dependencies
// ---------------------------------------------------------------------------

export interface DiscordAdapterConfig {
  /** Bot token */
  token: string;
  /** Guild (server) ID for registering slash commands. Optional for global commands. */
  guildId?: string;
  /** OpenThreads base URL used to generate `replyTo` URLs */
  baseUrl?: string;
}

/**
 * Minimal Discord-like client interface required by the adapter.
 * Allows test doubles to be injected without a real Discord connection.
 */
export interface DiscordClientLike {
  login(token: string): Promise<string>;
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): this;
  channels: {
    fetch(id: string): Promise<DiscordChannelLike | null>;
  };
  application?: {
    commands: {
      create(data: { name: string; description: string }): Promise<unknown>;
    };
  } | null;
}

export interface DiscordChannelLike {
  id: string;
  isTextBased?: () => boolean;
  send(options: DiscordSendOptions): Promise<DiscordMessageLike>;
  threads?: {
    create(options: {
      name: string;
      autoArchiveDuration?: number;
      reason?: string;
    }): Promise<{ id: string; send(options: DiscordSendOptions): Promise<DiscordMessageLike> }>;
  };
  type?: number;
}

export interface DiscordMessageLike {
  id: string;
  content?: string;
  author?: { id: string; username?: string; bot?: boolean };
  channelId?: string;
  edit(options: DiscordSendOptions): Promise<DiscordMessageLike>;
}

export interface DiscordSendOptions {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

/**
 * Optional dependency overrides — primarily for testing.
 */
export interface DiscordAdapterDeps {
  client?: DiscordClientLike;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Resolves a pending A2H interaction with a raw string value */
type PendingResolver = (value: string) => void;

interface PendingContext {
  channelId: string;
  /** Discord message ID of the message that rendered the intent */
  messageId: string;
  /** For AUTHORIZE: action label used in confirmation update */
  action?: string;
  /** For COLLECT: question text used in confirmation update */
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
// DiscordAdapter
// ---------------------------------------------------------------------------

export class DiscordAdapter implements ChannelAdapter {
  readonly channelType = 'discord';

  /**
   * Discord supports native threads, buttons, select menus, DMs, and file uploads.
   * It does NOT have native "reply-to-message" in the WhatsApp-style quoting sense
   * (message references exist but are not the primary threading model).
   */
  readonly capabilities: ChannelCapabilities = {
    threads: true,
    buttons: true,
    selectMenus: true,
    replyMessages: false,
    dms: true,
    fileUpload: true,
  };

  private readonly client: DiscordClientLike;
  private messageHandler?: MessageHandler;

  /**
   * Pending A2H interactions keyed by either:
   *   - `intentId` — for button / select-menu interactions (component customId)
   *   - `thread:<channelId>:<threadId>` — for free-text thread captures
   */
  private readonly pending = new Map<string, PendingResolver>();

  /**
   * Stores display context for each pending intent so we can update the
   * original Discord message after resolution.
   */
  private readonly pendingCtx = new Map<string, PendingContext>();

  constructor(config: DiscordAdapterConfig, deps: DiscordAdapterDeps = {}) {
    this.config = config;

    if (deps.client) {
      this.client = deps.client;
    } else {
      // Lazy import discord.js to avoid breaking test environments without it installed
      // The real constructor path only runs when not injecting a test double.
      const { Client, GatewayIntentBits } = require('discord.js') as typeof import('discord.js');
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildMessageReactions,
        ],
      }) as unknown as DiscordClientLike;
    }

    this.registerHandlers();
  }

  private readonly config: DiscordAdapterConfig;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.client.login(this.config.token);

    // Register the /openthreads slash command if application is available
    if (this.client.application) {
      await this.client.application.commands.create({
        name: 'openthreads',
        description: 'Interact with OpenThreads',
      });
    }
  }

  async shutdown(): Promise<void> {
    this.client.destroy();
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

    let lastMessageId: string | undefined;

    for (const item of items) {
      if (isTextItem(item)) {
        const channel = await this.client.channels.fetch(
          envelope.threadId ?? envelope.channelId,
        );
        if (!channel) throw new Error(`Channel not found: ${envelope.channelId}`);

        const result = await channel.send({ content: item.text });
        lastMessageId = result.id;
      } else if (isA2HItem(item) && item.intent === 'INFORM') {
        const channel = await this.client.channels.fetch(
          envelope.threadId ?? envelope.channelId,
        );
        if (!channel) throw new Error(`Channel not found: ${envelope.channelId}`);

        const embed = buildInformEmbed(item as unknown as Parameters<typeof buildInformEmbed>[0]);
        const result = await channel.send({ embeds: [embed] });
        lastMessageId = result.id;
      }
      // Blocking A2H intents (AUTHORIZE, COLLECT) should go through sendA2H()
    }

    return {
      messageId: lastMessageId ?? randomUUID(),
      threadId: envelope.threadId,
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
        const targetId = threadId ?? channelId;
        const channel = await this.client.channels.fetch(targetId);
        if (!channel) throw new Error(`Channel not found: ${targetId}`);

        const embed = buildInformEmbed(
          intent as unknown as Parameters<typeof buildInformEmbed>[0],
        );
        await channel.send({ embeds: [embed] });
        return { intentId: intent.id, type: 'INFORM' };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handler registration
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    // --- Inbound messages ---
    this.client.on('messageCreate', async (...args: unknown[]) => {
      const message = args[0] as DiscordMessageLike & {
        author?: { id: string; username?: string; bot?: boolean };
        content?: string;
        channelId?: string;
        id?: string;
        channel?: { id?: string; isThread?: () => boolean; parentId?: string };
      };

      // Ignore bot messages
      if (isBot(message.author)) return;

      await this.handleIncomingMessage(message);
    });

    // --- Interaction create (buttons, select menus, slash commands) ---
    this.client.on('interactionCreate', async (...args: unknown[]) => {
      const interaction = args[0] as {
        isButton?: () => boolean;
        isStringSelectMenu?: () => boolean;
        isChatInputCommand?: () => boolean;
        customId?: string;
        values?: string[];
        commandName?: string;
        channelId?: string;
        user?: { id: string; username?: string };
        reply?: (options: DiscordSendOptions & { ephemeral?: boolean }) => Promise<void>;
        update?: (options: DiscordSendOptions) => Promise<void>;
        message?: DiscordMessageLike;
        options?: {
          getString?: (name: string) => string | null;
        };
      };

      if (interaction.isButton?.()) {
        const customId = interaction.customId ?? '';
        if (customId.startsWith('a2h_approve_')) {
          const intentId = customId.replace(/^a2h_approve_/, '');
          await this.handleButtonInteraction(interaction, intentId, true);
        } else if (customId.startsWith('a2h_deny_')) {
          const intentId = customId.replace(/^a2h_deny_/, '');
          await this.handleButtonInteraction(interaction, intentId, false);
        }
      } else if (interaction.isStringSelectMenu?.()) {
        const customId = interaction.customId ?? '';
        if (customId.startsWith('a2h_collect_select_')) {
          const intentId = customId.replace(/^a2h_collect_select_/, '');
          await this.handleSelectInteraction(interaction, intentId);
        }
      } else if (interaction.isChatInputCommand?.()) {
        await this.handleSlashCommand(interaction);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Inbound dispatchers
  // ---------------------------------------------------------------------------

  private async handleIncomingMessage(message: {
    author?: { id: string; username?: string; bot?: boolean };
    content?: string;
    channelId?: string;
    id?: string;
    channel?: { id?: string; isThread?: () => boolean; parentId?: string };
  }): Promise<void> {
    const channelId = message.channelId ?? message.channel?.id ?? '';
    const messageId = message.id ?? randomUUID();

    // Determine thread context: if the channel is itself a thread, it has a parentId
    const isThread = message.channel?.isThread?.() ?? false;
    const parentChannelId = isThread
      ? (message.channel?.parentId ?? channelId)
      : channelId;

    // --- Method 2: free-text COLLECT capture ---
    // If the message is in a thread and there is a pending listener, resolve it.
    if (isThread) {
      const key = collectThreadKey(parentChannelId, channelId);
      const resolver = this.pending.get(key);
      if (resolver) {
        const text = extractText(message.content);
        resolver(text);
        this.pending.delete(key);
        return; // Do NOT dispatch as a normal inbound message
      }
    }

    if (!this.messageHandler) return;

    const userId = message.author?.id ?? '';
    const senderName = message.author?.username ?? userId;
    const openThreadId = isThread ? channelId : messageId;
    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';

    const envelope: InboundEnvelope = {
      threadId: openThreadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: buildReplyToUrl(baseUrl, parentChannelId, openThreadId),
      source: {
        channel: 'discord',
        channelId: parentChannelId,
        sender: { id: userId, name: senderName },
        raw: message,
      },
      message: [{ text: extractText(message.content) }],
    };

    await this.messageHandler(envelope);
  }

  private async handleSlashCommand(interaction: {
    channelId?: string;
    user?: { id: string; username?: string };
    options?: { getString?: (name: string) => string | null };
    reply?: (options: DiscordSendOptions & { ephemeral?: boolean }) => Promise<void>;
  }): Promise<void> {
    if (!this.messageHandler) return;

    const channelId = interaction.channelId ?? '';
    const userId = interaction.user?.id ?? '';
    const text = interaction.options?.getString?.('input') ?? '';
    const threadId = `slash_${randomUUID()}`;
    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';

    const envelope: InboundEnvelope = {
      threadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: buildReplyToUrl(baseUrl, channelId, threadId),
      source: {
        channel: 'discord',
        channelId,
        sender: { id: userId, name: interaction.user?.username ?? userId },
        raw: interaction,
      },
      message: [{ text }],
    };

    // Acknowledge the interaction so Discord doesn't show "failed"
    await interaction.reply?.({ content: '✅ Command received.', ephemeral: true });
    await this.messageHandler(envelope);
  }

  // ---------------------------------------------------------------------------
  // Interaction handlers (A2H method 1)
  // ---------------------------------------------------------------------------

  private async handleButtonInteraction(
    interaction: {
      update?: (options: DiscordSendOptions) => Promise<void>;
      message?: DiscordMessageLike;
    },
    intentId: string,
    approved: boolean,
  ): Promise<void> {
    const resolver = this.pending.get(intentId);
    if (!resolver) return;

    resolver(approved ? 'approve' : 'deny');
    this.pending.delete(intentId);

    const ctx = this.pendingCtx.get(intentId);
    if (ctx) {
      this.pendingCtx.delete(intentId);
      const embed = approved
        ? buildApprovedEmbed(ctx.action ?? '')
        : buildDeniedEmbed(ctx.action ?? '');

      // Update the original interaction message to reflect the decision
      await interaction.update?.({ embeds: [embed], components: [] });
    }
  }

  private async handleSelectInteraction(
    interaction: {
      values?: string[];
      update?: (options: DiscordSendOptions) => Promise<void>;
      message?: DiscordMessageLike;
    },
    intentId: string,
  ): Promise<void> {
    const resolver = this.pending.get(intentId);
    if (!resolver) return;

    const selectedValue = interaction.values?.[0] ?? '';
    resolver(selectedValue);
    this.pending.delete(intentId);

    const ctx = this.pendingCtx.get(intentId);
    if (ctx) {
      this.pendingCtx.delete(intentId);
      const embed = buildCollectResponseEmbed(ctx.question ?? '', selectedValue);
      await interaction.update?.({ embeds: [embed], components: [] });
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
        const targetId = threadId ?? channelId;
        const channel = await this.client.channels.fetch(targetId);
        if (!channel) throw new Error(`Channel not found: ${targetId}`);

        const embed = buildAuthorizeEmbed(intent);
        const components = buildAuthorizeComponents(intent.id);
        const result = await channel.send({ embeds: [embed], components });

        this.pendingCtx.set(intent.id, {
          channelId: targetId,
          messageId: result.id,
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
   * Method 1 — renders COLLECT as a StringSelectMenu component.
   */
  private sendCollectSelect(
    channelId: string,
    threadId: string | undefined,
    intent: A2HCollectIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const targetId = threadId ?? channelId;
        const channel = await this.client.channels.fetch(targetId);
        if (!channel) throw new Error(`Channel not found: ${targetId}`);

        const embed = buildCollectEmbed(intent);
        const components = buildCollectSelectComponents(intent);
        const result = await channel.send({ embeds: [embed], components });

        this.pendingCtx.set(intent.id, {
          channelId: targetId,
          messageId: result.id,
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
        const targetId = threadId ?? channelId;
        const channel = await this.client.channels.fetch(targetId);
        if (!channel) throw new Error(`Channel not found: ${targetId}`);

        await channel.send({
          content: `📝 **${intent.question}**\n\n_Please reply in this thread to respond._`,
        });

        // Listen for the next message sent in the target thread/channel
        const listenThreadId = threadId ?? channelId;
        const key = collectThreadKey(channelId, listenThreadId);

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
