import {
  Client,
  TextChannel,
  ForumChannel,
  AnyThreadChannel,
  ChannelType,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { ThreadInfo } from "../types.js";

/**
 * Fetch an existing Discord thread and return its ThreadInfo.
 * Returns null if the thread does not exist or is not accessible.
 */
export async function getThread(
  client: Client,
  discordThreadId: string
): Promise<ThreadInfo | null> {
  try {
    const channel = await client.channels.fetch(discordThreadId);
    if (!channel || !channel.isThread()) return null;

    const thread = channel as AnyThreadChannel;
    return {
      id: discordThreadId, // 1:1 mapping: OpenThreads thread ID = Discord thread ID
      discordThreadId,
      discordParentChannelId: thread.parentId ?? "",
      name: thread.name,
      archived: thread.archived ?? false,
      createdAt: thread.createdAt ?? new Date(),
    };
  } catch {
    return null;
  }
}

/**
 * Create a new Discord thread in a text channel.
 *
 * For forum channels, `name` is required (it becomes the forum post title).
 * For text channels, the thread is started as a standalone thread (no starter
 * message) so that any OpenThreads message can open a thread ad-hoc.
 */
export async function createThread(
  client: Client,
  parentChannelId: string,
  name: string,
  options: {
    autoArchiveDuration?: ThreadAutoArchiveDuration;
    reason?: string;
  } = {}
): Promise<ThreadInfo> {
  const parent = await client.channels.fetch(parentChannelId);
  if (!parent) {
    throw new Error(`Channel ${parentChannelId} not found`);
  }

  const archiveDuration =
    options.autoArchiveDuration ?? ThreadAutoArchiveDuration.OneDay;

  let thread: AnyThreadChannel;

  if (parent.type === ChannelType.GuildForum) {
    // Forum channel — create a post (which is a thread with a starter message)
    const forumChannel = parent as ForumChannel;
    const post = await forumChannel.threads.create({
      name,
      autoArchiveDuration: archiveDuration,
      message: { content: name },
      reason: options.reason,
    });
    thread = post;
  } else if (
    parent.type === ChannelType.GuildText ||
    parent.type === ChannelType.GuildAnnouncement
  ) {
    const textChannel = parent as TextChannel;
    thread = await textChannel.threads.create({
      name,
      autoArchiveDuration: archiveDuration,
      reason: options.reason,
    });
  } else {
    throw new Error(
      `Cannot create thread in channel type ${parent.type}`
    );
  }

  return {
    id: thread.id,
    discordThreadId: thread.id,
    discordParentChannelId: thread.parentId ?? parentChannelId,
    name: thread.name,
    archived: false,
    createdAt: thread.createdAt ?? new Date(),
  };
}

/**
 * Ensure a thread is unarchived before attempting to send messages into it.
 */
export async function ensureThreadActive(
  client: Client,
  discordThreadId: string
): Promise<void> {
  const channel = await client.channels.fetch(discordThreadId);
  if (!channel?.isThread()) return;

  const thread = channel as AnyThreadChannel;
  if (thread.archived) {
    await thread.setArchived(false, "Reactivated by OpenThreads");
  }
}
