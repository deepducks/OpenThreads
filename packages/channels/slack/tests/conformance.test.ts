/**
 * Adapter conformance tests — verifies SlackAdapter satisfies the
 * ChannelAdapter interface without needing a live Slack workspace.
 *
 * Uses a mock WebClient and App to simulate Slack interactions.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundMessage,
  A2HResponse,
  AuthorizeResponse,
  CollectResponse,
} from "@openthreads/core";

// ---------------------------------------------------------------------------
// Minimal mock of @slack/bolt App and @slack/web-api WebClient.
// We don't want to instantiate a real Slack connection in tests.
// ---------------------------------------------------------------------------

class MockWebClient {
  public posted: Array<Record<string, unknown>> = [];

  chat = {
    postMessage: async (args: Record<string, unknown>) => {
      this.posted.push(args);
      return { ok: true, ts: `${Date.now()}.000000` };
    },
  };
}

// Minimal mock of Bolt App
class MockApp {
  public handlers: { event: string; handler: Function }[] = [];
  public commandHandlers: { pattern: RegExp | string; handler: Function }[] = [];
  public actionHandlers: { pattern: RegExp | string; handler: Function }[] = [];
  public started = false;
  public stopped = false;

  message(handler: Function) {
    this.handlers.push({ event: "message", handler });
  }

  event(name: string, handler: Function) {
    this.handlers.push({ event: name, handler });
  }

  command(pattern: RegExp | string, handler: Function) {
    this.commandHandlers.push({ pattern, handler });
  }

  action(pattern: RegExp | string, handler: Function) {
    this.actionHandlers.push({ pattern, handler });
  }

  async start() {
    this.started = true;
  }

  async stop() {
    this.stopped = true;
  }
}

// ---------------------------------------------------------------------------
// Create a testable adapter that injects mocks instead of real Slack objects.
// ---------------------------------------------------------------------------

import { SlackAdapter } from "../src/adapter.js";
import { SLACK_CAPABILITIES } from "../src/capabilities.js";

/**
 * A sub-class of SlackAdapter that exposes internal mocks for testing.
 * In production, the real @slack/bolt App and WebClient are used.
 */
class TestableSlackAdapter extends SlackAdapter {
  declare public mockWebClient: MockWebClient;

  static createWithMocks(mockWebClient: MockWebClient): TestableSlackAdapter {
    const adapter = new SlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-signing-secret",
    });

    // Inject mock web client
    (adapter as unknown as { webClient: MockWebClient }).webClient =
      mockWebClient;

    return adapter as unknown as TestableSlackAdapter;
  }
}

// ---------------------------------------------------------------------------
// Shared conformance suite — can be run against any ChannelAdapter
// ---------------------------------------------------------------------------

