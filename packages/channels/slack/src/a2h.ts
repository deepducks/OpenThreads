/**
 * A2H intent → Slack Block Kit rendering.
 *
 * Handles:
 *  - AUTHORIZE  → approve/deny buttons (method 1)
 *  - COLLECT with options  → static_select menu (method 1)
 *  - COLLECT free-text     → question text + thread capture (method 2)
 *  - INFORM                → plain text message
 */

import type {
  A2HAuthorize,
  A2HCollect,
  A2HInform,
} from "@openthreads/core";

// ---------------------------------------------------------------------------
// Slack Block Kit type aliases (minimal surface — avoid heavy SDK dependency)
// ---------------------------------------------------------------------------

export type SlackBlock = Record<string, unknown>;
export type SlackAttachment = Record<string, unknown>;

export interface SlackMessagePayload {
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

// ---------------------------------------------------------------------------
// Block Kit constants
// ---------------------------------------------------------------------------

const ACTION_AUTHORIZE_PREFIX = "ot_authorize";
const ACTION_COLLECT_PREFIX = "ot_collect";

// ---------------------------------------------------------------------------
// AUTHORIZE → approve/deny buttons
// ---------------------------------------------------------------------------

/**
 * Render an A2H AUTHORIZE intent as a Slack message with Block Kit buttons.
 *
 * The action IDs encode the requestId so that the interaction handler can
 * resolve which pending request was answered.
 */
export function renderAuthorize(intent: A2HAuthorize): SlackMessagePayload {
  const { requestId, context } = intent;

  const headerText =
    `*Authorization Required*\n` +
    `Action: *${context.action}*` +
    (context.details ? `\n${context.details}` : "");

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: headerText,
      },
    },
  ];

  if (context.evidence && Object.keys(context.evidence).length > 0) {
    const evidenceFields = Object.entries(context.evidence).map(
      ([key, value]) => ({
        type: "mrkdwn",
        text: `*${key}:*\n${String(value)}`,
      })
    );
    blocks.push({
      type: "section",
      fields: evidenceFields,
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          value: "approved",
          action_id: `${ACTION_AUTHORIZE_PREFIX}__approved__${requestId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Deny", emoji: true },
          style: "danger",
          value: "denied",
          action_id: `${ACTION_AUTHORIZE_PREFIX}__denied__${requestId}`,
        },
      ],
    }
  );

  return {
    text: `Authorization required: ${context.action}`,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// COLLECT with options → static_select
// ---------------------------------------------------------------------------

/**
 * Render an A2H COLLECT intent (with options) as a Slack static select menu.
 */
export function renderCollectWithOptions(
  intent: A2HCollect & { options: string[] }
): SlackMessagePayload {
  const { requestId, question, options } = intent;

  const optionElements = options.map((opt) => ({
    text: { type: "plain_text", text: opt, emoji: false },
    value: opt,
  }));

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: question },
    },
    {
      type: "actions",
      elements: [
        {
          type: "static_select",
          placeholder: { type: "plain_text", text: "Select an option" },
          options: optionElements,
          action_id: `${ACTION_COLLECT_PREFIX}__${requestId}`,
        },
      ],
    },
  ];

  return {
    text: question,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// COLLECT free-text → question text (method 2 — capture thread reply)
// ---------------------------------------------------------------------------

/**
 * Render an A2H COLLECT intent (free-text) as a question in Slack.
 *
 * The response is captured by listening for the next reply in the same thread.
 * Returns the message payload; the caller is responsible for posting it and
 * registering a thread-reply listener.
 */
export function renderCollectFreeText(intent: A2HCollect): SlackMessagePayload {
  const { question } = intent;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${question}\n\n_Reply in this thread to answer._`,
      },
    },
  ];

  return {
    text: question,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// INFORM → plain text notification
// ---------------------------------------------------------------------------

/**
 * Render an A2H INFORM intent as a simple Slack message.
 */
export function renderInform(intent: A2HInform): SlackMessagePayload {
  return {
    text: intent.message,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: intent.message },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Action ID parsing helpers
// ---------------------------------------------------------------------------

/** Result of parsing an AUTHORIZE action_id */
export interface AuthorizeActionPayload {
  type: "authorize";
  approved: boolean;
  requestId: string;
}

/** Result of parsing a COLLECT action_id */
export interface CollectActionPayload {
  type: "collect";
  requestId: string;
  value: string;
}

export type ParsedActionPayload = AuthorizeActionPayload | CollectActionPayload;

/**
 * Parse a Slack action_id back into a structured payload.
 *
 * Returns null if the action_id is not an OpenThreads action.
 */
export function parseActionId(
  actionId: string,
  selectedValue?: string
): ParsedActionPayload | null {
  if (actionId.startsWith(`${ACTION_AUTHORIZE_PREFIX}__`)) {
    const parts = actionId.split("__");
    // parts: ["ot_authorize", "approved"|"denied", requestId]
    if (parts.length < 3) return null;
    const decision = parts[1];
    const requestId = parts.slice(2).join("__");
    return {
      type: "authorize",
      approved: decision === "approved",
      requestId,
    };
  }

  if (actionId.startsWith(`${ACTION_COLLECT_PREFIX}__`)) {
    const parts = actionId.split("__");
    // parts: ["ot_collect", requestId]
    if (parts.length < 2) return null;
    const requestId = parts.slice(1).join("__");
    return {
      type: "collect",
      requestId,
      value: selectedValue ?? "",
    };
  }

  return null;
}
