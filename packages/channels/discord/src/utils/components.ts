/**
 * Discord embed and component builders for A2H intents.
 *
 * All button/select customId values encode the intent ID so the interaction
 * handler can look up the pending resolver without fragile parsing.
 *
 * customId conventions:
 *   - Approve button:  `a2h_approve_<intentId>`
 *   - Deny button:     `a2h_deny_<intentId>`
 *   - Select menu:     `a2h_collect_select_<intentId>`
 */

// ---------------------------------------------------------------------------
// Minimal Discord component shape types
// (avoids importing discord.js builders in tests; actual adapter uses discord.js)
// ---------------------------------------------------------------------------

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
}

export interface DiscordButton {
  type: 2; // ComponentType.Button
  style: number;
  label: string;
  custom_id: string;
}

export interface DiscordStringSelectOption {
  label: string;
  value: string;
}

export interface DiscordStringSelectMenu {
  type: 3; // ComponentType.StringSelect
  custom_id: string;
  placeholder?: string;
  options: DiscordStringSelectOption[];
}

export interface DiscordActionRow<T = DiscordButton | DiscordStringSelectMenu> {
  type: 1; // ComponentType.ActionRow
  components: T[];
}

// Discord embed colour palette
const COLORS = {
  authorize: 0xed4245, // red
  collect: 0x5865f2,   // blurple
  inform: 0x57f287,    // green
  resolved: 0x2f3136,  // dark grey
} as const;

// ---------------------------------------------------------------------------
// AUTHORIZE intent
// ---------------------------------------------------------------------------

export interface A2HAuthorizeContext {
  action: string;
  details?: string;
  [key: string]: unknown;
}

export interface A2HAuthorizeIntentShape {
  intent: 'AUTHORIZE';
  id: string;
  context: A2HAuthorizeContext;
}

/**
 * Builds the embed payload for an AUTHORIZE intent.
 */
export function buildAuthorizeEmbed(intent: A2HAuthorizeIntentShape): DiscordEmbed {
  const fields: EmbedField[] = [
    { name: 'Action', value: intent.context.action, inline: false },
  ];

  if (intent.context.details) {
    fields.push({ name: 'Details', value: intent.context.details, inline: false });
  }

  return {
    title: '🔐 Authorization Required',
    color: COLORS.authorize,
    fields,
    footer: { text: `Intent ID: ${intent.id}` },
  };
}

/**
 * Builds the action row with Approve / Deny buttons.
 */
export function buildAuthorizeComponents(
  intentId: string,
): DiscordActionRow<DiscordButton>[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3, // ButtonStyle.Success
          label: '✅ Approve',
          custom_id: `a2h_approve_${intentId}`,
        },
        {
          type: 2,
          style: 4, // ButtonStyle.Danger
          label: '❌ Deny',
          custom_id: `a2h_deny_${intentId}`,
        },
      ],
    },
  ];
}

/**
 * Embed shown after an AUTHORIZE is approved.
 */
export function buildApprovedEmbed(action: string): DiscordEmbed {
  return {
    title: '✅ Approved',
    description: action,
    color: COLORS.inform,
  };
}

/**
 * Embed shown after an AUTHORIZE is denied.
 */
export function buildDeniedEmbed(action: string): DiscordEmbed {
  return {
    title: '❌ Denied',
    description: action,
    color: COLORS.resolved,
  };
}

// ---------------------------------------------------------------------------
// COLLECT (select menu) intent
// ---------------------------------------------------------------------------

export interface A2HCollectOption {
  label: string;
  value: string;
}

export interface A2HCollectIntentShape {
  intent: 'COLLECT';
  id: string;
  question: string;
  options?: A2HCollectOption[];
}

/**
 * Builds the embed payload for a COLLECT intent.
 */
export function buildCollectEmbed(intent: A2HCollectIntentShape): DiscordEmbed {
  return {
    title: '📋 Input Required',
    description: intent.question,
    color: COLORS.collect,
    footer: { text: `Intent ID: ${intent.id}` },
  };
}

/**
 * Builds the action row with a StringSelectMenu for COLLECT with options.
 */
export function buildCollectSelectComponents(
  intent: A2HCollectIntentShape,
): DiscordActionRow<DiscordStringSelectMenu>[] {
  if (!intent.options || intent.options.length === 0) {
    throw new Error('buildCollectSelectComponents requires at least one option');
  }

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `a2h_collect_select_${intent.id}`,
          placeholder: 'Select an option…',
          options: intent.options.map((opt) => ({
            label: opt.label,
            value: opt.value,
          })),
        },
      ],
    },
  ];
}

/**
 * Embed shown after a COLLECT select is resolved.
 */
export function buildCollectResponseEmbed(question: string, answer: string): DiscordEmbed {
  return {
    title: '✅ Response Recorded',
    color: COLORS.inform,
    fields: [
      { name: 'Question', value: question, inline: false },
      { name: 'Answer', value: answer, inline: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// INFORM intent
// ---------------------------------------------------------------------------

export interface A2HInformIntentShape {
  intent: 'INFORM';
  id: string;
  text: string;
}

/**
 * Builds the embed payload for an INFORM intent.
 */
export function buildInformEmbed(intent: A2HInformIntentShape): DiscordEmbed {
  return {
    title: 'ℹ️ Notification',
    description: intent.text,
    color: COLORS.inform,
  };
}
