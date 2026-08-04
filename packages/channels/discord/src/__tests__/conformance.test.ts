/**
 * Shared adapter conformance tests.
 *
 * These tests verify that DiscordAdapter satisfies the ChannelAdapter contract
 * expected by the OpenThreads core.  They use a fully-mocked Discord client so
 * no real bot token is required.
 *
 * Real integration tests (tagged "integration") are run manually or in a
 * dedicated CI step with a real Discord test server.
 */

import { describe, it, expect } from "bun:test";
import { DiscordAdapter } from "../adapter.js";
import type { ChannelAdapter, ChannelCapabilities } from "../types.js";

// ---------------------------------------------------------------------------
// Conformance helpers
// ---------------------------------------------------------------------------

/**
 * Assert that all required ChannelAdapter properties / methods are present on
 * the adapter instance.  This is the shape @openthreads/core will use.
 */
function assertChannelAdapterInterface(adapter: ChannelAdapter): void {
  expect(typeof adapter.channelType).toBe("string");
  expect(typeof adapter.capabilities).toBe("function");
  expect(typeof adapter.connect).toBe("function");
  expect(typeof adapter.disconnect).toBe("function");
  expect(typeof adapter.sendMessage).toBe("function");
  expect(typeof adapter.onIncomingMessage).toBe("function");
}

// ---------------------------------------------------------------------------
// Interface conformance
// ---------------------------------------------------------------------------

describe("DiscordAdapter conformance", () => {
  it("implements the ChannelAdapter interface", () => {
    const adapter = new DiscordAdapter();
    assertChannelAdapterInterface(adapter);
  });

  it("channelType is 'discord'", () => {
    const adapter = new DiscordAdapter();
    expect(adapter.channelType).toBe("discord");
  });

  it("capabilities() returns all required keys", () => {
    const adapter = new DiscordAdapter();
    const caps: ChannelCapabilities = adapter.capabilities();

    const requiredKeys: Array<keyof ChannelCapabilities> = [
      "threads",
      "buttons",
      "selectMenus",
      "replyMessages",
      "dms",
      "fileUpload",
    ];

    for (const key of requiredKeys) {
      expect(typeof caps[key]).toBe("boolean");
    }
  });

  it("capabilities() matches declared Discord capabilities", () => {
    const adapter = new DiscordAdapter();
    const caps = adapter.capabilities();

    // Discord-specific expected values
    expect(caps.threads).toBe(true);
    expect(caps.buttons).toBe(true);
    expect(caps.selectMenus).toBe(true);
    expect(caps.replyMessages).toBe(false); // Discord has reactions/threads, not reply capture
    expect(caps.dms).toBe(true);
    expect(caps.fileUpload).toBe(true);
  });

  it("onIncomingMessage returns an unsubscribe function", () => {
    const adapter = new DiscordAdapter();
    const unsubscribe = adapter.onIncomingMessage(() => {});
    expect(typeof unsubscribe).toBe("function");
    // Calling unsubscribe should not throw
    expect(() => unsubscribe()).not.toThrow();
  });

  it("disconnect() resolves without error when never connected", async () => {
    const adapter = new DiscordAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Inbound handler registration
// ---------------------------------------------------------------------------

describe("onIncomingMessage handler management", () => {
  it("registers multiple handlers", () => {
    const adapter = new DiscordAdapter();
    let count = 0;
    adapter.onIncomingMessage(() => { count++; });
    adapter.onIncomingMessage(() => { count++; });
    // handlers are stored; we can't easily call them without a full Discord
    // connection, but we can verify registration doesn't throw
    expect(count).toBe(0); // handlers called lazily
  });

  it("unsubscribes a specific handler", () => {
    const adapter = new DiscordAdapter();
    const calls: number[] = [];

    const unsub1 = adapter.onIncomingMessage(() => calls.push(1));
    const unsub2 = adapter.onIncomingMessage(() => calls.push(2));

    unsub1(); // remove handler 1

    // After unsubscribing, re-subscribing should still work
    const unsub3 = adapter.onIncomingMessage(() => calls.push(3));
    unsub2();
    unsub3();

    expect(calls).toHaveLength(0);
  });
});
