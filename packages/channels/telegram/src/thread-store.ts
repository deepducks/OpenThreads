/**
 * Virtual thread store for the Telegram adapter.
 *
 * Telegram does not have native threads (unlike Slack or Discord forums).
 * OpenThreads emulates them via reply chains: when message B is a reply to
 * message A, they share a virtual thread.
 *
 * Thread resolution algorithm:
 *  1. A message with reply_to_message_id X → look up the thread that contains X.
 *  2. If found, add this message to that thread and return the same threadId.
 *  3. If not found, create a new thread seeded with [X, this_message_id].
 *  4. A message with no reply_to → always starts a new thread.
 *
 * This in-memory implementation is suitable for development and testing.
 * Production deployments should swap it for a persistent backend.
 */

import type { VirtualThread } from "./types.js";

export interface ThreadStore {
  /**
   * Resolve or create the threadId for a given (chatId, messageId) pair.
   * @param chatId       Telegram chat ID
   * @param messageId    The current message ID (string)
   * @param replyToId    The message ID being replied to, if any
   * @returns            The threadId to associate with this message
   */
  resolveThread(chatId: string, messageId: string, replyToId?: string): string;

  getThread(threadId: string): VirtualThread | undefined;

  getAllThreadsForChat(chatId: string): VirtualThread[];
}

function generateThreadId(): string {
  // Simple deterministic but unique ID: ot_thr_ + random hex
  return `ot_thr_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export class InMemoryThreadStore implements ThreadStore {
  /** threadId → VirtualThread */
  private readonly threads = new Map<string, VirtualThread>();
  /** "chatId:messageId" → threadId */
  private readonly messageIndex = new Map<string, string>();

  private key(chatId: string, messageId: string): string {
    return `${chatId}:${messageId}`;
  }

  resolveThread(chatId: string, messageId: string, replyToId?: string): string {
    // If we already know this message's thread, return it
    const existing = this.messageIndex.get(this.key(chatId, messageId));
    if (existing !== undefined) return existing;

    if (replyToId !== undefined) {
      // Check if the replied-to message belongs to a known thread
      const parentThreadId = this.messageIndex.get(this.key(chatId, replyToId));
      if (parentThreadId !== undefined) {
        // Extend the existing thread
        const thread = this.threads.get(parentThreadId)!;
        thread.messageIds.push(messageId);
        thread.updatedAt = new Date();
        this.messageIndex.set(this.key(chatId, messageId), parentThreadId);
        return parentThreadId;
      }

      // Neither the reply-to nor the current message is in a known thread.
      // Create a new virtual thread seeded with both.
      const newThreadId = generateThreadId();
      const now = new Date();
      const thread: VirtualThread = {
        threadId: newThreadId,
        chatId,
        messageIds: [replyToId, messageId],
        createdAt: now,
        updatedAt: now,
      };
      this.threads.set(newThreadId, thread);
      this.messageIndex.set(this.key(chatId, replyToId), newThreadId);
      this.messageIndex.set(this.key(chatId, messageId), newThreadId);
      return newThreadId;
    }

    // No reply → new standalone thread
    const newThreadId = generateThreadId();
    const now = new Date();
    const thread: VirtualThread = {
      threadId: newThreadId,
      chatId,
      messageIds: [messageId],
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(newThreadId, thread);
    this.messageIndex.set(this.key(chatId, messageId), newThreadId);
    return newThreadId;
  }

  getThread(threadId: string): VirtualThread | undefined {
    return this.threads.get(threadId);
  }

  getAllThreadsForChat(chatId: string): VirtualThread[] {
    return [...this.threads.values()].filter((t) => t.chatId === chatId);
  }
}
