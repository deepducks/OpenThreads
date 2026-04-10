/**
 * SlackAdapter integration tests.
 * Uses a mock BoltApp and WebClient so no real Slack credentials are needed.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { SlackAdapter } from "../SlackAdapter.js";
import type { BoltApp } from "../SlackAdapter.js";
import type { InboundEnvelope, OutboundMessage, A2HRequest } from "@openthreads/core";

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

type ActionHandler = (args: {
  action: Record<string, unknown>;
  ack: () => Promise<void>;
  body: Record<string, unknown>;
}) => Promise<void>;

type MessageHandler = (args: {
  message: Record<string, unknown>;
}) => Promise<void>;

type EventHandler = (args: {
  event: Record<string, unknown>;
}) => Promise<void>;

type CommandHandler = (args: {
  command: Record<string, string>;
  ack: () => Promise<void>;
}) => Promise<void>;

interface MockBoltAppHandlers {
  messageHandlers: MessageHandler[];
  eventHandlers: Map<string, EventHandler[]>;
  commandHandlers: Map<string, CommandHandler[]>;
  actionHandlers: Array<{
    pattern: string | RegExp | { action_id: string | RegExp };
    handler: ActionHandler;
  }>;
}

function createMockBoltApp(): BoltApp & { _handlers: MockBoltAppHandlers } {
  const handlers: MockBoltAppHandlers = {
    messageHandlers: [],
    eventHandlers: new Map(),
    commandHandlers: new Map(),
    actionHandlers: [],
  };

  return {
    _handlers: handlers,
    message: mock((handler: Function) => {
      handlers.messageHandlers.push(handler as MessageHandler);
    }),
    event: mock((eventName: string, handler: Function) => {
      const list = handlers.eventHandlers.get(eventName) ?? [];
      list.push(handler as EventHandler);
      handlers.eventHandlers.set(eventName, list);
    }),
    command: mock((commandName: string, handler: Function) => {
      const list = handlers.commandHandlers.get(commandName) ?? [];
      list.push(handler as CommandHandler);
      handlers.commandHandlers.set(commandName, list);
    }),
    action: mock(
      (
        pattern: string | RegExp | { action_id: string | RegExp },
        handler: Function
      ) => {
        handlers.actionHandlers.push({
          pattern,
          handler: handler as ActionHandler,
        });
      }
    ),
    start: mock(async () => {}),
    stop: mock(async () => {}),
    client: createMockWebClient() as unknown as import("@slack/web-api").WebClient,
  };
}

function createMockWebClient() {
  return {
    chat: {
      postMessage: mock(async (_args: unknown) => ({ ok: true, ts: "1714000099.000001" })),
      update: mock(async (_args: unknown) => ({ ok: true })),
    },
  };
}

/** Simulate a Slack message event firing through the mock app */
async function fireMessage(
  app: ReturnType<typeof createMockBoltApp>,
  message: Record<string, unknown>
): Promise<void> {
  for (const handler of app._handlers.messageHandlers) {
    await handler({ message });
  }
}

