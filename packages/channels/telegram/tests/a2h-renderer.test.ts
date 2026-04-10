/**
 * Unit tests for the A2H intent renderer.
 *
 * The renderer makes HTTP calls to the Telegram API. Tests use a mock
 * TelegramApiClient to avoid real network calls.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  encodeA2HCallbackData,
  decodeA2HCallbackData,
  captureA2HResponse,
} from "../src/a2h-renderer.js";
import { renderA2HIntent } from "../src/a2h-renderer.js";
import type { TelegramApiClient } from "../src/api-client.js";
import type { AuthorizeIntent, CollectIntent, InformIntent } from "@openthreads/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockApi(messageId = 99): TelegramApiClient {
  return {
    sendMessage: mock(async () => ({
      message_id: messageId,
      chat: { id: 100, type: "private" },
      date: 1700000000,
    })),
    answerCallbackQuery: mock(async () => true),
    setWebhook: mock(async () => true),
    deleteWebhook: mock(async () => true),
    getMe: mock(async () => ({ id: 1, username: "testbot", first_name: "Test" })),
  } as unknown as TelegramApiClient;
}

// ---------------------------------------------------------------------------
// encodeA2HCallbackData / decodeA2HCallbackData
// ---------------------------------------------------------------------------

describe("encodeA2HCallbackData", () => {
  it("encodes and decodes symmetrically", () => {
    const encoded = encodeA2HCallbackData("turn-123", "APPROVED");
    const decoded = decodeA2HCallbackData(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.tid).toBe("turn-123");
    expect(decoded!.v).toBe("APPROVED");
    expect(decoded!.t).toBe("a");
  });

  it("throws if the payload exceeds 64 bytes", () => {
    const longTurnId = "a".repeat(100);
    expect(() => encodeA2HCallbackData(longTurnId, "APPROVED")).toThrow();
  });
});

describe("decodeA2HCallbackData", () => {
  it("returns null for invalid JSON", () => {
    expect(decodeA2HCallbackData("not-json")).toBeNull();
  });

  it("returns null for non-A2H payload", () => {
    expect(decodeA2HCallbackData('{"t":"other"}')).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeA2HCallbackData("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderA2HIntent
// ---------------------------------------------------------------------------

describe("renderA2HIntent", () => {
  describe("AUTHORIZE", () => {
    it("renders an inline keyboard with APPROVE and DENY buttons", async () => {
      const api = makeMockApi(42);
      const intent: AuthorizeIntent = {
        intent: "AUTHORIZE",
        turnId: "turn-1",
        context: { action: "deploy-to-prod", details: "Branch main → production" },
      };

      const result = await renderA2HIntent(api, "100", intent);

      expect(result.method).toBe("inline");
      expect(result.messageId).toBe("42");
      expect(api.sendMessage).toHaveBeenCalledTimes(1);

      const callArgs = (api.sendMessage as ReturnType<typeof mock>).mock.calls[0]![0];
      const markup = callArgs.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
      expect(markup.inline_keyboard).toHaveLength(1);
      const buttons = markup.inline_keyboard[0]!;
      expect(buttons.some((b) => b.text.includes("Approve"))).toBe(true);
      expect(buttons.some((b) => b.text.includes("Deny"))).toBe(true);

      // Verify callback data encodes the turnId
      const approveBtn = buttons.find((b) => b.text.includes("Approve"))!;
      const decoded = decodeA2HCallbackData(approveBtn.callback_data);
      expect(decoded!.tid).toBe("turn-1");
      expect(decoded!.v).toBe("APPROVED");
    });

    it("passes replyToMessageId when provided", async () => {
      const api = makeMockApi();
      const intent: AuthorizeIntent = {
        intent: "AUTHORIZE",
        turnId: "t1",
        context: { action: "test" },
      };
      await renderA2HIntent(api, "100", intent, "77");
      const callArgs = (api.sendMessage as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArgs.reply_to_message_id).toBe(77);
    });
  });

  describe("COLLECT with options", () => {
    it("renders an inline keyboard with one button per option", async () => {
      const api = makeMockApi();
      const intent: CollectIntent = {
        intent: "COLLECT",
        turnId: "turn-2",
        context: { question: "Which env?", options: ["staging", "prod", "local"] },
      };

      const result = await renderA2HIntent(api, "100", intent);

      expect(result.method).toBe("inline");
      const callArgs = (api.sendMessage as ReturnType<typeof mock>).mock.calls[0]![0];
      const markup = callArgs.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> };
      const allButtons = markup.inline_keyboard.flat();
      expect(allButtons.map((b) => b.text)).toContain("staging");
      expect(allButtons.map((b) => b.text)).toContain("prod");
      expect(allButtons.map((b) => b.text)).toContain("local");
    });
  });

  describe("COLLECT free-text", () => {
    it("renders a question message with reply capture", async () => {
      const api = makeMockApi();
      const intent: CollectIntent = {
        intent: "COLLECT",
        turnId: "turn-3",
        context: { question: "What is your name?" },
      };

      const result = await renderA2HIntent(api, "100", intent);

      expect(result.method).toBe("reply-capture");
      const callArgs = (api.sendMessage as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArgs.text).toContain("What is your name?");
      expect(callArgs.reply_markup).toBeUndefined();
    });
  });

  describe("INFORM", () => {
    it("renders a plain notification", async () => {
      const api = makeMockApi();
      const intent: InformIntent = {
        intent: "INFORM",
        turnId: "turn-4",
        context: { message: "Deploy completed successfully." },
      };

      const result = await renderA2HIntent(api, "100", intent);

      expect(result.method).toBe("inline");
      const callArgs = (api.sendMessage as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArgs.text).toContain("Deploy completed successfully.");
    });
  });
});

// ---------------------------------------------------------------------------
// captureA2HResponse
// ---------------------------------------------------------------------------

describe("captureA2HResponse", () => {
  describe("method 1: callback_query", () => {
    it("captures AUTHORIZE response via callback query", () => {
      const callbackData = encodeA2HCallbackData("turn-1", "APPROVED");
      const payload = {
        update_id: 1,
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          message: { message_id: 99, chat: { id: 100, type: "private" }, date: 1700000000 },
          chat_instance: "abc",
          data: callbackData,
        },
      };

      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).not.toBeNull();
      expect(response!.turnId).toBe("turn-1");
      expect(response!.response).toBe("APPROVED");
    });

    it("returns null when callback data belongs to a different turn", () => {
      const callbackData = encodeA2HCallbackData("turn-X", "APPROVED");
      const payload = {
        update_id: 1,
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat_instance: "abc",
          data: callbackData,
        },
      };
      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).toBeNull();
    });

    it("returns null when callback data is not an A2H payload", () => {
      const payload = {
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat_instance: "abc",
          data: '{"action":"other"}',
        },
      };
      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).toBeNull();
    });
  });

  describe("method 2: reply-to message", () => {
    it("captures free-text COLLECT response via reply", () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 200,
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat: { id: 100, type: "private" },
          date: 1700000001,
          text: "My free-text answer",
          reply_to_message: {
            message_id: 99,
            chat: { id: 100, type: "private" },
            date: 1700000000,
          },
        },
      };

      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).not.toBeNull();
      expect(response!.turnId).toBe("turn-1");
      expect(response!.response).toBe("My free-text answer");
    });

    it("returns null when the reply is to a different message", () => {
      const payload = {
        message: {
          message_id: 200,
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat: { id: 100, type: "private" },
          date: 1700000001,
          text: "irrelevant",
          reply_to_message: {
            message_id: 50, // different from pendingMessageId=99
            chat: { id: 100, type: "private" },
            date: 1700000000,
          },
        },
      };
      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).toBeNull();
    });

    it("returns null for a message without a reply", () => {
      const payload = {
        message: {
          message_id: 200,
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat: { id: 100, type: "private" },
          date: 1700000001,
          text: "no reply",
        },
      };
      const response = captureA2HResponse(payload, "turn-1", "99");
      expect(response).toBeNull();
    });
  });

  it("returns null for a non-object payload", () => {
    expect(captureA2HResponse(null, "t", "m")).toBeNull();
    expect(captureA2HResponse("string", "t", "m")).toBeNull();
  });
});
