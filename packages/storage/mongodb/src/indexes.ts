/**
 * Index creation for all OpenThreads collections.
 *
 * Indexes are designed for the common access patterns described in the issue:
 *
 *  threads:
 *    - threadId (unique) — primary lookup by ID
 *    - channelId + nativeThreadId — map native platform thread to OpenThreads thread
 *    - channelId + targetId — list threads for a given target in a channel
 *
 *  turns:
 *    - turnId (unique) — primary lookup by ID
 *    - threadId + timestamp — paginated timeline of turns in a thread
 *
 *  routes:
 *    - routeId (unique) — primary lookup by ID
 *    - criteria fields (individual) — efficient matching by any single criterion
 *    - active + priority — list active routes sorted by priority
 *
 *  tokens:
 *    - value (unique) — lookup by token value embedded in URLs
 *    - expiresAt (TTL, 0 seconds) — MongoDB auto-expires documents
 *
 *  channels:
 *    - channelId (unique) — primary lookup by ID
 *    - apiKey (unique) — lookup by API key for authentication
 *
 *  recipients:
 *    - recipientId (unique) — primary lookup by ID
 */

import type { Db } from 'mongodb';

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    ensureChannelIndexes(db),
    ensureRecipientIndexes(db),
    ensureThreadIndexes(db),
    ensureTurnIndexes(db),
    ensureRouteIndexes(db),
    ensureTokenIndexes(db),
  ]);
}

async function ensureChannelIndexes(db: Db): Promise<void> {
  const col = db.collection('channels');
  await col.createIndexes([
    { key: { channelId: 1 }, unique: true, name: 'channelId_unique' },
    { key: { apiKey: 1 }, unique: true, name: 'apiKey_unique' },
    { key: { platform: 1 }, name: 'platform' },
    { key: { active: 1 }, name: 'active' },
  ]);
}

async function ensureRecipientIndexes(db: Db): Promise<void> {
  const col = db.collection('recipients');
  await col.createIndexes([
    { key: { recipientId: 1 }, unique: true, name: 'recipientId_unique' },
    { key: { active: 1 }, name: 'active' },
  ]);
}

async function ensureThreadIndexes(db: Db): Promise<void> {
  const col = db.collection('threads');
  await col.createIndexes([
    // Primary unique lookup by OpenThreads thread ID.
    { key: { threadId: 1 }, unique: true, name: 'threadId_unique' },
    // Map native platform thread to OpenThreads thread.
    {
      key: { channelId: 1, nativeThreadId: 1 },
      name: 'channelId_nativeThreadId',
      // Partial filter: only index docs where nativeThreadId is set.
      partialFilterExpression: { nativeThreadId: { $exists: true } },
    },
    // List threads for a given target (group/user) within a channel.
    { key: { channelId: 1, targetId: 1 }, name: 'channelId_targetId' },
  ]);
}

async function ensureTurnIndexes(db: Db): Promise<void> {
  const col = db.collection('turns');
  await col.createIndexes([
    // Primary unique lookup by OpenThreads turn ID.
    { key: { turnId: 1 }, unique: true, name: 'turnId_unique' },
    // Paginated timeline of turns in a thread.
    { key: { threadId: 1, timestamp: 1 }, name: 'threadId_timestamp' },
  ]);
}

async function ensureRouteIndexes(db: Db): Promise<void> {
  const col = db.collection('routes');
  await col.createIndexes([
    // Primary unique lookup by route ID.
    { key: { routeId: 1 }, unique: true, name: 'routeId_unique' },
    // List active routes sorted by priority.
    { key: { active: 1, priority: -1 }, name: 'active_priority' },
    // Individual criteria field indexes for efficient matching.
    { key: { 'criteria.channelId': 1 }, name: 'criteria_channelId' },
    { key: { 'criteria.targetId': 1 }, name: 'criteria_targetId' },
    { key: { 'criteria.senderId': 1 }, name: 'criteria_senderId' },
    { key: { 'criteria.threadId': 1 }, name: 'criteria_threadId' },
    { key: { 'criteria.isDM': 1 }, name: 'criteria_isDM' },
    { key: { 'criteria.mentionOnly': 1 }, name: 'criteria_mentionOnly' },
  ]);
}

async function ensureTokenIndexes(db: Db): Promise<void> {
  const col = db.collection('tokens');
  await col.createIndexes([
    // Primary unique lookup by token value (what's embedded in URLs).
    { key: { value: 1 }, unique: true, name: 'value_unique' },
    { key: { tokenId: 1 }, unique: true, name: 'tokenId_unique' },
    // TTL index: MongoDB will automatically delete expired token documents.
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'expiresAt_ttl' },
    // Useful for listing tokens by channel/thread.
    { key: { channelId: 1, threadId: 1 }, name: 'channelId_threadId' },
  ]);
}
