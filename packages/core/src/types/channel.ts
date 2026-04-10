/**
 * Channel — registration of an external messaging account/channel
 * (e.g. a Slack bot, a Telegram bot, a Discord server).
 * Represents the interface with the human world (senders).
 */
export interface Channel {
  /** Unique identifier for the channel (e.g. "slack-main", "telegram-support") */
  channelId: string;
  /** Platform type */
  type: ChannelType;
  /** Human-readable display name */
  name: string;
  /** Platform-specific configuration (bot tokens, webhook secrets, etc.) */
  config: Record<string, unknown>;
  /** API key used by recipients to send messages directly on this channel */
  apiKey?: string;
  /** Whether the channel is currently active */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ChannelType =
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'teams'
  | 'google-chat'
  | 'sms'
  | string;

export type ChannelInput = Omit<Channel, 'createdAt' | 'updatedAt'>;
