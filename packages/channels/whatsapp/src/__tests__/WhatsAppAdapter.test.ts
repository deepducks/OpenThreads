/**
 * WhatsApp adapter conformance tests.
 *
 * These tests verify the adapter's behaviour at the unit level using a mock
 * Baileys socket.  Integration tests that require an actual WhatsApp account
 * are intentionally excluded from this file.
 *
 * Run with: bun test
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { WhatsAppAdapter } from "../WhatsAppAdapter.js";
import { WHATSAPP_CAPABILITIES } from "../types.js";
import type { WhatsAppAdapterOptions } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock of the Baileys WASocket surface we depend on. */
function createMockSocket() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const sentMessages: Array<{ jid: string; content: unknown; opts?: unknown }> = [];

  const socket = {
    user: { id: "15551234567:1@s.whatsapp.net" },
    ev: {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
      },
      removeAllListeners: (event: string) => listeners.delete(event),
      emit: (event: string, ...args: unknown[]) => {
        listeners.get(event)?.forEach((cb) => cb(...args));
      },
    },
    sendMessage: mock(
      async (jid: string, content: unknown, opts?: unknown) => {
        sentMessages.push({ jid, content, opts });
        return { key: { id: `msg_${sentMessages.length}`, remoteJid: jid } };
      },
    ),
    logout: mock(async () => {}),
    _sentMessages: sentMessages,
  };

  return socket;
}

