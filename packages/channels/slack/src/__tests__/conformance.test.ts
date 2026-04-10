/**
 * Shared adapter conformance suite — verifies SlackAdapter satisfies ChannelAdapter.
 */
import { describe } from "bun:test";
import { runConformanceSuite } from "@openthreads/core/testing";
import { SlackAdapter } from "../SlackAdapter.js";

function createMockBoltApp() {
  return {
    message: () => {},
    event: () => {},
    command: () => {},
    action: () => {},
    start: async () => {},
    stop: async () => {},
    client: {
      chat: {
        postMessage: async () => ({ ok: true, ts: "000.000" }),
        update: async () => ({ ok: true }),
      },
    },
  };
}

function createMockWebClient() {
  return {
    chat: {
      postMessage: async () => ({ ok: true, ts: "000.000" }),
      update: async () => ({ ok: true }),
    },
  };
}

describe("SlackAdapter conformance", () => {
  runConformanceSuite(
    () =>
      new SlackAdapter(
        { token: "xoxb-test", signingSecret: "sig-test" },
        createMockBoltApp() as any,
        createMockWebClient() as any
      )
  );
});
