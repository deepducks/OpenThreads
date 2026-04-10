/**
 * Shared adapter conformance test suite.
 *
 * Usage in your adapter's test file:
 *
 *   import { runConformanceSuite } from "@openthreads/core/testing";
 *   import { describe } from "bun:test";
 *
 *   describe("SlackAdapter conformance", () => {
 *     runConformanceSuite(() => createMockAdapter());
 *   });
 */

import { describe, it, expect, mock } from "bun:test";
import type { ChannelAdapter, InboundEnvelope } from "../types.js";

/**
 * Run the full conformance suite against an adapter factory.
 * @param factory - Returns a freshly-constructed, not-yet-started adapter instance.
 */
export function runConformanceSuite(factory: () => ChannelAdapter): void {
  describe("capabilities()", () => {
    it("returns an object with all required capability fields", () => {
      const adapter = factory();
      const caps = adapter.capabilities();

      expect(typeof caps.threads).toBe("boolean");
      expect(typeof caps.buttons).toBe("boolean");
      expect(typeof caps.selectMenus).toBe("boolean");
      expect(typeof caps.replyMessages).toBe("boolean");
      expect(typeof caps.dms).toBe("boolean");
      expect(typeof caps.fileUpload).toBe("boolean");
    });
  });

  describe("onMessage()", () => {
    it("accepts a handler function without throwing", () => {
      const adapter = factory();
      expect(() => {
        adapter.onMessage(async (_envelope: InboundEnvelope) => {});
      }).not.toThrow();
    });
  });

  describe("interface contract", () => {
    it("exposes start() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.start).toBe("function");
    });

    it("exposes stop() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.stop).toBe("function");
    });

    it("exposes send() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.send).toBe("function");
    });

    it("exposes requestA2H() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.requestA2H).toBe("function");
    });

    it("exposes capabilities() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.capabilities).toBe("function");
    });

    it("exposes onMessage() as a function", () => {
      const adapter = factory();
      expect(typeof adapter.onMessage).toBe("function");
    });
  });
}