function runConformanceSuite(
  label: string,
  factory: () => ChannelAdapter
): void {
  describe(`ChannelAdapter conformance — ${label}`, () => {
    let adapter: ChannelAdapter;
    let mockClient: MockWebClient;

    beforeEach(() => {
      mockClient = new MockWebClient();
      adapter = factory();
    });

    // -----------------------------------------------------------------------
    // getCapabilities()
    // -----------------------------------------------------------------------

    describe("getCapabilities()", () => {
      test("returns a capabilities object", () => {
        const caps = adapter.getCapabilities();
        expect(typeof caps).toBe("object");
        expect(caps).not.toBeNull();
      });

      test("all required fields are booleans", () => {
        const caps = adapter.getCapabilities();
        const required: (keyof ChannelCapabilities)[] = [
          "threads",
          "buttons",
          "selectMenus",
          "replyMessages",
          "dms",
          "fileUpload",
        ];
        for (const field of required) {
          expect(typeof caps[field]).toBe("boolean");
        }
      });

      test("Slack reports threads=true, buttons=true, selectMenus=true", () => {
        const caps = adapter.getCapabilities();
        expect(caps.threads).toBe(true);
        expect(caps.buttons).toBe(true);
        expect(caps.selectMenus).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // onMessage() / onInteraction()
    // -----------------------------------------------------------------------

    describe("onMessage() / onInteraction()", () => {
      test("accepts a message handler without throwing", () => {
        expect(() => {
          adapter.onMessage(async (_msg: InboundMessage) => {});
        }).not.toThrow();
      });

      test("accepts an interaction handler without throwing", () => {
        expect(() => {
          adapter.onInteraction(async (_resp: A2HResponse) => {});
        }).not.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // send() — text message
    // -----------------------------------------------------------------------

    describe("send() — TextMessage", () => {
      test("sends a plain text message to the channel", async () => {
        // Inject mock client
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [{ text: "Hello, Slack!" }]);

        expect(mockClient.posted).toHaveLength(1);
        expect(mockClient.posted[0]).toMatchObject({
          channel: "C0123456",
          text: "Hello, Slack!",
        });
      });

      test("sends into an existing thread when threadId is provided", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", "1700000000.000000", [
          { text: "Thread reply" },
        ]);

        expect(mockClient.posted[0]).toMatchObject({
          thread_ts: "1700000000.000000",
        });
      });
    });

    // -----------------------------------------------------------------------
    // send() — A2H AUTHORIZE
    // -----------------------------------------------------------------------

    describe("send() — A2H AUTHORIZE", () => {
      test("posts a Block Kit message with approve/deny buttons", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [
          {
            intent: "AUTHORIZE",
            requestId: "req-test-001",
            context: { action: "deploy", details: "Branch main → prod" },
          },
        ]);

        expect(mockClient.posted).toHaveLength(1);
        const posted = mockClient.posted[0];
        expect(posted).toHaveProperty("blocks");
        const blocks = posted["blocks"] as Array<Record<string, unknown>>;
        const actionsBlock = blocks.find((b) => b["type"] === "actions");
        expect(actionsBlock).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // send() — A2H COLLECT with options
    // -----------------------------------------------------------------------

    describe("send() — A2H COLLECT (options)", () => {
      test("posts a Block Kit message with a select menu", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [
          {
            intent: "COLLECT",
            requestId: "req-test-002",
            question: "Which environment?",
            options: ["staging", "production"],
          },
        ]);

        expect(mockClient.posted).toHaveLength(1);
        const blocks = mockClient.posted[0]?.["blocks"] as
          | Array<Record<string, unknown>>
          | undefined;
        const actionsBlock = blocks?.find((b) => b["type"] === "actions");
        const elements = actionsBlock?.["elements"] as
          | Array<{ type: string }>
          | undefined;
        const select = elements?.find((e) => e.type === "static_select");
        expect(select).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // send() — A2H COLLECT free-text
    // -----------------------------------------------------------------------

    describe("send() — A2H COLLECT (free-text)", () => {
      test("posts a question and registers a pending listener", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [
          {
            intent: "COLLECT",
            requestId: "req-test-003",
            question: "What is the ticket number?",
          },
        ]);

        expect(mockClient.posted).toHaveLength(1);
        expect(mockClient.posted[0]?.["text"]).toBe("What is the ticket number?");

        // A pending listener should have been registered
        const pending = (
          adapter as unknown as {
            pendingFreeTextCollects: Map<string, unknown>;
          }
        ).pendingFreeTextCollects;
        expect(pending.size).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    // send() — A2H INFORM
    // -----------------------------------------------------------------------

    describe("send() — A2H INFORM", () => {
      test("posts a plain notification message", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [
          {
            intent: "INFORM",
            requestId: "req-test-004",
            message: "Deployment done.",
          },
        ]);

        expect(mockClient.posted[0]?.["text"]).toBe("Deployment done.");
      });
    });

    // -----------------------------------------------------------------------
    // send() — mixed array
    // -----------------------------------------------------------------------

    describe("send() — mixed array", () => {
      test("handles text + AUTHORIZE in one call", async () => {
        (adapter as unknown as { webClient: MockWebClient }).webClient =
          mockClient;

        await adapter.send("C0123456", null, [
          { text: "Tests passed." },
          {
            intent: "AUTHORIZE",
            requestId: "req-test-005",
            context: { action: "merge-pr", details: "PR #42" },
          },
        ]);

        expect(mockClient.posted).toHaveLength(2);
        expect(mockClient.posted[0]?.["text"]).toBe("Tests passed.");
        expect(mockClient.posted[1]).toHaveProperty("blocks");
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Run the conformance suite against SlackAdapter
// ---------------------------------------------------------------------------

runConformanceSuite("SlackAdapter", () => {
  const mockClient = new MockWebClient();
  const adapter = new SlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-signing-secret",
  });
  (adapter as unknown as { webClient: MockWebClient }).webClient = mockClient;
  return adapter;
});
