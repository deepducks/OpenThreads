/**
 * Supported communication platform identifiers.
 */
export type Platform =
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'teams'
  | 'google-chat'
  | string;

/**
 * A Channel represents a registered external messaging account/bot
 * (e.g., a Slack bot token, a Telegram bot, a Discord bot).
 * It is the interface between OpenThreads and the human world.
 */
export interface Channel {
  /** Unique identifier for the channel (user-defined slug, e.g. "slack-main") */
  id: string;
  /** The platform this channel belongs to */
  platform: Platform;
  /** Reference to credentials stored externally or in a vault */
  credentialsRef: string;
  /** API key issued by OpenThreads for recipient systems to send via this channel */
  apiKey: string;
  /** Arbitrary metadata for this channel */
  metadata?: Record<string, unknown>;
}

export type CreateChannelInput = Omit<Channel, 'apiKey'> & { apiKey?: string };
