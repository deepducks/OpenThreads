import { EmbedBuilder, APIEmbed } from "discord.js";

export interface EmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  url?: string;
  thumbnail?: string;
  timestamp?: Date;
}

/**
 * Build a Discord embed from simple options.
 */
export function buildEmbed(options: EmbedOptions): APIEmbed {
  const embed = new EmbedBuilder();

  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.color !== undefined) embed.setColor(options.color);
  if (options.url) embed.setURL(options.url);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer) embed.setFooter({ text: options.footer });
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  if (options.fields) {
    embed.addFields(
      options.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      }))
    );
  }

  return embed.toJSON();
}

/**
 * Build a styled embed for an A2H INFORM intent.
 */
export function buildInformEmbed(context: {
  action?: string;
  details?: string;
}): APIEmbed {
  return buildEmbed({
    title: context.action ? `ℹ️ ${context.action}` : "ℹ️ Notification",
    description: context.details,
    color: 0x5865f2, // Discord blurple
    timestamp: new Date(),
  });
}

/**
 * Build a styled embed for an A2H AUTHORIZE intent.
 */
export function buildAuthorizeEmbed(context: {
  action?: string;
  details?: string;
}): APIEmbed {
  return buildEmbed({
    title: context.action ? `🔐 Authorize: ${context.action}` : "🔐 Authorization Request",
    description: context.details,
    color: 0xffa500, // Orange — requires attention
    timestamp: new Date(),
  });
}

/**
 * Build a styled embed for an A2H COLLECT intent.
 */
export function buildCollectEmbed(context: {
  question?: string;
  details?: string;
}): APIEmbed {
  return buildEmbed({
    title: "📋 Input Requested",
    description: context.question ?? context.details,
    color: 0x57f287, // Green
    timestamp: new Date(),
  });
}

/**
 * Build a styled embed for an A2H ESCALATE intent.
 */
export function buildEscalateEmbed(context: {
  action?: string;
  details?: string;
}): APIEmbed {
  return buildEmbed({
    title: context.action ? `🚨 Escalation: ${context.action}` : "🚨 Human Escalation",
    description: context.details,
    color: 0xed4245, // Red — urgent
    timestamp: new Date(),
  });
}
