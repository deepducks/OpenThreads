import {
  ChatInputCommandInteraction,
  ApplicationCommandOptionType,
} from "discord.js";
import { IncomingMessage } from "../types.js";

/**
 * Convert a Discord slash-command interaction into an IncomingMessage.
 */
export function parseSlashCommand(
  interaction: ChatInputCommandInteraction
): IncomingMessage {
  // Collect all options into a plain record
  const commandOptions: Record<string, string | number | boolean> = {};
  for (const option of interaction.options.data) {
    if (
      option.type === ApplicationCommandOptionType.String ||
      option.type === ApplicationCommandOptionType.Integer ||
      option.type === ApplicationCommandOptionType.Number ||
      option.type === ApplicationCommandOptionType.Boolean
    ) {
      commandOptions[option.name] = option.value as string | number | boolean;
    }
  }

  const threadId = interaction.channel?.isThread()
    ? interaction.channelId
    : undefined;

  return {
    id: interaction.id,
    channelId: interaction.channelId,
    threadId,
    sender: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName:
        interaction.member && "displayName" in interaction.member
          ? (interaction.member as { displayName: string }).displayName
          : interaction.user.username,
    },
    type: "slash_command",
    text: `/${interaction.commandName}`,
    commandName: interaction.commandName,
    commandOptions,
    attachments: [],
    raw: interaction,
    timestamp: new Date(),
  };
}
