/**
 * Unit tests for type guards and message normalisation utilities.
 */

import { describe, expect, test } from "bun:test";
import {
  isA2HItem,
  isAuthorize,
  isCollect,
  isInform,
  isTextMessage,
  normaliseMessages,
} from "../src/guards.js";
import type { MessageItem } from "../src/types.js";

const textMsg: MessageItem = { text: "Hello" };

const authorizeIntent: MessageItem = {
  intent: "AUTHORIZE",
  requestId: "req-1",
  context: { action: "deploy" },
};

const collectIntent: MessageItem = {
  intent: "COLLECT",
  requestId: "req-2",
  question: "What is the ticket?",
};

const informIntent: MessageItem = {
  intent: "INFORM",
  requestId: "req-3",
  message: "Done.",
};

describe("isA2HItem", () => {
  test("returns true for AUTHORIZE", () => {
    expect(isA2HItem(authorizeIntent)).toBe(true);
  });

  test("returns true for COLLECT", () => {
    expect(isA2HItem(collectIntent)).toBe(true);
  });

  test("returns true for INFORM", () => {
    expect(isA2HItem(informIntent)).toBe(true);
  });

  test("returns false for a TextMessage", () => {
    expect(isA2HItem(textMsg)).toBe(false);
  });
});

describe("isAuthorize", () => {
  test("returns true for AUTHORIZE", () => {
    expect(isAuthorize(authorizeIntent as Parameters<typeof isAuthorize>[0])).toBe(true);
  });

  test("returns false for COLLECT", () => {
    expect(isAuthorize(collectIntent as Parameters<typeof isAuthorize>[0])).toBe(false);
  });
});

describe("isCollect", () => {
  test("returns true for COLLECT", () => {
    expect(isCollect(collectIntent as Parameters<typeof isCollect>[0])).toBe(true);
  });

  test("returns false for AUTHORIZE", () => {
    expect(isCollect(authorizeIntent as Parameters<typeof isCollect>[0])).toBe(false);
  });
});

describe("isInform", () => {
  test("returns true for INFORM", () => {
    expect(isInform(informIntent as Parameters<typeof isInform>[0])).toBe(true);
  });

  test("returns false for AUTHORIZE", () => {
    expect(isInform(authorizeIntent as Parameters<typeof isInform>[0])).toBe(false);
  });
});

describe("isTextMessage", () => {
  test("returns true for a TextMessage", () => {
    expect(isTextMessage(textMsg)).toBe(true);
  });

  test("returns false for an A2H item", () => {
    expect(isTextMessage(authorizeIntent)).toBe(false);
  });
});

describe("normaliseMessages", () => {
  test("wraps a single message in an array", () => {
    const result = normaliseMessages(textMsg);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(textMsg);
  });

  test("returns an array as-is", () => {
    const arr = [textMsg, authorizeIntent];
    const result = normaliseMessages(arr);
    expect(result).toBe(arr);
  });

  test("wraps an A2H item in an array", () => {
    const result = normaliseMessages(authorizeIntent);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(authorizeIntent);
  });
});
