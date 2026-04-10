/**
 * Block Kit builders for Slack.
 * Produces typed KnownBlock arrays for text messages, A2H AUTHORIZE, and A2H COLLECT.
 */

// We define minimal local types rather than depending on @slack/types directly.
export type PlainTextElement = {
  type: "plain_text";
  text: string;
  emoji?: boolean;
};

export type MrkdwnElement = {
  type: "mrkdwn";
  text: string;
};

export type SectionBlock = {
  type: "section";
  text: PlainTextElement | MrkdwnElement;
  accessory?: StaticSelectElement;
};

export type ActionsBlock = {
  type: "actions";
  elements: ButtonElement[];
};

export type DividerBlock = {
  type: "divider";
};

export type ContextBlock = {
  type: "context";
  elements: MrkdwnElement[];
};

export type ButtonElement = {
  type: "button";
  text: PlainTextElement;
  action_id: string;
  value?: string;
  style?: "primary" | "danger";
  confirm?: ConfirmDialog;
};

export type StaticSelectElement = {
  type: "static_select";
  placeholder: PlainTextElement;
  action_id: string;
  options: SelectOption[];
};

export type SelectOption = {
  text: PlainTextElement;
  value: string;
};

export type ConfirmDialog = {
  title: PlainTextElement;
  text: MrkdwnElement;
  confirm: PlainTextElement;
  deny: PlainTextElement;
};

export type KnownBlock =
  | SectionBlock
  | ActionsBlock
  | DividerBlock
  | ContextBlock;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Wraps plain text in a mrkdwn section block.
 * Suitable for outbound conventional messages.
 */
export function buildTextBlocks(text: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
  ];
}

/**
 * Builds Block Kit blocks for an A2H AUTHORIZE interaction.
 * Renders an Approve button (primary) and a Deny button (danger),
 * with a confirmation dialog on Approve.
 *
 * @param context  A2H context carrying action/details
 * @param requestId  Unique ID embedded in action_ids so callbacks can be matched
 */
export function buildAuthorizeBlocks(
  context: { action?: string; details?: string; [key: string]: unknown },
  requestId: string
): KnownBlock[] {
  const action = context.action ?? "Unknown action";
  const detailsLine = context.details ? `\n*Details:* ${context.details}` : "";

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:lock: *Authorization Required*\n*Action:* ${action}${detailsLine}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          action_id: `a2h_authorize_approve_${requestId}`,
          value: requestId,
          confirm: {
            title: { type: "plain_text", text: "Confirm Approval" },
            text: {
              type: "mrkdwn",
              text: `Are you sure you want to approve: *${action}*?`,
            },
            confirm: { type: "plain_text", text: "Yes, approve" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Deny", emoji: true },
          style: "danger",
          action_id: `a2h_authorize_deny_${requestId}`,
          value: requestId,
        },
      ],
    },
  ];

  return blocks;
}

/**
 * Builds Block Kit blocks for an A2H COLLECT interaction with closed options.
 * Renders a static_select menu.
 *
 * @param context  A2H context carrying question/options
 * @param requestId  Unique ID embedded in action_id
 */
export function buildSelectBlocks(
  context: {
    question?: string;
    options?: Array<{ label: string; value: string }>;
    [key: string]: unknown;
  },
  requestId: string
): KnownBlock[] {
  const opts = (context.options ?? []).map((opt) => ({
    text: { type: "plain_text" as const, text: opt.label },
    value: opt.value,
  }));

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: context.question ?? "Please select an option:",
      },
      accessory: {
        type: "static_select",
        placeholder: { type: "plain_text", text: "Select…" },
        action_id: `a2h_collect_select_${requestId}`,
        options: opts,
      },
    },
  ];
}
