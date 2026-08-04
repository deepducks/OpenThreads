import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Message,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  REST,
  Routes,
  InteractionType,
  ChannelType,
  BaseMessageOptions,
  MessageFlags,
} from "discord.js";
import {
  ChannelAdapter,
  ChannelCapabilities,
  DiscordAdapterConfig,
  IncomingMessage,
  IncomingMessageHandler,
  SendMessageParams,
  SentMessage,
  Unsubscribe,
  A2HMessage,
  TextMessage,
} from "./types.js";
import { parseMessage } from "./inbound/messages.js";
import { parseSlashCommand } from "./inbound/commands.js";
import {
  buildAuthorizeEmbed,
  buildCollectEmbed,
  buildInformEmbed,
  buildEscalateEmbed,
} from "./outbound/embeds.js";
import { buildA2HComponents, parseA2HCustomId } from "./outbound/components.js";
import { getThread, createThread, ensureThreadActive } from "./threads/index.js";
import { SlashCommandDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

function isA2HMessage(item: unknown): item is A2HMessage {
  return (
    typeof item === "object" &&
    item !== null &&
    "intent" in item &&
    typeof (item as A2HMessage).intent === "string"
  );
}

function isTextMessage(item: unknown): item is TextMessage {
  return (
    typeof item === "object" &&
    item !== null &&
    "text" in item &&
    typeof (item as TextMessage).text === "string"
  );
}

// ---------------------------------------------------------------------------
// Response-capture bookkeeping
// ---------------------------------------------------------------------------

interface PendingCapture {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
  intentId: string | undefined;
  /** channel or thread ID where we expect the human reply */
  captureChannelId: string;
  /** If set, only accept replies from this user ID */
  userId?: string;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Discord Adapter
// ---------------------------------------------------------------------------

/**
 * Discord channel adapter for OpenThreads.
 *
 * Implements the full ChannelAdapter interface:
 *  - Inbound: message create, slash commands, @mentions
 *  - Outbound: text messages, Discord embeds, message components (buttons,
 *    select menus) for A2H intents
 *  - Thread support: Discord threads and forum-channel posts (1:1 mapping)
 *  - A2H inline (method 1): AUTHORIZE → approve/deny buttons,
 *    COLLECT (closed options) → select menu
 *  - Response capture (method 2): component interactions + thread replies
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly channelType = "discord";

  private client: Client | null = null;
  private config: DiscordAdapterConfig | null = null;
  private handlers: Set<IncomingMessageHandler> = new Set();

  /**
   * Map from intentId → pending capture for method-2 response collection.
   * Key is intentId when set, otherwise the Discord message ID of the
   * component message.
   */
  private pendingCaptures: Map<string, PendingCapture> = new Map();

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

  async connect(config: DiscordAdapterConfig): Promise<void> {
    this.config = config;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.registerClientEvents();

    await this.client.login(config.token);

    if (config.slashCommands && config.slashCommands.length > 0) {
      await this.registerSlashCommands(config);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    // Reject all pending captures
    for (const capture of this.pendingCaptures.values()) {
      clearTimeout(capture.timer);
      capture.reject(new Error("Adapter disconnected"));
    }
    this.pendingCaptures.clear();
  }

  onIncomingMessage(handler: IncomingMessageHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessage> {
    if (!this.client) throw new Error("DiscordAdapter not connected");

    const { channelId, threadId, messages } = params;

    // Resolve the target channel / thread
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Discord channel ${channelId} not found`);
    }

    let targetChannelId = channelId;

    // If a threadId is provided, ensure the thread exists and is active
    if (threadId) {
      await ensureThreadActive(this.client, threadId);
      targetChannelId = threadId;
    }

    const targetChannel = threadId
      ? await this.client.channels.fetch(threadId)
      : channel;

    if (!targetChannel || !("send" in targetChannel)) {
      throw new Error(`Cannot send to channel ${targetChannelId}`);
    }

    let lastMessageId = "";

    for (const item of messages) {
      if (isA2HMessage(item)) {
        lastMessageId = await this.sendA2HMessage(
          targetChannel as Parameters<typeof this.sendA2HMessage>[0],
          item
        );
      } else if (isTextMessage(item)) {
        const payload: BaseMessageOptions = { content: item.text };
        const sent = await (targetChannel as { send: (opts: BaseMessageOptions) => Promise<{ id: string }> }).send(payload);
        lastMessageId = sent.id;
      }
    }

    return {
      messageId: lastMessageId,
      channelId,
      threadId: threadId ?? undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private registerClientEvents(): void {
    if (!this.client) return;

    // Text messages and @mentions
    this.client.on(Events.MessageCreate, (message: Message) => {
      const parsed = parseMessage(message);
      if (parsed) this.dispatchIncoming(parsed);
    });

    // Slash commands and component interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.type === InteractionType.ApplicationCommand) {
        const slashInteraction = interaction as ChatInputCommandInteraction;
        const parsed = parseSlashCommand(slashInteraction);

        // Defer the reply — the actual response will come through sendMessage
        await slashInteraction.deferReply({ flags: MessageFlags.Ephemeral });
        this.dispatchIncoming(parsed);
      }

      // Button interactions (A2H method 1)
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction as ButtonInteraction);
      }

      // Select-menu interactions (A2H method 1)
      if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction as StringSelectMenuInteraction);
      }
    });

    // Thread messages for method-2 response capture
    this.client.on(Events.MessageCreate, (message: Message) => {
      if (!message.channel.isThread()) return;
      this.tryResolvePendingCapture(message);
    });
  }

  private dispatchIncoming(message: IncomingMessage): void {
    for (const handler of this.handlers) {
      Promise.resolve(handler(message)).catch((err) => {
        console.error("[DiscordAdapter] Handler error:", err);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // A2H outbound rendering
  // ---------------------------------------------------------------------------

  private async sendA2HMessage(
    channel: { send: (opts: BaseMessageOptions) => Promise<{ id: string }> },
    intent: A2HMessage
  ): Promise<string> {
    const components = buildA2HComponents(intent);

    let embed;
    switch (intent.intent) {
      case "INFORM":
        embed = buildInformEmbed(intent.context as { action?: string; details?: string });
        break;
      case "AUTHORIZE":
        embed = buildAuthorizeEmbed(intent.context as { action?: string; details?: string });
        break;
      case "COLLECT":
        embed = buildCollectEmbed(
          intent.context as { question?: string; details?: string }
        );
        break;
      case "ESCALATE":
        embed = buildEscalateEmbed(intent.context as { action?: string; details?: string });
        break;
      default:
        embed = undefined;
    }

    const payload: BaseMessageOptions = {
      ...(embed ? { embeds: [embed] } : {}),
      ...(components && components.length > 0 ? { components } : {}),
    };

    const sent = await channel.send(payload);
    return sent.id;
  }

  // ---------------------------------------------------------------------------
  // Component interaction handlers (method 1 / method 2)
  // ---------------------------------------------------------------------------

  private async handleButtonInteraction(
    interaction: ButtonInteraction
  ): Promise<void> {
    const parsed = parseA2HCustomId(interaction.customId);
    if (!parsed) return;

    const value = parsed.type === "approve" ? "approved" : "denied";
    const label = parsed.type === "approve" ? "Approved" : "Denied";

    // Acknowledge the interaction immediately
    await interaction.update({
      components: [],
      embeds: interaction.message.embeds,
      content: `${label} by ${interaction.user.username}`,
    });

    this.resolveCapture(parsed.intentId ?? interaction.message.id, value);
  }

  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction
  ): Promise<void> {
    const parsed = parseA2HCustomId(interaction.customId);
    if (!parsed) return;

    const value = interaction.values[0] ?? "";

    await interaction.update({
      components: [],
      embeds: interaction.message.embeds,
      content: `Selected: **${value}** by ${interaction.user.username}`,
    });

    this.resolveCapture(parsed.intentId ?? interaction.message.id, value);
  }

  private resolveCapture(key: string, value: string): void {
    const capture = this.pendingCaptures.get(key);
    if (!capture) return;

    clearTimeout(capture.timer);
    this.pendingCaptures.delete(key);
    capture.resolve(value);
  }

  private tryResolvePendingCapture(message: Message): void {
    if (!message.channel.isThread()) return;

    for (const [key, capture] of this.pendingCaptures) {
      if (
        capture.captureChannelId === message.channelId &&
        (!capture.userId || capture.userId === message.author.id)
      ) {
        clearTimeout(capture.timer);
        this.pendingCaptures.delete(key);
        capture.resolve(message.content);
        return;
      }
    }
  }

  /**
   * Wait for a human response to an A2H intent via component interaction or
   * thread reply (method 2).
   *
   * @param captureChannelId - Discord thread/channel to watch for text replies
   * @param intentId         - Correlates with the component customId suffix
   * @param userId           - If set, only accept responses from this user
   * @param timeoutMs        - Reject after this many milliseconds
   */
  awaitResponse(
    captureChannelId: string,
    intentId: string | undefined,
    userId?: string,
    timeoutMs?: number
  ): Promise<string> {
    const key = intentId ?? captureChannelId;
    const timeout = timeoutMs ?? (this.config?.interactionTimeoutSeconds ?? 300) * 1000;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCaptures.delete(key);
        reject(new Error(`A2H response timeout for intent ${key}`));
      }, timeout);

      this.pendingCaptures.set(key, {
        resolve,
        reject,
        intentId,
        captureChannelId,
        userId,
        timer,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Slash command registration
  // ---------------------------------------------------------------------------

  private async registerSlashCommands(
    config: DiscordAdapterConfig
  ): Promise<void> {
    const rest = new REST().setToken(config.token);
    const commands = (config.slashCommands ?? []).map(
      (cmd: SlashCommandDefinition) => ({
        name: cmd.name,
        description: cmd.description,
        options: cmd.options?.map((opt) => ({
          name: opt.name,
          description: opt.description,
          type: commandOptionTypeToDiscord(opt.type),
          required: opt.required ?? false,
          choices: opt.choices,
        })),
      })
    );

    if (config.guildIds && config.guildIds.length > 0) {
      for (const guildId of config.guildIds) {
        await rest.put(
          Routes.applicationGuildCommands(config.applicationId, guildId),
          { body: commands }
        );
      }
    } else {
      await rest.put(Routes.applicationCommands(config.applicationId), {
        body: commands,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Thread helpers (exposed for convenience)
  // ---------------------------------------------------------------------------

  async getThread(
    discordThreadId: string
  ): ReturnType<typeof getThread> {
    if (!this.client) throw new Error("DiscordAdapter not connected");
    return getThread(this.client, discordThreadId);
  }

  async createThread(
    parentChannelId: string,
    name: string,
    options?: Parameters<typeof createThread>[3]
  ): ReturnType<typeof createThread> {
    if (!this.client) throw new Error("DiscordAdapter not connected");
    return createThread(this.client, parentChannelId, name, options);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function commandOptionTypeToDiscord(type: string): number {
  // https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type
  const map: Record<string, number> = {
    string: 3,
    integer: 4,
    boolean: 5,
    user: 6,
    channel: 7,
    role: 8,
  };
  return map[type] ?? 3;
}
