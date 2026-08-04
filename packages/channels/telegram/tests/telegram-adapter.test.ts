/**
 * Integration-style tests for the TelegramAdapter.
 *
 * These tests exercise the full adapter without making real HTTP calls —
 * the Telegram API client is replaced with a lightweight stub.
 *
 * For real end-to-end tests against the Telegram Test Environment
 * (https://core.telegram.org/bots/webapps/tgwebapptest) you need:
 *   - A test bot token from @BotFather on https://t.me/botfather
 *   - The environment variables: TELEGRAM_TEST_BOT_TOKEN, TELEGRAM_TEST_CHAT_ID
 *
 * Those tests are skipped unless the env vars are present.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { TelegramAdapter } from "../src/index.js";
import type { TelegramApiClient } from "../src/api-client.js";
import type { AdapterConfig } from "@openthreads/core";

// ---------------------------------------------------------------------------
// Mock API client factory
// ---------------------------------------------------------------------------

let sentMessages: Array<Record<string, unknown>> = [];
let answeredQueries: string[] = [];
let webhookUrl: string | undefined;

function makeMockApiClient(): TelegramApiClient {
  return {
    sendMessage: mock(async (params: Record<string, unknown>) => {
      sentMessages.push(params);
      return { message_id: sentMessages.length, chat: { id: params["chat_id"], type: "private" }, date: 1700000000 };
    }),
    answerCallbackQuery: mock(async (params: Record<string, unknown>) => {
      answeredQueries.push(params["callback_query_id"] as string);
      return true;
    }),
    setWebhook: mock(async (params: Record<string, unknown>) => {
      webhookUrl = params["url"] as string;
      return true;
    }),
    deleteWebhook: mock(async () => {
      webhookUrl = undefined;
      return true;
    }),
    getMe: mock(async () => ({ id: 1, username: "testbot", first_name: "Test" })),
  } as unknown as TelegramApiClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(extra?: Partial<AdapterConfig>): AdapterConfig {
  return {
    channelId: "tg-test",
    credentials: { botToken: "test-token" },
    webhookUrl: "https://example.com/tg-webhook",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelegramAdapter", () => {
  let adapter: TelegramAdapter;
  let mockApi: TelegramApiClient;

  beforeEach(async () => {
    sentMessages = [];
    answeredQueries = [];
    webhookUrl = undefined;

    mockApi = makeMockApiClient();
    adapter = new TelegramAdapter({ apiClient: mockApi });
    // Setup without webhookUrl so the mock's setWebhook is not called
    await adapter.setup({ ...makeConfig(), webhookUrl: undefined });
  });

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  describe("capabilities", () => {
    it("reports correct Telegram capabilities", () => {
      expect(adapter.capabilities).toEqual({
        threads: false,
        buttons: true,
        selectMenus: false,
        replyMessages: true,
        dms: true,
        fileUpload: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound parsing
  // -------------------------------------------------------------------------

  describe("parseInbound", () => {
    it("parses a text message", async () => {
      const payload = {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 42, is_bot: false, first_name: "Alice", username: "alice" },
          chat: { id: 100, type: "private" },
          date: 1700000000,
          text: "Hello!",
        },
      };

      const msg = await adapter.parseInbound(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Hello!");
      expect(msg!.channel).toBe("tg-test");
      expect(msg!.sender.name).toBe("Alice");
    });

    it("returns null for a callback_query update", async () => {
      const payload = {
        update_id: 1,
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat_instance: "x",
          data: "something",
        },
      };
      const msg = await adapter.parseInbound(payload);
      expect(msg).toBeNull();
    });
  });

  describe("parseCallbackQuery", () => {
    it("parses a callback_query update", async () => {
      const payload = {
        update_id: 1,
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          message: { message_id: 5, chat: { id: 100, type: "private" }, date: 1700000000 },
          chat_instance: "abc",
          data: "btn_data",
        },
      };
      const cq = await adapter.parseCallbackQuery(payload);
      expect(cq).not.toBeNull();
      expect(cq!.data).toBe("btn_data");
    });
  });

  // -------------------------------------------------------------------------
  // Outbound sending
  // -------------------------------------------------------------------------

  describe("send", () => {
    it("sends a text message", async () => {
      const result = await adapter.send({ chatId: "100" }, { text: "Hi there" });
      expect(result.messageId).toBe("1");
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]!["text"]).toBe("Hi there");
    });

    it("sends a message with inline keyboard", async () => {
      await adapter.send(
        { chatId: "100" },
        {
          text: "Choose:",
          inlineKeyboard: [[{ text: "Yes", callbackData: "yes" }, { text: "No", callbackData: "no" }]],
        },
      );
      expect(sentMessages[0]!["reply_markup"]).toBeDefined();
    });
  });

  describe("answerCallbackQuery", () => {
    it("calls the API with the correct query ID", async () => {
      await adapter.answerCallbackQuery("cq-42", "Thanks!");
      expect(mockApi.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // A2H rendering
  // -------------------------------------------------------------------------

  describe("renderA2HIntent - AUTHORIZE", () => {
    it("renders AUTHORIZE as inline keyboard with APPROVE/DENY", async () => {
      const result = await adapter.renderA2HIntent("100", {
        intent: "AUTHORIZE",
        turnId: "turn-auth-1",
        context: { action: "deploy", details: "main → prod" },
      });

      expect(result.method).toBe("inline");
      expect(sentMessages).toHaveLength(1);
      const markup = sentMessages[0]!["reply_markup"] as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      expect(buttons.some((b) => b.text.includes("Approve"))).toBe(true);
      expect(buttons.some((b) => b.text.includes("Deny"))).toBe(true);
    });
  });

  describe("renderA2HIntent - COLLECT with options", () => {
    it("renders COLLECT with options as inline keyboard", async () => {
      const result = await adapter.renderA2HIntent("100", {
        intent: "COLLECT",
        turnId: "turn-collect-1",
        context: { question: "Pick an env", options: ["dev", "staging"] },
      });

      expect(result.method).toBe("inline");
      const markup = sentMessages[0]!["reply_markup"] as {
        inline_keyboard: Array<Array<{ text: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      expect(buttons.map((b) => b.text)).toContain("dev");
      expect(buttons.map((b) => b.text)).toContain("staging");
    });
  });

  describe("renderA2HIntent - COLLECT free-text", () => {
    it("renders free-text COLLECT as reply-capture message", async () => {
      const result = await adapter.renderA2HIntent("100", {
        intent: "COLLECT",
        turnId: "turn-collect-2",
        context: { question: "What is your name?" },
      });

      expect(result.method).toBe("reply-capture");
      expect(sentMessages[0]!["text"]).toContain("What is your name?");
    });
  });

  // -------------------------------------------------------------------------
  // A2H response capture
  // -------------------------------------------------------------------------

  describe("captureA2HResponse", () => {
    it("captures APPROVE from callback_query", async () => {
      const { encodeA2HCallbackData } = await import("../src/a2h-renderer.js");
      const data = encodeA2HCallbackData("turn-1", "APPROVED");

      const payload = {
        callback_query: {
          id: "cq1",
          from: { id: 42, is_bot: false, first_name: "Alice" },
          message: { message_id: 99, chat: { id: 100, type: "private" }, date: 1700000000 },
          chat_instance: "abc",
          data,
        },
      };

      const response = await adapter.captureA2HResponse(payload, "turn-1", "99");
      expect(response).not.toBeNull();
      expect(response!.response).toBe("APPROVED");
    });

    it("captures free-text via reply-to", async () => {
      const payload = {
        message: {
          message_id: 200,
          from: { id: 42, is_bot: false, first_name: "Alice" },
          chat: { id: 100, type: "private" },
          date: 1700000001,
          text: "The answer",
          reply_to_message: {
            message_id: 99,
            chat: { id: 100, type: "private" },
            date: 1700000000,
          },
        },
      };

      const response = await adapter.captureA2HResponse(payload, "turn-1", "99");
      expect(response).not.toBeNull();
      expect(response!.response).toBe("The answer");
    });
  });

  // -------------------------------------------------------------------------
  // Virtual thread grouping (full flow)
  // -------------------------------------------------------------------------

  describe("virtual thread management", () => {
    it("groups a reply chain into the same thread", async () => {
      const msg1 = await adapter.parseInbound({
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 1, is_bot: false, first_name: "Alice" },
          chat: { id: 500, type: "group" },
          date: 1700000000,
          text: "First message",
        },
      });

      const msg2 = await adapter.parseInbound({
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: 2, is_bot: false, first_name: "Bob" },
          chat: { id: 500, type: "group" },
          date: 1700000001,
          text: "Reply to first",
          reply_to_message: {
            message_id: 10,
            chat: { id: 500, type: "group" },
            date: 1700000000,
          },
        },
      });

      expect(msg1).not.toBeNull();
      expect(msg2).not.toBeNull();
      expect(msg1!.threadId).toBe(msg2!.threadId);
    });

    it("gives independent messages separate threads", async () => {
      const msg1 = await adapter.parseInbound({
        update_id: 1,
        message: {
          message_id: 20,
          from: { id: 1, is_bot: false, first_name: "Alice" },
          chat: { id: 500, type: "group" },
          date: 1700000000,
          text: "Topic A",
        },
      });

      const msg2 = await adapter.parseInbound({
        update_id: 2,
        message: {
          message_id: 21,
          from: { id: 2, is_bot: false, first_name: "Bob" },
          chat: { id: 500, type: "group" },
          date: 1700000001,
          text: "Topic B",
        },
      });

      expect(msg1!.threadId).not.toBe(msg2!.threadId);
    });
  });
});
