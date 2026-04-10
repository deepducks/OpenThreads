/**
 * Unit tests for the Slack inbound message parser.
 */

import { describe, expect, test } from "bun:test";
import {
  parseMessageEvent,
  parseSlashCommand,
  slackTsToISO,
  stripBotMention,
  type SlackMessageEvent,
  type SlackSlashCommand,
} from "../src/inbound.js";

describe("slackTsToISO", () => {
  test("converts a Slack timestamp to ISO-8601", () => {
    // 1700000000.000000 = 2023-11-14T22:13:20.000Z
    const iso = slackTsToISO("1700000000.000000");
    expect(iso).toBe("2023-11-14T22:13:20.000Z");
  });

  test("preserves sub-second precision", () => {
    const iso = slackTsToISO("1700000000.123456");
    // 0.123456 seconds = 123 ms (JavaScript Date truncates to ms)
    expect(iso).toMatch(/^2023-11-14T22:13:20\.123Z$/);
  });
});

describe("stripBotMention", () => {
  test("removes a leading bot mention", () => {
    const result = stripBotMention("<@U12345> hello world", "U12345");
    expect(result).toBe("hello world");
  });

  test("removes all bot mentions", () => {
    const result = stripBotMention("<@UBOT> do <@UBOT> this", "UBOT");
    expect(result).toBe("do  this");
  });

  test("is a no-op when no botUserId is provided", () => {
    const result = stripBotMention("<@U12345> hello", undefined);
    expect(result).toBe("<@U12345> hello");
  });

  test("is a no-op when the mention does not match", () => {
    const result = stripBotMention("<@UOTHER> hello", "U12345");
    expect(result).toBe("<@UOTHER> hello");
  });
});

describe("parseMessageEvent", () => {
  const baseEvent: SlackMessageEvent = {
    type: "message",
    channel: "C0123456",
    user: "U78901",
    username: "alice",
    text: "Hello, world!",
    ts: "1700000000.000000",
    channel_type: "channel",
  };

  test("parses a basic channel message", () => {
    const msg = parseMessageEvent(baseEvent);

    expect(msg.sender.id).toBe("U78901");
    expect(msg.sender.name).toBe("alice");
    expect(msg.content).toBe("Hello, world!");
    expect(msg.channelId).toBe("C0123456");
    expect(msg.isDM).toBe(false);
    expect(msg.nativeThreadId).toBeNull();
    expect(msg.threadId).toBeNull();
    expect(msg.timestamp).toBe("2023-11-14T22:13:20.000Z");
  });

  test("parses a thread reply", () => {
    const event: SlackMessageEvent = {
      ...baseEvent,
      thread_ts: "1699999000.000000",
    };
    const msg = parseMessageEvent(event);
    expect(msg.nativeThreadId).toBe("1699999000.000000");
  });

  test("marks DMs correctly", () => {
    const event: SlackMessageEvent = {
      ...baseEvent,
      channel_type: "im",
    };
    const msg = parseMessageEvent(event);
    expect(msg.isDM).toBe(true);
  });

  test("strips bot mention when botUserId provided", () => {
    const event: SlackMessageEvent = {
      ...baseEvent,
      text: "<@UBOT> deploy staging",
    };
    const msg = parseMessageEvent(event, "UBOT");
    expect(msg.content).toBe("deploy staging");
  });

  test("falls back to user id when username is absent", () => {
    const event: SlackMessageEvent = {
      ...baseEvent,
      username: undefined,
    };
    const msg = parseMessageEvent(event);
    expect(msg.sender.name).toBe("U78901");
  });
});

describe("parseSlashCommand", () => {
  const baseCommand: SlackSlashCommand = {
    command: "/deploy",
    text: "staging",
    user_id: "U78901",
    user_name: "alice",
    channel_id: "C0123456",
    trigger_id: "trigger123",
  };

  test("parses a slash command", () => {
    const msg = parseSlashCommand(baseCommand);

    expect(msg.sender.id).toBe("U78901");
    expect(msg.sender.name).toBe("alice");
    expect(msg.content).toBe("/deploy staging");
    expect(msg.channelId).toBe("C0123456");
    expect(msg.isDM).toBe(false);
    expect(msg.nativeThreadId).toBeNull();
  });

  test("handles command with no args", () => {
    const msg = parseSlashCommand({ ...baseCommand, text: "" });
    expect(msg.content).toBe("/deploy");
  });
});
