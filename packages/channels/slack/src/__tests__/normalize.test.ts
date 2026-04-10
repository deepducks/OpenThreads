import { describe, it, expect } from "bun:test";
import {
  normalizeSlackMessage,
  isThreadReply,
  isBotMessage,
  type SlackMessagePayload,
} from "../utils/normalize.js";

describe("normalizeSlackMessage()", () => {
  const baseMsg: SlackMessagePayload = {
    ts: "1714000001.000100",
    channel: "C0123ABC",
    user: "U456DEF",
    text: "Can I deploy branch feature-x to staging?",
  };

  it("sets turnId to the message ts", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.turnId).toBe(baseMsg.ts);
  });

  it("sets threadId to ts when there is no thread_ts (root message)", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.threadId).toBe(baseMsg.ts);
  });

  it("sets threadId to thread_ts when message is in a thread", () => {
    const threadMsg: SlackMessagePayload = {
      ...baseMsg,
      ts: "1714000002.000200",
      thread_ts: "1714000001.000100",
    };
    const envelope = normalizeSlackMessage(threadMsg);
    expect(envelope.threadId).toBe("1714000001.000100");
  });

  it("sets source.channel to 'slack' by default", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.source.channel).toBe("slack");
  });

  it("accepts a custom channelAdapterId", () => {
    const envelope = normalizeSlackMessage(baseMsg, "slack-workspace-main");
    expect(envelope.source.channel).toBe("slack-workspace-main");
  });

  it("sets source.channelId to the Slack channel ID", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.source.channelId).toBe("C0123ABC");
  });

  it("sets source.sender.id to the user ID", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.source.sender.id).toBe("U456DEF");
  });

  it("normalizes message text into message array", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.message).toHaveLength(1);
    expect(envelope.message[0]).toMatchObject({
      text: "Can I deploy branch feature-x to staging?",
    });
  });

  it("includes empty text when text is undefined", () => {
    const envelope = normalizeSlackMessage({ ...baseMsg, text: undefined });
    expect((envelope.message[0] as { text: string }).text).toBe("");
  });

  it("leaves replyTo empty (filled by server layer)", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.replyTo).toBe("");
  });

  it("includes attachments when files are present", () => {
    const msgWithFiles: SlackMessagePayload = {
      ...baseMsg,
      files: [{ id: "F001", name: "diagram.png" }],
    };
    const envelope = normalizeSlackMessage(msgWithFiles);
    const item = envelope.message[0] as { text: string; attachments: unknown[] };
    expect(item.attachments).toHaveLength(1);
  });

  it("sets username as sender name when available", () => {
    const envelope = normalizeSlackMessage({ ...baseMsg, username: "jdoe" });
    expect(envelope.source.sender.name).toBe("jdoe");
  });

  it("falls back to user ID as sender name when username is absent", () => {
    const envelope = normalizeSlackMessage(baseMsg);
    expect(envelope.source.sender.name).toBe("U456DEF");
  });
});

describe("isThreadReply()", () => {
  it("returns false for a root message (no thread_ts)", () => {
    const msg: SlackMessagePayload = { ts: "111.222", channel: "C1" };
    expect(isThreadReply(msg)).toBe(false);
  });

  it("returns false when thread_ts equals ts (the thread root)", () => {
    const msg: SlackMessagePayload = {
      ts: "111.222",
      thread_ts: "111.222",
      channel: "C1",
    };
    expect(isThreadReply(msg)).toBe(false);
  });

  it("returns true for a reply in an existing thread", () => {
    const msg: SlackMessagePayload = {
      ts: "111.333",
      thread_ts: "111.222",
      channel: "C1",
    };
    expect(isThreadReply(msg)).toBe(true);
  });
});

describe("isBotMessage()", () => {
  it("returns false for a regular message", () => {
    const msg: SlackMessagePayload = { ts: "111.222", channel: "C1" };
    expect(isBotMessage(msg)).toBe(false);
  });

  it("returns true for a bot_message subtype", () => {
    const msg: SlackMessagePayload = {
      ts: "111.222",
      channel: "C1",
      subtype: "bot_message",
    };
    expect(isBotMessage(msg)).toBe(true);
  });
});