/** Creates an adapter whose SessionManager is replaced with a controllable mock. */
function createTestAdapter(overrides: Partial<WhatsAppAdapterOptions> = {}) {
  const mockSocket = createMockSocket();
  let socketReadyCb: ((sock: unknown) => void) | null = null;

  const options: WhatsAppAdapterOptions = {
    config: {
      sessionDir: "/tmp/whatsapp-test-session",
      serverBaseUrl: "https://openthreads.test",
      logLevel: "silent",
    },
    onQRCode: mock(),
    onConnected: mock(),
    onDisconnected: mock(),
    ...overrides,
  };

  const adapter = new WhatsAppAdapter(options);

  // Patch the session manager's internal connect to use our mock socket.
  (adapter as unknown as { session: { connect: () => Promise<void>; getSocket: () => unknown; disconnect: () => Promise<void> } }).session = {
    connect: async () => {
      // Simulate the session emitting onSocketReady with our mock.
      socketReadyCb = (adapter as unknown as { attachListeners: (s: unknown) => void }).attachListeners?.bind(adapter) ?? null;
      // Directly call the private attachListeners via prototype to wire events.
      (WhatsAppAdapter.prototype as unknown as { attachListeners: (s: unknown) => void })
        .attachListeners
        ?.call(adapter, mockSocket);

      // Expose the mock socket on the session mock.
      (adapter as unknown as { session: { getSocket: () => unknown } }).session.getSocket = () => mockSocket;
    },
    getSocket: () => mockSocket,
    disconnect: async () => {
      await mockSocket.logout();
    },
  };

  return { adapter, mockSocket, options };
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter capabilities", () => {
  it("reports the correct capabilities object", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities).toEqual(WHATSAPP_CAPABILITIES);
  });

  it("reports type = 'whatsapp'", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.type).toBe("whatsapp");
  });

  it("reports threads = false", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.threads).toBe(false);
  });

  it("reports buttons = true (limited)", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.buttons).toBe(true);
  });

  it("reports selectMenus = false", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.selectMenus).toBe(false);
  });

  it("reports replyMessages = true", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.replyMessages).toBe(true);
  });

  it("reports dms = true", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.dms).toBe(true);
  });

  it("reports fileUpload = true", () => {
    const { adapter } = createTestAdapter();
    expect(adapter.capabilities.fileUpload).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Outbound messages
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter sendMessage", () => {
  it("sends a text message to the correct JID", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.sendMessage({
      targetId: "15551234567",
      content: { type: "text", text: "Hello, world!" },
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);
    const [jid, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, unknown];
    expect(jid).toBe("15551234567@s.whatsapp.net");
    expect((content as { text: string }).text).toBe("Hello, world!");
  });

  it("returns a SentMessage with id and threadId", async () => {
    const { adapter } = createTestAdapter();
    await adapter.initialize();

    const result = await adapter.sendMessage({
      targetId: "15551234567",
      content: { type: "text", text: "Hi" },
    });

    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("threadId");
    expect(typeof result.id).toBe("string");
    expect(typeof result.threadId).toBe("string");
  });

  it("sends a buttons message with at most 3 buttons", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.sendMessage({
      targetId: "15551234567",
      content: {
        type: "buttons",
        body: "Choose an option",
        buttons: [
          { id: "a", label: "One" },
          { id: "b", label: "Two" },
          { id: "c", label: "Three" },
          { id: "d", label: "Four" }, // should be truncated
        ],
      },
    });

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { buttons: unknown[] }];
    expect((content as { buttons: unknown[] }).buttons).toHaveLength(3);
  });

  it("uses @g.us JID for group targets containing a dash", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.sendMessage({
      targetId: "1234567890-1680000000",
      content: { type: "text", text: "Hi group!" },
    });

    const [jid] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(jid).toBe("1234567890-1680000000@g.us");
  });

  it("passes through targets that already include @", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.sendMessage({
      targetId: "15551234567@s.whatsapp.net",
      content: { type: "text", text: "Hi" },
    });

    const [jid] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string];
    expect(jid).toBe("15551234567@s.whatsapp.net");
  });

  it("sends multiple content items sequentially", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.sendMessage({
      targetId: "15551234567",
      content: [
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ],
    });

    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// A2H — AUTHORIZE
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter renderA2H — AUTHORIZE", () => {
  it("uses buttons for AUTHORIZE with ≤3 options (method 1)", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.renderA2H(
      {
        intent: "AUTHORIZE",
        context: {
          action: "deploy-to-production",
          options: ["Approve", "Reject"],
        },
        traceId: "trace_001",
      },
      { targetId: "15551234567" },
    );

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { buttons?: unknown[]; text?: string }];
    // Should use buttons (method 1)
    expect(content).toHaveProperty("buttons");
    expect((content as { buttons: unknown[] }).buttons).toHaveLength(2);
  });

  it("falls back to external form for AUTHORIZE with >3 options (method 3)", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.renderA2H(
      {
        intent: "AUTHORIZE",
        context: {
          action: "pick-region",
          options: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
        },
        traceId: "trace_002",
      },
      { targetId: "15551234567" },
    );

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { text?: string; buttons?: unknown[] }];
    // Should NOT use buttons — should include a form URL in the text
    expect(content).not.toHaveProperty("buttons");
    expect((content as { text: string }).text).toContain("openthreads.test");
  });

  it("includes the trace ID in the form URL for AUTHORIZE method-3", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.renderA2H(
      {
        intent: "AUTHORIZE",
        context: { action: "approve", options: ["A", "B", "C", "D"] },
        traceId: "trace_xyz",
      },
      { targetId: "15551234567" },
    );

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { text: string }];
    expect((content as { text: string }).text).toContain("trace_xyz");
  });
});

// ---------------------------------------------------------------------------
// A2H — COLLECT
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter renderA2H — COLLECT", () => {
  it("always falls back to external form (method 3)", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    await adapter.renderA2H(
      {
        intent: "COLLECT",
        context: { question: "What is your shipping address?" },
        traceId: "trace_collect_001",
      },
      { targetId: "15551234567" },
    );

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { text: string; buttons?: unknown[] }];
    expect(content).not.toHaveProperty("buttons");
    expect((content as { text: string }).text).toContain("openthreads.test");
  });

  it("sends a plain message when serverBaseUrl is not configured", async () => {
    const { adapter, mockSocket } = createTestAdapter({
      config: {
        sessionDir: "/tmp/session",
        logLevel: "silent",
        // no serverBaseUrl
      },
    });
    await adapter.initialize();

    await adapter.renderA2H(
      {
        intent: "COLLECT",
        context: { question: "Your name?" },
        traceId: "trace_no_url",
      },
      { targetId: "15551234567" },
    );

    const [, content] = (mockSocket.sendMessage as ReturnType<typeof mock>).mock.calls[0] as [string, { text: string }];
    expect((content as { text: string }).text).toBeTruthy();
    // Should not contain undefined/null URL
    expect((content as { text: string }).text).not.toContain("undefined");
    expect((content as { text: string }).text).not.toContain("null");
  });
});

