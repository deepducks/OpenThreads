import type { Collection, IndexDescription } from 'mongodb';

/**
 * All index definitions for the OpenThreads MongoDB collections.
 * Call ensureIndexes() once at startup or during migration.
 */

export async function ensureThreadsIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    // Unique lookup by threadId
    { key: { threadId: 1 }, unique: true, name: 'threads_threadId_unique' },
    // Look up thread by native platform thread ID within a channel
    { key: { channelId: 1, nativeThreadId: 1 }, name: 'threads_channelId_nativeThreadId' },
    // Look up the main thread for a channel+target pair
    { key: { channelId: 1, targetId: 1 }, name: 'threads_channelId_targetId' },
  ] as IndexDescription[]);
}

export async function ensureTurnsIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    // Unique lookup by turnId
    { key: { turnId: 1 }, unique: true, name: 'turns_turnId_unique' },
    // Chronological listing of turns within a thread
    { key: { threadId: 1, timestamp: 1 }, name: 'turns_threadId_timestamp' },
  ] as IndexDescription[]);
}

export async function ensureRoutesIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    // Efficient matching queries against criteria fields
    { key: { 'criteria.channelId': 1 }, sparse: true, name: 'routes_criteria_channelId' },
    { key: { 'criteria.channelType': 1 }, sparse: true, name: 'routes_criteria_channelType' },
    { key: { 'criteria.targetId': 1 }, sparse: true, name: 'routes_criteria_targetId' },
    { key: { 'criteria.senderId': 1 }, sparse: true, name: 'routes_criteria_senderId' },
    // Priority ordering for route evaluation
    { key: { active: 1, priority: 1 }, name: 'routes_active_priority' },
    // Lookup by recipient
    { key: { recipientId: 1 }, name: 'routes_recipientId' },
  ] as IndexDescription[]);
}

export async function ensureTokensIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    // Unique lookup by token value
    { key: { value: 1 }, unique: true, name: 'tokens_value_unique' },
    // TTL index — MongoDB automatically deletes expired token documents
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'tokens_expiresAt_ttl' },
    // Scoped lookups
    { key: { channelId: 1 }, name: 'tokens_channelId' },
    { key: { threadId: 1 }, name: 'tokens_threadId' },
  ] as IndexDescription[]);
}

export async function ensureChannelsIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    // Unique lookup by channelId (also _id, but keep explicit index for clarity)
    { key: { channelId: 1 }, unique: true, name: 'channels_channelId_unique' },
    // Quick lookup by API key
    { key: { apiKey: 1 }, sparse: true, unique: true, name: 'channels_apiKey_unique' },
  ] as IndexDescription[]);
}

export async function ensureRecipientsIndexes(collection: Collection): Promise<void> {
  await collection.createIndexes([
    { key: { recipientId: 1 }, unique: true, name: 'recipients_recipientId_unique' },
  ] as IndexDescription[]);
}
