/**
 * Unit tests for the Telegram outbound message formatter.
 */

import { describe, it, expect } from "bun:test";
import { buildSendMessageParams, escapeMarkdownV2 } from "../src/outbound.js";
import type { OutboundMessage } from "@openthreads/core";

describe("buildSendMessageParams", () => {
  it("builds plain text message", () => {
    const msg: OutboundMessage = { text: "Hello world" };
    const params = buildSendMessageParams(100, msg);
    expect(params.chat_id).toBe(100);
    expect(params.text).toBe("Hello world");
    expect(params.parse_mode).toBeUndefined();
    expect(params.reply_markup).toBeUndefined();
  });

  it("uses HTML parse mode when html is set", () => {
    const msg: OutboundMessage = { html: "<b>bold</b>" };
    const params = buildSendMessageParams(100, msg);
    expect(params.text).toBe("<b>bold</b>");
    expect(params.parse_mode).toBe("HTML");
  });

  it("uses MarkdownV2 parse mode when markdown is set", () => {
    const msg: OutboundMessage = { markdown: "*bold*" };
    const params = buildSendMessageParams(100, msg);
    expect(params.text).toBe("*bold*");
    expect(params.parse_mode).toBe("MarkdownV2");
  });

  it("html takes precedence over markdown and text", () => {
    const msg: OutboundMessage = {
      text: "plain",
      markdown: "*md*",
      html: "<b>html</b>",
    };
    const params = buildSendMessageParams(100, msg);
    expect(params.text).toBe("<b>html</b>");
    expect(params.parse_mode).toBe("HTML");
  });

  it("builds inline keyboard", () => {
    const msg: OutboundMessage = {
      text: "Choose:",
      inlineKeyboard: [
        [
          { text: "Yes", callbackData: "yes" },
          { text: "No", callbackData: "no" },
        ],
      ],
    };
    const params = buildSendMessageParams(100, msg);
    const markup = params.reply_markup as { inline_keyboard: unknown[][] };
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]).toHaveLength(2);
    expect((markup.inline_keyboard[0]![0] as { callback_data: string }).callback_data).toBe("yes");
  });

  it("builds reply keyboard", () => {
    const msg: OutboundMessage = {
      text: "Pick:",
      replyKeyboard: [
        [{ text: "Option A" }, { text: "Option B" }],
      ],
    };
    const params = buildSendMessageParams(100, msg);
    const markup = params.reply_markup as { keyboard: unknown[][], one_time_keyboard: boolean };
    expect(markup.keyboard).toHaveLength(1);
    expect(markup.one_time_keyboard).toBe(true);
  });

  it("builds remove keyboard", () => {
    const msg: OutboundMessage = { text: "Done", removeKeyboard: true };
    const params = buildSendMessageParams(100, msg);
    expect(params.reply_markup).toEqual({ remove_keyboard: true });
  });

  it("sets reply_to_message_id", () => {
    const msg: OutboundMessage = { text: "Reply", replyToMessageId: "42" };
    const params = buildSendMessageParams(100, msg);
    expect(params.reply_to_message_id).toBe(42);
  });

  it("sets disable_web_page_preview", () => {
    const msg: OutboundMessage = { text: "https://example.com", disableWebPagePreview: true };
    const params = buildSendMessageParams(100, msg);
    expect(params.disable_web_page_preview).toBe(true);
  });

  it("accepts string chatId", () => {
    const params = buildSendMessageParams("@channelname", { text: "hi" });
    expect(params.chat_id).toBe("@channelname");
  });
});

describe("escapeMarkdownV2", () => {
  it("escapes all special characters", () => {
    const result = escapeMarkdownV2("hello_world*test[link](url)~`>#+=-|{}.!");
    expect(result).not.toMatch(/[_*[\]()~`>#+\-=|{}.!]/);
  });

  it("preserves plain text unchanged", () => {
    expect(escapeMarkdownV2("hello world 123")).toBe("hello world 123");
  });
});
