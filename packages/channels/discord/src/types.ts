/**
 * Core types for the Discord channel adapter.
 * These mirror the @openthreads/core interfaces — when that package is
 * available the types here should be replaced with imports from it.
 */

// ---------------------------------------------------------------------------
// Channel capabilities
// ---------------------------------------------------------------------------

export interface ChannelCapabilities {
  threads: boolean;
  buttons: boolean;
  selectMenus: boolean;
  replyMessages: boolean;
  dms: boolean;
  fileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------------

export type MessageType = "text" | "slash_command" | "mention";

export interface IncomingMessage {
  id: string;
  channelId: string;
  /** OpenThreads thread ID (if a thread context is detected) */
  threadId?: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
  };
  type: MessageType;
  text: string;
  /** Slash command name when type === "slash_command" */
  commandName?: string;
  /** Slash command options when type === "slash_command" */
  commandOptions?: Record<string, string | number | boolean>;
  /** Attachment URLs */
  attachments: string[];
  /** Raw Discord message / interaction, for adapter-internal use */
  raw: unknown;
  timestamp: Date;
}

export type IncomingMessageHandler = (message: IncomingMessage) => void | Promise<void>;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Outbound messages
// ---------------------------------------------------------------------------

export type A2HIntent = "INFORM" | "COLLECT" | "AUTHORIZE" | "ESCALATE" | "RESULT";

export interface TextMessage {
  text: string;
  attachments?: string[];
}

export interface A2HMessage {
  intent: A2HIntent;
  context: {
    action?: string;
    details?: string;
    question?: string;
    options?: Array<{ label: string; value: string }>;
    [key: string]: unknown;
  };
  /** Correlation id forwarded back to the recipient */
  intentId?: string;
}

export type OutboundMessageItem = TextMessage | A2HMessage;

export interface SendMessageParams {
  /** The Discord channel / DM channel ID */
  channelId: string;
  /**
   * Discord channel thread ID (for replies inside threads) or
   * OpenThreads thread ID (resolved to Discord thread by the adapter).
   */
  threadId?: string;
  messages: OutboundMessageItem[];
}

export interface SentMessage {
  /** Discord message snowflake */
  messageId: string;
  /** Discord channel ID */
  channelId: string;
  /** Discord thread ID (if the message was sent inside a thread) */
  threadId?: string;
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface ThreadInfo {
  /** OpenThreads thread ID */
  id: string;
  /** Discord channel snowflake (the thread channel itself) */
  discordThreadId: string;
  /** Parent Discord channel */
  discordParentChannelId: string;
  name?: string;
  archived: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Adapter config
// ---------------------------------------------------------------------------

export interface DiscordAdapterConfig {
  /** Discord bot token */
  token: string;
  /**
   * Discord Application ID — required for registering slash commands.
   */
  applicationId: string;
  /**
   * Guild IDs to register slash commands on (guild-scoped = instant).
   * Leave empty for global slash commands (takes up to 1 h to propagate).
   */
  guildIds?: string[];
  /**
   * Slash commands to register on connect.
   */
  slashCommands?: SlashCommandDefinition[];
  /**
   * Seconds to wait for a component-interaction response before timing out
   * (method-2 response capture).  Defaults to 300 (5 min).
   */
  interactionTimeoutSeconds?: number;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  options?: SlashCommandOption[];
}

export interface SlashCommandOption {
  name: string;
  description: string;
  type: "string" | "integer" | "boolean" | "user" | "channel" | "role";
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
}

// ---------------------------------------------------------------------------
// ChannelAdapter interface (mirrors @openthreads/core)
// ---------------------------------------------------------------------------

export interface ChannelAdapter {
  readonly channelType: string;
  capabilities(): ChannelCapabilities;
  connect(config: DiscordAdapterConfig): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(params: SendMessageParams): Promise<SentMessage>;
  onIncomingMessage(handler: IncomingMessageHandler): Unsubscribe;
}
