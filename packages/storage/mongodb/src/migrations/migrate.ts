import { MongoClient } from 'mongodb';
import {
  ensureChannelsIndexes,
  ensureRecipientsIndexes,
  ensureThreadsIndexes,
  ensureTurnsIndexes,
  ensureRoutesIndexes,
  ensureTokensIndexes,
} from '../indexes.js';
import { seedDatabase } from './seed.js';

export interface MigrateOptions {
  uri: string;
  dbName?: string;
  seed?: boolean;
}

/**
 * Run all migrations against the target MongoDB instance.
 * Creates all collections (implicitly) and their indexes.
 *
 * Safe to run repeatedly — MongoDB's createIndex is idempotent for identical index specs.
 */
export async function migrate(options: MigrateOptions): Promise<void> {
  const client = new MongoClient(options.uri);
  const dbName = options.dbName ?? 'openthreads';

  try {
    console.log(`[migrate] connecting to ${options.uri} / ${dbName} ...`);
    await client.connect();
    const db = client.db(dbName);

    console.log('[migrate] ensuring indexes ...');
    await Promise.all([
      ensureChannelsIndexes(db.collection('channels')),
      ensureRecipientsIndexes(db.collection('recipients')),
      ensureThreadsIndexes(db.collection('threads')),
      ensureTurnsIndexes(db.collection('turns')),
      ensureRoutesIndexes(db.collection('routes')),
      ensureTokensIndexes(db.collection('tokens')),
    ]);
    console.log('[migrate] indexes: ok');

    if (options.seed) {
      console.log('[migrate] seeding initial data ...');
      await seedDatabase(db);
      console.log('[migrate] seed: ok');
    }

    console.log('[migrate] done');
  } finally {
    await client.close();
  }
}

// CLI entry-point: bun packages/storage/mongodb/src/migrations/migrate.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const uri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017';
  const dbName = process.env['MONGODB_DB'] ?? 'openthreads';
  const seed = process.env['SEED'] === 'true';

  migrate({ uri, dbName, seed }).catch((err) => {
    console.error('[migrate] error:', err);
    process.exit(1);
  });
}
