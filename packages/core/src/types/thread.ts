/**
 * Thread — a conversation identified by an OpenThreads-generated threadId.
 *
 * Three scenarios:
 * - Native threads (Slack, Discord forums): 1:1 mapping with native thread.
 * - Channels without threads (Telegram DM, WhatsApp): virtual threads via reply chains.
 * - Messages outside threads: belong to the target's "main thread" (isMain = true).
 */
export interface Thread {
  /** OpenThreads-generated thread identifier (e.g. "ot_thr_abc123") */
  threadId: string;
  /** The channel this thread belongs to */
  channelId: string;
  /**
   * The native thread/conversation ID from the platform (if applicable).
   * For Slack: thread_ts. For Discord: message ID of the parent. Null for virtual threads.
   */
  nativeThreadId?: string;
  /**
   * The target entity on the platform (channel, group, DM, user, etc.).
   * E.g. Slack channel ID "C0123", Telegram chat_id "-100456".
   */
  targetId: string;
  /** The recipient currently associated with this thread (if any) */
  recipientId?: string;
  /**
   * Whether this is the "main thread" for the given channel+target pair.
   * Messages outside native threads fall into the main thread.
   */
  isMain: boolean;
  /** Metadata about the thread's current state */
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type ThreadInput = Omit<Thread, 'createdAt' | 'updatedAt'>;