/** Simulate a Slack action (button click / select) through the mock app */
async function fireAction(
  app: ReturnType<typeof createMockBoltApp>,
  actionId: string,
  action: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<void> {
  for (const { pattern, handler } of app._handlers.actionHandlers) {
    let matches = false;
    if (typeof pattern === "string") {
      matches = pattern === actionId;
    } else if (pattern instanceof RegExp) {
      matches = pattern.test(actionId);
    } else if (typeof pattern === "object" && "action_id" in pattern) {
      const pid = (pattern as { action_id: string | RegExp }).action_id;
      matches =
        pid instanceof RegExp ? pid.test(actionId) : pid === actionId;
    }
    if (matches) {
      await handler({
        action: { action_id: actionId, ...action },
        ack: async () => {},
        body,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let mockApp: ReturnType<typeof createMockBoltApp>;
let mockClient: ReturnType<typeof createMockWebClient>;
let adapter: SlackAdapter;

beforeEach(() => {
  mockApp = createMockBoltApp();
  mockClient = createMockWebClient();
  adapter = new SlackAdapter(
    { token: "xoxb-test", signingSecret: "sig-test" },
    mockApp,
    mockClient as unknown as import("@slack/web-api").WebClient
  );
});

describe("SlackAdapter", () => {
  describe("capabilities()", () => {
    it("reports expected capabilities", () => {
      const caps = adapter.capabilities();
      expect(caps.threads).toBe(true);
      expect(caps.buttons).toBe(true);
      expect(caps.selectMenus).toBe(true);
      expect(caps.replyMessages).toBe(false);
      expect(caps.dms).toBe(true);
      expect(caps.fileUpload).toBe(true);
    });
  });

  describe("start() / stop()", () => {
    it("delegates start to BoltApp", async () => {
      await adapter.start();
      expect(mockApp.start).toHaveBeenCalledTimes(1);
    });

    it("delegates stop to BoltApp", async () => {
      await adapter.stop();
      expect(mockApp.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("send()", () => {
    it("posts a text message to the correct channel", async () => {
      const message: OutboundMessage = {
        targetId: "C0123",
        content: [{ text: "Hello, world!" }],
      };
      await adapter.send(message);
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C0123", text: "Hello, world!" })
      );
    });

    it("includes thread_ts when threadId is provided", async () => {
      const message: OutboundMessage = {
        targetId: "C0123",
        threadId: "1714000001.000100",
        content: [{ text: "In thread" }],
      };
      await adapter.send(message);
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: "1714000001.000100" })
      );
    });

    it("sends INFORM A2H items as plain text", async () => {
      const message: OutboundMessage = {
        targetId: "C0123",
        content: [
          {
            intent: "INFORM",
            context: { details: "Deploy completed successfully." },
          },
        ],
      };
      await adapter.send(message);
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Deploy completed successfully." })
      );
    });

    it("skips non-INFORM A2H items silently", async () => {
      const message: OutboundMessage = {
        targetId: "C0123",
        content: [
          {
            intent: "AUTHORIZE",
            context: { action: "deploy" },
          },
        ],
      };
      // Should not throw, postMessage not called for AUTHORIZE via send()
      await adapter.send(message);
      expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("onMessage()", () => {
    it("calls the registered handler when a message event fires", async () => {
      const received: InboundEnvelope[] = [];
      adapter.onMessage(async (env) => {
        received.push(env);
      });

      await fireMessage(mockApp, {
        ts: "1714000001.000100",
        channel: "C0123",
        user: "U456",
        text: "Hello",
      });

      expect(received).toHaveLength(1);
      expect(received[0].source.channelId).toBe("C0123");
      expect((received[0].message[0] as { text: string }).text).toBe("Hello");
    });

    it("ignores bot messages", async () => {
      const received: InboundEnvelope[] = [];
      adapter.onMessage(async (env) => {
        received.push(env);
      });

      await fireMessage(mockApp, {
        ts: "1714000001.000100",
        channel: "C0123",
        user: "UBOT",
        text: "Bot message",
        subtype: "bot_message",
      });

      expect(received).toHaveLength(0);
    });

    it("routes threadId from thread_ts when message is in a thread", async () => {
      const received: InboundEnvelope[] = [];
      adapter.onMessage(async (env) => received.push(env));

      await fireMessage(mockApp, {
        ts: "1714000002.000200",
        thread_ts: "1714000001.000100",
        channel: "C0123",
        user: "U456",
        text: "Thread reply",
      });

      expect(received[0].threadId).toBe("1714000001.000100");
    });
  });

  describe("requestA2H() — INFORM", () => {
    it("sends a plain text message and resolves immediately", async () => {
      const request: A2HRequest = {
        intent: "INFORM",
        context: { details: "Build completed." },
        targetId: "C0123",
      };
      const response = await adapter.requestA2H(request);
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Build completed." })
      );
      expect(response).toEqual({});
    });
  });

  describe("requestA2H() — AUTHORIZE", () => {
    it("sends Block Kit blocks for AUTHORIZE", async () => {
      const request: A2HRequest = {
        intent: "AUTHORIZE",
        context: { action: "deploy-to-prod", details: "feature-x → prod" },
        targetId: "C0123",
        threadId: "1714000001.000100",
      };

      // Start the request (promise will pend until action fires)
      const responsePromise = adapter.requestA2H(request);

      // Verify the message was posted with blocks
      await Promise.resolve(); // let microtasks flush
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0123",
          thread_ts: "1714000001.000100",
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: "section" }),
            expect.objectContaining({ type: "actions" }),
          ]),
        })
      );

      // Simulate the user clicking Approve
      const calls = (mockClient.chat.postMessage as ReturnType<typeof mock>).mock.calls;
      const postedMsg = calls[calls.length - 1][0] as { blocks: Array<{ type: string; elements: Array<{ action_id: string }> }> };
      const actionsBlock = postedMsg.blocks?.find((b) => b.type === "actions");
      const approveActionId = actionsBlock?.elements?.find((e) =>
        e.action_id.includes("approve")
      )?.action_id;

      expect(approveActionId).toBeDefined();

      await fireAction(
        mockApp,
        approveActionId!,
        { action_id: approveActionId },
        {
          channel: { id: "C0123" },
          message: { ts: "1714000099.000001" },
        }
      );

      const response = await responsePromise;
      expect(response.approved).toBe(true);
    });

    it("resolves with approved=false when Deny is clicked", async () => {
      const request: A2HRequest = {
        intent: "AUTHORIZE",
        context: { action: "delete-db" },
        targetId: "C0123",
      };

      const responsePromise = adapter.requestA2H(request);
      await Promise.resolve();

      const calls = (mockClient.chat.postMessage as ReturnType<typeof mock>).mock.calls;
      const postedMsg = calls[calls.length - 1][0] as { blocks: Array<{ type: string; elements: Array<{ action_id: string }> }> };
      const actionsBlock = postedMsg.blocks?.find((b) => b.type === "actions");
      const denyActionId = actionsBlock?.elements?.find((e) =>
        e.action_id.includes("deny")
      )?.action_id;

      await fireAction(
        mockApp,
        denyActionId!,
        { action_id: denyActionId },
        { channel: { id: "C0123" }, message: { ts: "1714000099.000001" } }
      );

      const response = await responsePromise;
      expect(response.approved).toBe(false);
    });
  });

  describe("requestA2H() — COLLECT with options", () => {
    it("sends a static_select block for COLLECT with options", async () => {
      const request: A2HRequest = {
        intent: "COLLECT",
        context: {
          question: "Which env?",
          options: [
            { label: "Staging", value: "staging" },
            { label: "Prod", value: "prod" },
          ],
        },
        targetId: "C0123",
      };

      const responsePromise = adapter.requestA2H(request);
      await Promise.resolve();

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "section",
              accessory: expect.objectContaining({ type: "static_select" }),
            }),
          ]),
        })
      );

      // Simulate user selecting "staging"
      const calls = (mockClient.chat.postMessage as ReturnType<typeof mock>).mock.calls;
      const postedMsg = calls[calls.length - 1][0] as {
        blocks: Array<{
          type: string;
          accessory?: { type: string; action_id: string };
        }>;
      };
      const sectionBlock = postedMsg.blocks?.find((b) => b.type === "section");
      const selectActionId = sectionBlock?.accessory?.action_id;

      await fireAction(
        mockApp,
        selectActionId!,
        {
          action_id: selectActionId,
          selected_option: {
            value: "staging",
            text: { type: "plain_text", text: "Staging" },
          },
        },
        { channel: { id: "C0123" }, message: { ts: "1714000099.000001" } }
      );

      const response = await responsePromise;
      expect(response.value).toBe("staging");
    });
  });

  describe("requestA2H() — COLLECT free-text", () => {
    it("captures a thread reply as the response", async () => {
      const request: A2HRequest = {
        intent: "COLLECT",
        context: { question: "What is your reasoning?" },
        targetId: "C0123",
        threadId: "1714000001.000100",
      };

      // Mock postMessage to return a ts for the question message
      (mockClient.chat.postMessage as ReturnType<typeof mock>).mockImplementationOnce(
        async () => ({ ok: true, ts: "1714000099.000001" })
      );

      const responsePromise = adapter.requestA2H(request);

      // Wait for postMessage to be called and pending key to be set
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // Simulate the human replying in the thread
      await fireMessage(mockApp, {
        ts: "1714000100.000001",
        thread_ts: "1714000001.000100",
        channel: "C0123",
        user: "U456",
        text: "Because tests passed.",
      });

      const response = await responsePromise;
      expect(response.value).toBe("Because tests passed.");
    });
  });

  describe("app_mention handler", () => {
    it("routes app_mention events to the message handler", async () => {
      const received: InboundEnvelope[] = [];
      adapter.onMessage(async (env) => received.push(env));

      const mentionHandlers = mockApp._handlers.eventHandlers.get("app_mention") ?? [];
      for (const h of mentionHandlers) {
        await h({
          event: {
            ts: "1714000001.000100",
            channel: "C0123",
            user: "U456",
            text: "<@UBOT> deploy staging",
          } as Record<string, unknown>,
        });
      }

      expect(received).toHaveLength(1);
      expect((received[0].message[0] as { text: string }).text).toContain("deploy staging");
    });
  });

  describe("/openthreads slash command handler", () => {
    it("routes slash command to message handler", async () => {
      const received: InboundEnvelope[] = [];
      adapter.onMessage(async (env) => received.push(env));

      const commandHandlers = mockApp._handlers.commandHandlers.get("/openthreads") ?? [];
      for (const h of commandHandlers) {
        await h({
          command: {
            channel_id: "C0123",
            user_id: "U456",
            user_name: "jdoe",
            text: "status",
          },
          ack: async () => {},
        });
      }

      expect(received).toHaveLength(1);
      expect((received[0].message[0] as { text: string }).text).toBe("status");
      expect(received[0].source.sender.id).toBe("U456");
    });
  });
});
