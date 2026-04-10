import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageActionRowComponentBuilder,
  APIActionRowComponent,
  APIMessageActionRowComponent,
} from "discord.js";
import { A2HMessage, A2HIntent } from "../types.js";

export interface ComponentInteractionResult {
  intentId: string | undefined;
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Button helpers
// ---------------------------------------------------------------------------

export const APPROVE_CUSTOM_ID = "ot_a2h_approve";
export const DENY_CUSTOM_ID = "ot_a2h_deny";

/**
 * Build the approve/deny button row used for A2H AUTHORIZE intents.
 */
export function buildAuthorizeButtons(
  intentId?: string
): APIActionRowComponent<APIMessageActionRowComponent> {
  const suffix = intentId ? `:${intentId}` : "";

  const approveBtn = new ButtonBuilder()
    .setCustomId(`${APPROVE_CUSTOM_ID}${suffix}`)
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success)
    .setEmoji("✅");

  const denyBtn = new ButtonBuilder()
    .setCustomId(`${DENY_CUSTOM_ID}${suffix}`)
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("❌");

  return new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(approveBtn, denyBtn)
    .toJSON();
}

// ---------------------------------------------------------------------------
// Select-menu helpers
// ---------------------------------------------------------------------------

export const SELECT_CUSTOM_ID_PREFIX = "ot_a2h_select";

/**
 * Build a select-menu row for A2H COLLECT intents that provide closed options.
 */
export function buildSelectMenu(
  options: Array<{ label: string; value: string }>,
  placeholder = "Choose an option…",
  intentId?: string
): APIActionRowComponent<APIMessageActionRowComponent> {
  const customId = intentId
    ? `${SELECT_CUSTOM_ID_PREFIX}:${intentId}`
    : SELECT_CUSTOM_ID_PREFIX;

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      options.map((opt) =>
        new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(opt.value)
      )
    );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(select)
    .toJSON();
}

// ---------------------------------------------------------------------------
// A2H → component mapper
// ---------------------------------------------------------------------------

/**
 * Derive message-action-row components for a given A2H intent.
 *
 * Returns null when the intent cannot be rendered inline (e.g., free-text
 * COLLECT without options — should fall back to method 2 or method 3).
 */
export function buildA2HComponents(
  intent: A2HMessage
): APIActionRowComponent<APIMessageActionRowComponent>[] | null {
  switch (intent.intent as A2HIntent) {
    case "AUTHORIZE": {
      return [buildAuthorizeButtons(intent.intentId)];
    }

    case "COLLECT": {
      const options = intent.context.options as
        | Array<{ label: string; value: string }>
        | undefined;
      if (options && options.length > 0) {
        return [buildSelectMenu(options, intent.context.question as string | undefined, intent.intentId)];
      }
      // Free-text COLLECT — cannot render inline; caller should use method 2/3
      return null;
    }

    case "INFORM":
    case "ESCALATE":
    case "RESULT":
      // These don't require interaction components
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Interaction ID parser
// ---------------------------------------------------------------------------

/**
 * Parse the intentId from a Discord component customId.
 * Returns null if the customId is not an OpenThreads A2H component.
 */
export function parseA2HCustomId(customId: string): {
  type: "approve" | "deny" | "select";
  intentId: string | undefined;
} | null {
  if (customId.startsWith(APPROVE_CUSTOM_ID)) {
    const parts = customId.split(":");
    return { type: "approve", intentId: parts[1] };
  }
  if (customId.startsWith(DENY_CUSTOM_ID)) {
    const parts = customId.split(":");
    return { type: "deny", intentId: parts[1] };
  }
  if (customId.startsWith(SELECT_CUSTOM_ID_PREFIX)) {
    const parts = customId.split(":");
    return { type: "select", intentId: parts[1] };
  }
  return null;
}
