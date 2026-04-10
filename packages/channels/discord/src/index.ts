export { DiscordAdapter } from "./adapter.js";
export type {
  ChannelAdapter,
  ChannelCapabilities,
  DiscordAdapterConfig,
  SlashCommandDefinition,
  SlashCommandOption,
  IncomingMessage,
  IncomingMessageHandler,
  Unsubscribe,
  SendMessageParams,
  SentMessage,
  ThreadInfo,
  TextMessage,
  A2HMessage,
  A2HIntent,
  OutboundMessageItem,
  MessageType,
} from "./types.js";

// Outbound helpers (for advanced use)
export {
  buildEmbed,
  buildAuthorizeEmbed,
  buildCollectEmbed,
  buildInformEmbed,
  buildEscalateEmbed,
} from "./outbound/embeds.js";
export {
  buildAuthorizeButtons,
  buildSelectMenu,
  buildA2HComponents,
  parseA2HCustomId,
} from "./outbound/components.js";
