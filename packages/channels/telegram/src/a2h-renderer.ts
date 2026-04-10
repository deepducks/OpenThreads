/**
 * A2H intent renderer for the Telegram adapter.
 *
 * Telegram capabilities:
 *   threads: false       → no native thread support
 *   buttons: true        → inline keyboards (method 1)
 *   selectMenus: false   → no native select menus
 *   replyMessages: true  → method 2 (reply-to capture)
 *   dms: true            → implicit DM capture
 *
 * Render strategy:
 *   AUTHORIZE            → method 1 (inline keyboard: APPROVE / DENY)
 *   COLLECT w/ options   → method 1 (inline keyboard: one button per option)
 *   COLLECT free-text    → method 2 (question sent, reply-to captured)
 *   INFORM               → plain message, no response expected
 */

import type {
  A2HIntent,
  A2HIntentBase,
  A2HRenderResult,
  A2HResponse,
  AuthorizeIntent,
  CollectIntent,
  InformIntent,
} from "@openthreads/core";
import type { TelegramApiClient } from "./api-client.js";
import type { A2HCallbackData, SendMessageParams } from "./types.js";

// ---------------------------------------------------------------------------
// Callback data helpers
// ---------------------------------------------------------------------------

const MAX_CALLBACK_DATA_BYTES = 64;

/**
 * Encode an A2H callback payload into a compact string.
 * Format: "a|<turnId>|<value>"
 * The turnId is abbreviated to keep within the 64-byte limit.
 */
export function encodeA2HCallbackData(turnId: string, value: string): string {
  const payload: A2HCallbackData = { t: "a", tid: turnId, v: value };
  const encoded = JSON.stringify(payload);
  if (new TextEncoder().encode(encoded).length > MAX_CALLBACK_DATA_BYTES) {
    throw new Error(
      `A2H callback data exceeds ${MAX_CALLBACK_DATA_BYTES} bytes. ` +
        `Consider shortening the turnId or value. Encoded: ${encoded}`,
    );
  }
  return encoded;
}

/**
 * Decode an A2H callback data string.
 * Returns null if the data is not a valid A2H payload.
 */
export function decodeA2HCallbackData(data: string): A2HCallbackData | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "t" in parsed &&
      (parsed as A2HCallbackData).t === "a"
    ) {
      return parsed as A2HCallbackData;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely add reply_to_message_id to sendMessage params only when defined.
 * Required because exactOptionalPropertyTypes prevents assigning undefined
 * to an optional property in an object literal.
 */
function withReplyTo(
  base: SendMessageParams,
  replyToMessageId?: string,
): SendMessageParams {
  if (replyToMessageId === undefined) return base;
  return { ...base, reply_to_message_id: Number(replyToMessageId) };
}

// ---------------------------------------------------------------------------
// Renderers by intent type
// ---------------------------------------------------------------------------

async function renderAuthorize(
  api: TelegramApiClient,
  chatId: string,
  intent: AuthorizeIntent,
  replyToMessageId?: string,
): Promise<A2HRenderResult> {
  const { action, details } = intent.context;
  const evidenceLines = intent.context.evidence
    ? Object.entries(intent.context.evidence)
        .map(([k, v]) => `  • ${k}: ${String(v)}`)
        .join("\n")
    : undefined;

  const lines = [
    `🔐 *Authorization Required*`,
    ``,
    `*Action:* ${escapeMarkdown(action)}`,
    details !== undefined ? `*Details:* ${escapeMarkdown(details)}` : null,
    evidenceLines !== undefined ? `*Evidence:*\n${evidenceLines}` : null,
  ].filter((l): l is string => l !== null);

  const approveData = encodeA2HCallbackData(intent.turnId, "APPROVED");
  const denyData = encodeA2HCallbackData(intent.turnId, "DENIED");

  const msg = await api.sendMessage(
    withReplyTo(
      {
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: approveData },
              { text: "❌ Deny", callback_data: denyData },
            ],
          ],
        },
      },
      replyToMessageId,
    ),
  );

  return {
    messageId: String(msg.message_id),
    method: "inline",
  };
}

async function renderCollectWithOptions(
  api: TelegramApiClient,
  chatId: string,
  intent: CollectIntent,
  options: string[],
  replyToMessageId?: string,
): Promise<A2HRenderResult> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  // Group options into rows of at most 3 buttons each
  for (let i = 0; i < options.length; i += 3) {
    const row = options.slice(i, i + 3).map((opt) => ({
      text: opt,
      callback_data: encodeA2HCallbackData(intent.turnId, opt),
    }));
    rows.push(row);
  }

  const msg = await api.sendMessage(
    withReplyTo(
      { chat_id: chatId, text: intent.context.question, reply_markup: { inline_keyboard: rows } },
      replyToMessageId,
    ),
  );

  return {
    messageId: String(msg.message_id),
    method: "inline",
  };
}

