/**
 * Seed script for development data.
 *
 * Creates sample channels, routes, and threads in MongoDB.
 *
 * Usage:
 *   bun scripts/seed.ts
 *
 * Requires MONGODB_URI to be set in .env or as an environment variable.
 */

import { MongoClient } from 'mongodb'

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://openthreads:openthreads@localhost:27017/openthreads'

async function seed() {
  const client = new MongoClient(MONGODB_URI)

  try {
    console.log('Connecting to MongoDB...')
    await client.connect()
    const db = client.db()

    // --- Channels ---
    console.log('Seeding channels...')
    await db.collection('channels').deleteMany({})
    await db.collection('channels').insertMany([
      {
        channelId: 'channel_slack_main',
        type: 'slack',
        name: 'Main Slack Bot',
        config: {
          botToken: 'xoxb-replace-with-real-token',
          signingSecret: 'replace-with-real-signing-secret',
        },
        createdAt: new Date(),
      },
      {
        channelId: 'channel_telegram_main',
        type: 'telegram',
        name: 'Main Telegram Bot',
        config: {
          botToken: 'replace-with-real-telegram-bot-token',
        },
        createdAt: new Date(),
      },
    ])

    // --- Routes ---
    console.log('Seeding routes...')
    await db.collection('routes').deleteMany({})
    await db.collection('routes').insertMany([
      {
        routeId: 'route_default_slack',
        name: 'Default Slack Route',
        channelId: 'channel_slack_main',
        recipient: {
          webhookUrl: 'http://localhost:8080/webhook',
        },
        filters: {},
        createdAt: new Date(),
      },
      {
        routeId: 'route_default_telegram',
        name: 'Default Telegram Route',
        channelId: 'channel_telegram_main',
        recipient: {
          webhookUrl: 'http://localhost:8080/webhook',
        },
        filters: {},
        createdAt: new Date(),
      },
    ])

    // --- Threads ---
    console.log('Seeding threads...')
    await db.collection('threads').deleteMany({})
    await db.collection('threads').insertMany([
      {
        threadId: 'ot_thr_sample001',
        channelId: 'channel_slack_main',
        nativeThreadId: 'T_SAMPLE_001',
        turns: [],
        createdAt: new Date(),
      },
      {
        threadId: 'ot_thr_sample002',
        channelId: 'channel_telegram_main',
        nativeThreadId: null,
        turns: [],
        createdAt: new Date(),
      },
    ])

    console.log('✓ Seed completed successfully')
    console.log('  - 2 channels created')
    console.log('  - 2 routes created')
    console.log('  - 2 threads created')
  } catch (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  } finally {
    await client.close()
  }
}

seed()
