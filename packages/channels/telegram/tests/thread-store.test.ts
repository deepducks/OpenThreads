/**
 * Unit tests for the InMemoryThreadStore (virtual thread management).
 */

import { describe, it, expect } from "bun:test";
import { InMemoryThreadStore } from "../src/thread-store.js";

describe("InMemoryThreadStore", () => {
  describe("resolveThread", () => {
    it("creates a new thread for a standalone message", () => {
      const store = new InMemoryThreadStore();
      const threadId = store.resolveThread("chat1", "msg1");
      expect(threadId).toMatch(/^ot_thr_/);
    });

    it("returns the same threadId for the same message", () => {
      const store = new InMemoryThreadStore();
      const t1 = store.resolveThread("chat1", "msg1");
      const t2 = store.resolveThread("chat1", "msg1");
      expect(t1).toBe(t2);
    });

    it("different standalone messages get different threads", () => {
      const store = new InMemoryThreadStore();
      const t1 = store.resolveThread("chat1", "msg1");
      const t2 = store.resolveThread("chat1", "msg2");
      expect(t1).not.toBe(t2);
    });

    it("a reply to an unknown message creates a new thread seeded with both messages", () => {
      const store = new InMemoryThreadStore();
      const threadId = store.resolveThread("chat1", "msg2", "msg1");
      expect(threadId).toMatch(/^ot_thr_/);

      const thread = store.getThread(threadId);
      expect(thread).toBeDefined();
      expect(thread!.messageIds).toContain("msg1");
      expect(thread!.messageIds).toContain("msg2");
    });

    it("a reply to a known message extends the existing thread", () => {
      const store = new InMemoryThreadStore();
      const t1 = store.resolveThread("chat1", "msg1");       // standalone
      const t2 = store.resolveThread("chat1", "msg2", "msg1"); // reply to msg1

      expect(t2).toBe(t1);

      const thread = store.getThread(t1);
      expect(thread!.messageIds).toContain("msg2");
    });

    it("a reply chain (A → B → C) all belong to the same thread", () => {
      const store = new InMemoryThreadStore();
      const tA = store.resolveThread("chat1", "msgA");
      const tB = store.resolveThread("chat1", "msgB", "msgA");
      const tC = store.resolveThread("chat1", "msgC", "msgB");

      expect(tB).toBe(tA);
      expect(tC).toBe(tA);
    });

    it("threads are isolated by chatId", () => {
      const store = new InMemoryThreadStore();
      const t1 = store.resolveThread("chat1", "msg1");
      const t2 = store.resolveThread("chat2", "msg1");
      expect(t1).not.toBe(t2);
    });
  });

  describe("getThread", () => {
    it("returns undefined for unknown threadId", () => {
      const store = new InMemoryThreadStore();
      expect(store.getThread("ot_thr_unknown")).toBeUndefined();
    });

    it("returns the thread with correct metadata", () => {
      const store = new InMemoryThreadStore();
      const threadId = store.resolveThread("chat1", "msg1");
      const thread = store.getThread(threadId);

      expect(thread).toBeDefined();
      expect(thread!.threadId).toBe(threadId);
      expect(thread!.chatId).toBe("chat1");
      expect(thread!.messageIds).toEqual(["msg1"]);
      expect(thread!.createdAt).toBeInstanceOf(Date);
      expect(thread!.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getAllThreadsForChat", () => {
    it("returns empty array for unknown chatId", () => {
      const store = new InMemoryThreadStore();
      expect(store.getAllThreadsForChat("unknown")).toEqual([]);
    });

    it("returns all threads for a given chatId", () => {
      const store = new InMemoryThreadStore();
      store.resolveThread("chat1", "msg1");
      store.resolveThread("chat1", "msg2");
      store.resolveThread("chat2", "msg3");

      const threads = store.getAllThreadsForChat("chat1");
      expect(threads).toHaveLength(2);
      expect(threads.every((t) => t.chatId === "chat1")).toBe(true);
    });
  });
});
