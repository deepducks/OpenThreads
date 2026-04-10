/**
 * A Thread is a conversation identified by a unique OpenThreads-generated threadId.
 *
 * Three scenarios:
 * - Channel with native threads (Slack, Discord): nativeThreadId maps 1:1 to the native thread.
 * - Channel without threads (Telegram DM, WhatsApp): nativeThreadId is null; OpenThreads
 *   creates virtual threads by grouping messages in reply chains.
 * - Messages outside any thread: belong to the channel/target's "main thread"
 *   (nativeThreadId = null, special case).
 */
export interface Thread {
  /** OpenThreads thread identifier, prefixed with "ot_thr_" */
  threadId: string;
  /** The channel this thread belongs to */
  channelId: string;
  /** The native platform thread/channel/DM ID, or null for virtual threads */
  nativeThreadId: string | null;
  /** The target within the channel (group ID, DM user ID, channel name, etc.) */
  targetId: string;
  /** Timestamp when the thread was created in OpenThreads */
  createdAt: Date;
}

export type CreateThreadInput = Omit<Thread, 'threadId' | 'createdAt'> & {
  threadId?: string;
  createdAt?: Date;
};
