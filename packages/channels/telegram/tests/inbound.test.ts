/**
 * Unit tests for the Telegram inbound message parser.
 */

import { describe, it, expect } from "bun:test";
import { InMemoryThreadStore } from "../src/thread-store.js";
import {
  parseUpdateAsInbound,
  parseUpdateAsCallbackQuery,
  isCommand,
  parseCommand,
} from "../src/inbound.js";
import type { TelegramUpdate } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextUpdate(overrides: Partial<{
  messageId: number;
  chatId: number;
  chatType: "private" | "group" | "supergroup" | "channel";
  userId: number;
  firstName: string;
  username: string;
  text: string;
  replyToMessageId: number;
}>): TelegramUpdate {
  const {
    messageId = 1,
    chatId = 100,
    chatType = "private",
    userId = 42,
    firstName = "Alice",
    username = "alice",
    text = "Hello",
    replyToMessageId,
  } = overrides;

  return {
    update_id: 999,
    message: {
      message_id: messageId,
      from: {
        id: userId,
        is_bot: false,
        first_name: firstName,
        username,
      },
      chat: { id: chatId, type: chatType },
      date: 1700000000,
      text,
      reply_to_message: replyToMessageId !== undefined
        ? {
            message_id: replyToMessageId,
            chat: { id: chatId, type: chatType },
            date: 1700000000,
          }
        : undefined,
    },
  };
}

function makeCallbackQueryUpdate(overrides: Partial<{
  queryId: string;
  userId: number;
  firstName: string;
  chatId: number;
  messageId: number;
  data: string;
}>): TelegramUpdate {
  const {
    queryId = "cq1",
    userId = 42,
    firstName = "Alice",
    chatId = 100,
    messageId = 5,
    data = "test-data",
  } = overrides;

  return {
    update_id: 999,
    callback_query: {
      id: queryId,
      from: { id: userId, is_bot: false, first_name: firstName },
      message: {
        message_id: messageId,
        chat: { id: chatId, type: "private" },
        date: 1700000000,
      },
      chat_instance: "abc",
      data,
    },
  };
}

// ---------------------------------------------------------------------------
// parseUpdateAsInbound
// ---------------------------------------------------------------------------

describe("parseUpdateAsInbound", () => {
  it("parses a simple text message", () => {
    const store = new InMemoryThreadStore();
    const update = makeTextUpdate({ text: "Hello world", chatId: 100, messageId: 1 });
    const msg = parseUpdateAsInbound(update, "tg-main", store);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Hello world");
    expect(msg!.chatId).toBe("100");
    expect(msg!.channel).toBe("tg-main");
    expect(msg!.sender.id).toBe("42");
    expect(msg!.sender.name).toBe("Alice");
    expect(msg!.sender.username).toBe("alice");
    expect(msg!.threadId).toMatch(/^ot_thr_/);
    expect(msg!.attachments).toBeUndefined();
  });

  it("assigns the same threadId to a reply as to the original message", () => {
    const store = new InMemoryThreadStore();
    const msg1 = parseUpdateAsInbound(
      makeTextUpdate({ messageId: 1, chatId: 100, text: "Original" }),
      "tg",
      store,
    );
    const msg2 = parseUpdateAsInbound(
      makeTextUpdate({ messageId: 2, chatId: 100, text: "Reply", replyToMessageId: 1 }),
      "tg",
      store,
    );

    expect(msg1).not.toBeNull();
    expect(msg2).not.toBeNull();
    expect(msg1!.threadId).toBe(msg2!.threadId);
  });

  it("assigns a different threadId to a non-reply message", () => {
    const store = new InMemoryThreadStore();
    const msg1 = parseUpdateAsInbound(
      makeTextUpdate({ messageId: 1, chatId: 100, text: "First" }),
      "tg",
      store,
    );
    const msg2 = parseUpdateAsInbound(
      makeTextUpdate({ messageId: 2, chatId: 100, text: "Second" }),
      "tg",
      store,
    );

    expect(msg1!.threadId).not.toBe(msg2!.threadId);
  });

  it("returns null for a callback_query update", () => {
    const store = new InMemoryThreadStore();
    const update = makeCallbackQueryUpdate({});
    const msg = parseUpdateAsInbound(update, "tg", store);
    expect(msg).toBeNull();
  });

  it("parses a photo message", () => {
    const store = new InMemoryThreadStore();
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 1, is_bot: false, first_name: "Bob" },
        chat: { id: 200, type: "private" },
        date: 1700000000,
        caption: "Look at this",
        photo: [
          { file_id: "small", file_unique_id: "u1", width: 90, height: 90, file_size: 100 },
          { file_id: "large", file_unique_id: "u2", width: 800, height: 600, file_size: 50000 },
        ],
      },
    };

    const msg = parseUpdateAsInbound(update, "tg", store);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Look at this");
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments![0]!.type).toBe("image");
    expect(msg!.attachments![0]!.fileId).toBe("large"); // largest selected
  });

  it("returns null for a message with no usable content", () => {
    const store = new InMemoryThreadStore();
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false, first_name: "Bot" },
        chat: { id: 1, type: "private" },
        date: 1700000000,
        // No text, no attachments
      },
    };
    const msg = parseUpdateAsInbound(update, "tg", store);
    expect(msg).toBeNull();
  });

  it("returns null for a message with no sender (service message)", () => {
    const store = new InMemoryThreadStore();
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        // no `from`
        chat: { id: 1, type: "group" },
        date: 1700000000,
        text: "A service message",
      },
    };
    const msg = parseUpdateAsInbound(update, "tg", store);
    expect(msg).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseUpdateAsCallbackQuery
