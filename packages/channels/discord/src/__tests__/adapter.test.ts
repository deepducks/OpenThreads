/**
 * Unit tests for the DiscordAdapter.
 *
 * These tests use mock Discord.js objects and do NOT require a real Discord
 * bot token.  Integration tests (requiring a real Discord test server) are
 * tagged with "integration" and are excluded from the default test run.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { DiscordAdapter } from "../adapter.js";
import type {
  DiscordAdapterConfig,
  IncomingMessage,
  SendMessageParams,
} from "../types.js";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe("DiscordAdapter.capabilities()", () => {
  it("reports correct capabilities", () => {
    const adapter = new DiscordAdapter();
    const caps = adapter.capabilities();
    expect(caps.threads).toBe(true);
    expect(caps.buttons).toBe(true);
    expect(caps.selectMenus).toBe(true);
    expect(caps.replyMessages).toBe(false);
    expect(caps.dms).toBe(true);
    expect(caps.fileUpload).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

describe("parseMessage()", () => {
  it("returns null for bot messages", async () => {
    const { parseMessage } = await import("../inbound/messages.js");

    const fakeMessage = {
      partial: false,
      author: { bot: true, id: "bot-id", username: "TestBot" },
      webhookId: null,
      type: 0, // Default
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "ch-1",
      content: "I am a bot",
      attachments: { map: () => [] },
      createdAt: new Date(),
      client: { user: { id: "bot-id" } },
      member: null,
      id: "msg-1",
    };

    // @ts-expect-error — minimal mock
    expect(parseMessage(fakeMessage)).toBeNull();
  });

  it("parses a regular user message", async () => {
    const { parseMessage } = await import("../inbound/messages.js");

    const fakeMessage = {
      partial: false,
      author: { bot: false, id: "user-1", username: "alice" },
      webhookId: null,
      type: 0, // Default
      mentions: { users: { has: () => false } },
      channel: { isThread: () => false },
      channelId: "ch-1",
      content: "Hello world",
      attachments: { map: (fn: (a: { url: string }) => string) => fn({ url: "https://example.com/image.png" }) ? ["https://example.com/image.png"] : [] },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      client: { user: { id: "bot-99" } },
      member: { displayName: "Alice" },
      id: "msg-42",
    };

    // @ts-expect-error — minimal mock
    const result = parseMessage(fakeMessage);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("text");
    expect(result!.text).toBe("Hello world");
    expect(result!.sender.id).toBe("user-1");
    expect(result!.sender.displayName).toBe("Alice");
    expect(result!.threadId).toBeUndefined();
  });

  it("detects @mention messages", async () => {
    const { parseMessage } = await import("../inbound/messages.js");

    const fakeMessage = {
      partial: false,
      author: { bot: false, id: "user-1", username: "alice" },
      webhookId: null,
      type: 0,
      mentions: { users: { has: (id: string) => id === "bot-99" } },
      channel: { isThread: () => false },
      channelId: "ch-1",
      content: "<@bot-99> deploy to staging",
      attachments: { map: () => [] },
      createdAt: new Date(),
      client: { user: { id: "bot-99" } },
      member: null,
      id: "msg-43",
    };

    // @ts-expect-error — minimal mock
    const result = parseMessage(fakeMessage);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("mention");
  });

  it("captures threadId when channel is a thread", async () => {
    const { parseMessage } = await import("../inbound/messages.js");

    const fakeMessage = {
      partial: false,
      author: { bot: false, id: "user-1", username: "alice" },
      webhookId: null,
      type: 0,
      mentions: { users: { has: () => false } },
      channel: { isThread: () => true },
      channelId: "thread-99",
      content: "Thread message",
      attachments: { map: () => [] },
      createdAt: new Date(),
      client: { user: { id: "bot-1" } },
      member: null,
      id: "msg-44",
    };

    // @ts-expect-error — minimal mock
    const result = parseMessage(fakeMessage);

    expect(result!.threadId).toBe("thread-99");
  });
});

// ---------------------------------------------------------------------------
// Slash command parsing
// ---------------------------------------------------------------------------

describe("parseSlashCommand()", () => {
  it("converts a slash command interaction to IncomingMessage", async () => {
    const { parseSlashCommand } = await import("../inbound/commands.js");

    const fakeInteraction = {
      id: "int-1",
      channelId: "ch-1",
      channel: { isThread: () => false },
      user: { id: "user-1", username: "bob" },
      member: { displayName: "Bob" },
      commandName: "deploy",
      options: {
        data: [
          { name: "env", type: 3 /* String */, value: "staging" },
        ],
      },
    };

    // @ts-expect-error — minimal mock
    const result = parseSlashCommand(fakeInteraction);

    expect(result.type).toBe("slash_command");
    expect(result.commandName).toBe("deploy");
    expect(result.commandOptions?.env).toBe("staging");
    expect(result.text).toBe("/deploy");
  });
});

