/**
 * Thread management for OpenThreads.
 *
 * Handles the three thread scenarios described in the data model:
 *
 * 1. **Native threads** — channels that support threads natively (Slack,
 *    Discord forums).  OpenThreads maps their native thread IDs 1:1 to
 *    `ot_thr_*` identifiers.
 *
 * 2. **Virtual threads** — channels without native threads (Telegram DM,
 *    WhatsApp).  OpenThreads groups messages replied in sequence (reply
 *    chains) into a virtual thread.
 *
 * 3. **Main thread** — messages that arrive outside any explicit thread.
 *    Each (channel, target) pair has exactly one main thread.
 */

import type {
  StorageAdapter,
  ThreadRecord,
  CreateThreadOptions,
  CreateVirtualThreadOptions,
} from '../types/index.js';
import { generateThreadId } from '../utils/id.js';

export interface ThreadManagerOptions {
  storage: StorageAdapter;
}

export class ThreadManager {
  private readonly storage: StorageAdapter;

  constructor(options: ThreadManagerOptions) {
    this.storage = options.storage;
  }

  // ---------------------------------------------------------------------------
  // Native threads
  // ---------------------------------------------------------------------------

  /**
   * Create a new native thread.
   *
   * When `nativeThreadId` is provided the thread is also retrievable via
   * `getThreadByNativeId`.
   *
   * If a thread with the same `nativeThreadId` already exists for this
   * channel, the existing thread is returned instead of creating a duplicate.
   */
  async createThread(options: CreateThreadOptions): Promise<ThreadRecord> {
    const { channelId, targetId, nativeThreadId } = options;

    // De-duplicate on native thread ID.
    if (nativeThreadId) {
      const existing = await this.storage.getThreadByNativeId(channelId, nativeThreadId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date();
    const thread: ThreadRecord = {
      id: generateThreadId(),
      channelId,
      targetId,
      nativeThreadId,
      kind: 'native',
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveThread(thread);
    return thread;
  }

  // ---------------------------------------------------------------------------
  // Virtual threads (reply chains)
  // ---------------------------------------------------------------------------

  /**
   * Detect or create a virtual thread from a reply chain.
   *
   * A virtual thread is identified by the root message ID of its reply chain.
   * If any existing thread already contains the root message ID (first element
   * of `replyChain`), the existing thread is returned and its chain is
   * extended with any new message IDs.
   *
   * Use this when the platform lacks native thread support but tracks
   * message→reply relationships (e.g., Telegram, WhatsApp).
   */
  async detectOrCreateVirtualThread(
    options: CreateVirtualThreadOptions,
  ): Promise<ThreadRecord> {
    const { channelId, targetId, replyChain } = options;
    const rootMessageId = replyChain[0];

    // Look for an existing virtual thread whose chain starts with the same root.
    if (targetId) {
      const candidates = await this.storage.getThreadsByChannelAndTarget(channelId, targetId);
      for (const thread of candidates) {
        if (
          thread.kind === 'virtual' &&
          thread.replyChain &&
          thread.replyChain[0] === rootMessageId
        ) {
          // Merge any new message IDs into the existing chain.
          const existingSet = new Set(thread.replyChain);
          const newIds = replyChain.filter((id) => !existingSet.has(id));

          if (newIds.length > 0) {
            const updated: ThreadRecord = {
              ...thread,
              replyChain: [...thread.replyChain, ...newIds],
              updatedAt: new Date(),
            };
            await this.storage.saveThread(updated);
            return updated;
          }

          return thread;
        }
      }
    }

    const now = new Date();
    const thread: ThreadRecord = {
      id: generateThreadId(),
      channelId,
      targetId,
      kind: 'virtual',
      replyChain: [...replyChain],
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveThread(thread);
    return thread;
  }

  // ---------------------------------------------------------------------------
  // Main thread
  // ---------------------------------------------------------------------------

  /**
   * Get or create the "main" thread for a (channel, target) pair.
   *
   * Messages that arrive outside any explicit thread (native or virtual) are
   * attributed to the main thread.  There is exactly one main thread per
   * (channel, target) pair — subsequent calls return the same record.
   */
  async getOrCreateMainThread(channelId: string, targetId: string): Promise<ThreadRecord> {
    const existing = await this.storage.getMainThread(channelId, targetId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const thread: ThreadRecord = {
      id: generateThreadId(),
      channelId,
      targetId,
      kind: 'main',
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveThread(thread);
    return thread;
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  /**
   * Look up a thread by its OpenThreads ID.
   *
   * Returns `null` when the thread does not exist.
   */
  async getThreadById(threadId: string): Promise<ThreadRecord | null> {
    return this.storage.getThread(threadId);
  }

  /**
   * Look up a thread by the platform-native thread ID within a channel.
   *
   * Returns `null` when no matching thread exists.
   */
  async getThreadByNativeId(
    channelId: string,
    nativeThreadId: string,
  ): Promise<ThreadRecord | null> {
    return this.storage.getThreadByNativeId(channelId, nativeThreadId);
  }

  /**
   * Return all threads associated with a (channel, target) pair.
   *
   * May return multiple threads (native, virtual, or main).
   */
  async getThreadsByChannelAndTarget(
    channelId: string,
    targetId: string,
  ): Promise<ThreadRecord[]> {
    return this.storage.getThreadsByChannelAndTarget(channelId, targetId);
  }
}