async function renderCollectFreeText(
  api: TelegramApiClient,
  chatId: string,
  intent: CollectIntent,
  replyToMessageId?: string,
): Promise<A2HRenderResult> {
  const text =
    `💬 *${escapeMarkdown(intent.context.question)}*\n\n` +
    `_Reply to this message with your answer._`;

  const msg = await api.sendMessage(
    withReplyTo({ chat_id: chatId, text, parse_mode: "Markdown" }, replyToMessageId),
  );

  return {
    messageId: String(msg.message_id),
    method: "reply-capture",
  };
}

async function renderInform(
  api: TelegramApiClient,
  chatId: string,
  intent: InformIntent,
  replyToMessageId?: string,
): Promise<A2HRenderResult> {
  const msg = await api.sendMessage(
    withReplyTo(
      { chat_id: chatId, text: `ℹ️ ${intent.context.message}` },
      replyToMessageId,
    ),
  );

  return {
    messageId: String(msg.message_id),
    method: "inline",
  };
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Render an A2H intent as an interactive message in Telegram.
 * Selects the best method based on Telegram capabilities.
 */
export async function renderA2HIntent(
  api: TelegramApiClient,
  chatId: string,
  intent: A2HIntent,
  replyToMessageId?: string,
): Promise<A2HRenderResult> {
  switch (intent.intent) {
    case "AUTHORIZE":
      return renderAuthorize(api, chatId, intent as AuthorizeIntent, replyToMessageId);

    case "COLLECT": {
      const collectIntent = intent as CollectIntent;
      if (
        collectIntent.context.options !== undefined &&
        collectIntent.context.options.length > 0
      ) {
        return renderCollectWithOptions(
          api,
          chatId,
          collectIntent,
          collectIntent.context.options,
          replyToMessageId,
        );
      }
      return renderCollectFreeText(api, chatId, collectIntent, replyToMessageId);
    }

    case "INFORM":
      return renderInform(api, chatId, intent as InformIntent, replyToMessageId);

    default: {
      // Fallback: send as plain text notification
      const msg = await api.sendMessage(
        withReplyTo(
          {
            chat_id: chatId,
            text: `[A2H ${intent.intent}] ${JSON.stringify((intent as A2HIntentBase).context ?? {})}`,
          },
          replyToMessageId,
        ),
      );
      return { messageId: String(msg.message_id), method: "inline" };
    }
  }
}

/**
 * Attempt to capture an A2H response from an inbound payload.
 *
 * Two capture paths:
 *  1. Callback query (method 1) — data is a JSON A2H payload
 *  2. Reply-to message (method 2) — message replies to the intent message
 */
export function captureA2HResponse(
  payload: unknown,
  pendingTurnId: string,
  pendingMessageId: string,
): A2HResponse | null {
  if (typeof payload !== "object" || payload === null) return null;

  const update = payload as Record<string, unknown>;

  // Method 1: callback_query
  if (update["callback_query"] !== undefined) {
    const cq = update["callback_query"] as Record<string, unknown>;
    const data = typeof cq["data"] === "string" ? cq["data"] : null;
    if (data === null) return null;

    const decoded = decodeA2HCallbackData(data);
    if (decoded === null || decoded.tid !== pendingTurnId) return null;

    return {
      turnId: pendingTurnId,
      intent: "COLLECT", // will be overridden by the caller if AUTHORIZE
      response: decoded.v,
      respondedAt: new Date(),
    };
  }

  // Method 2: reply-to message
  if (update["message"] !== undefined) {
    const msg = update["message"] as Record<string, unknown>;
    const replyTo = msg["reply_to_message"] as Record<string, unknown> | undefined;
    if (replyTo === undefined) return null;

    const repliedToId = String(replyTo["message_id"]);
    if (repliedToId !== pendingMessageId) return null;

    return {
      turnId: pendingTurnId,
      intent: "COLLECT",
      response: msg["text"] ?? null,
      respondedAt: new Date(),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeMarkdown(text: string): string {
  // Escape Markdown special chars (legacy mode, not MarkdownV2)
  return text.replace(/([_*[\]`])/g, "\\$1");
}