// ---------------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter inbound messages", () => {
  it("dispatches text messages to the registered handler", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    const received: unknown[] = [];
    adapter.onInboundMessage(async (msg) => {
      received.push(msg);
    });

    // Simulate an inbound text message from Baileys.
    mockSocket.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "15559876543@s.whatsapp.net",
            id: "msg_inbound_001",
            fromMe: false,
          },
          message: { conversation: "Hello!" },
          messageTimestamp: 1_700_000_000,
          pushName: "Alice",
        },
      ],
    });

    // Allow microtask queue to drain.
    await Promise.resolve();

    expect(received).toHaveLength(1);
    const msg = received[0] as { content: { type: string; text: string }; senderName: string };
    expect(msg.content.type).toBe("text");
    expect(msg.content.text).toBe("Hello!");
    expect(msg.senderName).toBe("Alice");
  });

  it("ignores messages sent by the bot (fromMe = true)", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    const received: unknown[] = [];
    adapter.onInboundMessage(async (msg) => {
      received.push(msg);
    });

    mockSocket.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "15559876543@s.whatsapp.net",
            id: "msg_outbound",
            fromMe: true,
          },
          message: { conversation: "This is from us" },
          messageTimestamp: 1_700_000_000,
        },
      ],
    });

    await Promise.resolve();
    expect(received).toHaveLength(0);
  });

  it("ignores messages.upsert events with type != notify", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    const received: unknown[] = [];
    adapter.onInboundMessage(async (msg) => {
      received.push(msg);
    });

    mockSocket.ev.emit("messages.upsert", {
      type: "append", // not "notify"
      messages: [
        {
          key: { remoteJid: "15559876543@s.whatsapp.net", id: "m1", fromMe: false },
          message: { conversation: "Hi" },
          messageTimestamp: 1_700_000_000,
        },
      ],
    });

    await Promise.resolve();
    expect(received).toHaveLength(0);
  });

  it("extracts threadId from quoted message context", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    const received: unknown[] = [];
    adapter.onInboundMessage(async (msg) => {
      received.push(msg);
    });

    mockSocket.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "15559876543@s.whatsapp.net",
            id: "reply_msg",
            fromMe: false,
          },
          message: {
            extendedTextMessage: {
              text: "Yes, I agree",
              contextInfo: { stanzaId: "original_msg_id" },
            },
          },
          messageTimestamp: 1_700_000_001,
        },
      ],
    });

    await Promise.resolve();
    const msg = received[0] as { threadId: string; replyToId: string };
    expect(msg.threadId).toBe("original_msg_id");
    expect(msg.replyToId).toBe("original_msg_id");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("WhatsAppAdapter lifecycle", () => {
  it("calls logout on destroy", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();
    await adapter.destroy();
    expect(mockSocket.logout).toHaveBeenCalledTimes(1);
  });

  it("clears inbound handler on destroy", async () => {
    const { adapter, mockSocket } = createTestAdapter();
    await adapter.initialize();

    const received: unknown[] = [];
    adapter.onInboundMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.destroy();

    // After destroy, sending a message should not invoke the handler.
    mockSocket.ev.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { remoteJid: "1@s.whatsapp.net", id: "m", fromMe: false },
          message: { conversation: "Late message" },
        },
      ],
    });

    await Promise.resolve();
    expect(received).toHaveLength(0);
  });
});