// ---------------------------------------------------------------------------
// Component builders
// ---------------------------------------------------------------------------

describe("buildAuthorizeButtons()", () => {
  it("builds approve and deny buttons", async () => {
    const { buildAuthorizeButtons } = await import("../outbound/components.js");
    const row = buildAuthorizeButtons("intent-123");
    // @ts-expect-error — APIActionRowComponent typing
    const ids = row.components.map((c: { custom_id: string }) => c.custom_id);
    expect(ids).toContain("ot_a2h_approve:intent-123");
    expect(ids).toContain("ot_a2h_deny:intent-123");
  });
});

describe("buildSelectMenu()", () => {
  it("builds a select menu with given options", async () => {
    const { buildSelectMenu } = await import("../outbound/components.js");
    const row = buildSelectMenu(
      [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" },
      ],
      "Pick one",
      "intent-456"
    );
    // @ts-expect-error — APIActionRowComponent typing
    expect(row.components[0].custom_id).toBe("ot_a2h_select:intent-456");
    // @ts-expect-error — APIActionRowComponent typing
    expect(row.components[0].options).toHaveLength(2);
  });
});

describe("buildA2HComponents()", () => {
  it("returns authorize buttons for AUTHORIZE intent", async () => {
    const { buildA2HComponents } = await import("../outbound/components.js");
    const components = buildA2HComponents({
      intent: "AUTHORIZE",
      context: { action: "deploy", details: "Deploy to production" },
    });
    expect(components).not.toBeNull();
    expect(components).toHaveLength(1);
  });

  it("returns select menu for COLLECT intent with options", async () => {
    const { buildA2HComponents } = await import("../outbound/components.js");
    const components = buildA2HComponents({
      intent: "COLLECT",
      context: {
        question: "Which environment?",
        options: [
          { label: "Staging", value: "staging" },
          { label: "Production", value: "production" },
        ],
      },
    });
    expect(components).not.toBeNull();
    expect(components).toHaveLength(1);
  });

  it("returns null for free-text COLLECT (no options)", async () => {
    const { buildA2HComponents } = await import("../outbound/components.js");
    const components = buildA2HComponents({
      intent: "COLLECT",
      context: { question: "What is your name?" },
    });
    expect(components).toBeNull();
  });

  it("returns empty array for INFORM intent", async () => {
    const { buildA2HComponents } = await import("../outbound/components.js");
    const components = buildA2HComponents({
      intent: "INFORM",
      context: { action: "build", details: "Build succeeded" },
    });
    expect(components).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseA2HCustomId
// ---------------------------------------------------------------------------

describe("parseA2HCustomId()", () => {
  it("parses approve custom ID", async () => {
    const { parseA2HCustomId } = await import("../outbound/components.js");
    const result = parseA2HCustomId("ot_a2h_approve:my-intent");
    expect(result?.type).toBe("approve");
    expect(result?.intentId).toBe("my-intent");
  });

  it("parses deny custom ID", async () => {
    const { parseA2HCustomId } = await import("../outbound/components.js");
    const result = parseA2HCustomId("ot_a2h_deny:my-intent");
    expect(result?.type).toBe("deny");
    expect(result?.intentId).toBe("my-intent");
  });

  it("parses select custom ID", async () => {
    const { parseA2HCustomId } = await import("../outbound/components.js");
    const result = parseA2HCustomId("ot_a2h_select:my-intent");
    expect(result?.type).toBe("select");
    expect(result?.intentId).toBe("my-intent");
  });

  it("returns null for non-OpenThreads custom ID", async () => {
    const { parseA2HCustomId } = await import("../outbound/components.js");
    expect(parseA2HCustomId("some_other_button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Embed builders
// ---------------------------------------------------------------------------

describe("Embed builders", () => {
  it("buildInformEmbed sets correct color", async () => {
    const { buildInformEmbed } = await import("../outbound/embeds.js");
    const embed = buildInformEmbed({ action: "Build complete", details: "All checks passed" });
    expect(embed.color).toBe(0x5865f2);
    expect(embed.title).toBe("ℹ️ Build complete");
  });

  it("buildAuthorizeEmbed sets correct color", async () => {
    const { buildAuthorizeEmbed } = await import("../outbound/embeds.js");
    const embed = buildAuthorizeEmbed({ action: "Deploy to prod" });
    expect(embed.color).toBe(0xffa500);
  });

  it("buildCollectEmbed shows question as description", async () => {
    const { buildCollectEmbed } = await import("../outbound/embeds.js");
    const embed = buildCollectEmbed({ question: "What is your name?" });
    expect(embed.description).toBe("What is your name?");
  });

  it("buildEscalateEmbed sets red color", async () => {
    const { buildEscalateEmbed } = await import("../outbound/embeds.js");
    const embed = buildEscalateEmbed({ action: "Critical error" });
    expect(embed.color).toBe(0xed4245);
  });
});
