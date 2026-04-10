/**
 * Migration and seed utilities for the OpenThreads MongoDB storage.
 *
 * These utilities assist with:
 * - Ensuring all required indexes are present (idempotent).
 * - Seeding initial data for development/testing.
 * - Dropping all collections (useful for test teardown).
 */

import type { Db } from 'mongodb';
import { ensureIndexes } from './indexes.js';

// ---------------------------------------------------------------------------
// Collection names
// ---------------------------------------------------------------------------

export const COLLECTION_NAMES = [
  'channels',
  'recipients',
  'threads',
  'turns',
  'routes',
  'tokens',
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

// ---------------------------------------------------------------------------
// migrate()
// ---------------------------------------------------------------------------

/**
 * Run all migrations against the given database.
 *
 * Currently this only ensures indexes are present, but this function is the
 * designated extension point for future schema migrations.
 *
 * This operation is **idempotent** — safe to call on every startup.
 */
export async function migrate(db: Db): Promise<void> {
  await ensureIndexes(db);
}

// ---------------------------------------------------------------------------
// dropCollections()
// ---------------------------------------------------------------------------

/**
 * Drop all OpenThreads collections from the database.
 *
 * **Destructive.** Intended for test teardown only. Never call in production.
 */
export async function dropCollections(db: Db): Promise<void> {
  const existingCollections = await db.listCollections().toArray();
  const existingNames = new Set(existingCollections.map((c) => c.name));

  await Promise.all(
    COLLECTION_NAMES
      .filter((name) => existingNames.has(name))
      .map((name) => db.collection(name).drop()),
  );
}

// ---------------------------------------------------------------------------
// seed()
// ---------------------------------------------------------------------------

export interface SeedData {
  channels?: SeedChannel[];
  recipients?: SeedRecipient[];
  routes?: SeedRoute[];
}

export interface SeedChannel {
  channelId: string;
  platform: string;
  name: string;
  apiKey: string;
  config?: Record<string, unknown>;
}

export interface SeedRecipient {
  recipientId: string;
  name: string;
  webhookUrl: string;
  webhookSecret?: string;
}

export interface SeedRoute {
  routeId: string;
  recipientId: string;
  criteria?: {
    channelId?: string;
    targetId?: string;
    isDM?: boolean;
    mentionOnly?: boolean;
    senderId?: string;
    contentPattern?: string;
    threadId?: string;
  };
  priority?: number;
  description?: string;
}

/**
 * Seed the database with initial data.
 *
 * Uses `upsert` semantics — safe to call multiple times. Existing documents
 * are not overwritten (matched by their unique ID field).
 */
export async function seed(db: Db, data: SeedData): Promise<void> {
  const now = new Date();

  const ops: Promise<unknown>[] = [];

  if (data.channels?.length) {
    const channelsCol = db.collection('channels');
    for (const ch of data.channels) {
      ops.push(
        channelsCol.updateOne(
          { channelId: ch.channelId },
          {
            $setOnInsert: {
              ...ch,
              config: ch.config ?? {},
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        ),
      );
    }
  }

  if (data.recipients?.length) {
    const recipientsCol = db.collection('recipients');
    for (const r of data.recipients) {
      ops.push(
        recipientsCol.updateOne(
          { recipientId: r.recipientId },
          {
            $setOnInsert: {
              ...r,
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        ),
      );
    }
  }

  if (data.routes?.length) {
    const routesCol = db.collection('routes');
    for (const route of data.routes) {
      ops.push(
        routesCol.updateOne(
          { routeId: route.routeId },
          {
            $setOnInsert: {
              ...route,
              criteria: route.criteria ?? {},
              priority: route.priority ?? 0,
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        ),
      );
    }
  }

  await Promise.all(ops);
}