// ---------------------------------------------------------------------------

describe("parseUpdateAsCallbackQuery", () => {
  it("parses a callback query", () => {
    const update = makeCallbackQueryUpdate({
      queryId: "cq99",
      userId: 7,
      firstName: "Bob",
      chatId: 200,
      messageId: 5,
      data: "some_data",
    });

    const cq = parseUpdateAsCallbackQuery(update);
    expect(cq).not.toBeNull();
    expect(cq!.id).toBe("cq99");
    expect(cq!.data).toBe("some_data");
    expect(cq!.sender.id).toBe("7");
    expect(cq!.chatId).toBe("200");
    expect(cq!.originMessageId).toBe("5");
  });

  it("returns null for a message update", () => {
    const update = makeTextUpdate({ text: "Hello" });
    const cq = parseUpdateAsCallbackQuery(update);
    expect(cq).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isCommand / parseCommand
// ---------------------------------------------------------------------------

describe("isCommand", () => {
  it("detects /start command", () => {
    const update = makeTextUpdate({ text: "/start" });
    update.message!.entities = [{ type: "bot_command", offset: 0, length: 6 }];
    expect(isCommand(update)).toBe(true);
  });

  it("returns false for a plain message", () => {
    const update = makeTextUpdate({ text: "hello" });
    expect(isCommand(update)).toBe(false);
  });

  it("returns false for a command not at offset 0", () => {
    const update = makeTextUpdate({ text: "run /start" });
    update.message!.entities = [{ type: "bot_command", offset: 4, length: 6 }];
    expect(isCommand(update)).toBe(false);
  });
});

describe("parseCommand", () => {
  it("parses /start with no args", () => {
    const update = makeTextUpdate({ text: "/start" });
    update.message!.entities = [{ type: "bot_command", offset: 0, length: 6 }];
    const result = parseCommand(update);
    expect(result).not.toBeNull();
    expect(result!.command).toBe("/start");
    expect(result!.args).toEqual([]);
  });

  it("parses /connect botname with args", () => {
    const update = makeTextUpdate({ text: "/connect arg1 arg2" });
    update.message!.entities = [{ type: "bot_command", offset: 0, length: 8 }];
    const result = parseCommand(update);
    expect(result!.command).toBe("/connect");
    expect(result!.args).toEqual(["arg1", "arg2"]);
  });

  it("strips @botname suffix from command token", () => {
    const update = makeTextUpdate({ text: "/start@mybot arg1" });
    update.message!.entities = [{ type: "bot_command", offset: 0, length: 13 }];
    const result = parseCommand(update);
    expect(result!.command).toBe("/start");
    expect(result!.args).toEqual(["arg1"]);
  });

  it("returns null for a non-command update", () => {
    const update = makeTextUpdate({ text: "hello" });
    expect(parseCommand(update)).toBeNull();
  });
});
