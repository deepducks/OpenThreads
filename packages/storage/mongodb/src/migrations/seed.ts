import type { Db } from 'mongodb';

/**
 * Seed the database with initial data for development and testing.
 * Safe to run multiple times (idempotent — uses upserts).
 */
export async function seedDatabase(db: Db): Promise<void> {
  await seedChannels(db);
  await seedRecipients(db);
  await seedRoutes(db);
}

async function seedChannels(db: Db): Promise<void> {
  const channels = db.collection('channels');
  const now = new Date();

  const defaultChannel = {
    channelId: 'example-slack',
    type: 'slack',
    name: 'Example Slack Workspace',
    config: {
      botToken: 'xoxb-example-token',
      signingSecret: 'example-signing-secret',
    },
    active: false,
    createdAt: now,
    updatedAt: now,
  };

  await channels.updateOne(
    { channelId: defaultChannel.channelId },
    { $setOnInsert: defaultChannel },
    { upsert: true }
  );

  console.log('[seed] channels: done');
}

async function seedRecipients(db: Db): Promise<void> {
  const recipients = db.collection('recipients');
  const now = new Date();

  const defaultRecipient = {
    recipientId: 'example-recipient',
    name: 'Example Recipient',
    webhookUrl: 'https://example.com/webhook',
    active: false,
    createdAt: now,
    updatedAt: now,
  };

  await recipients.updateOne(
    { recipientId: defaultRecipient.recipientId },
    { $setOnInsert: defaultRecipient },
    { upsert: true }
  );

  console.log('[seed] recipients: done');
}

async function seedRoutes(db: Db): Promise<void> {
  const routes = db.collection('routes');
  const now = new Date();

  const catchAllRoute = {
    routeId: 'catch-all',
    name: 'Catch-All Route',
    criteria: {},
    recipientId: 'example-recipient',
    priority: 999,
    active: false,
    createdAt: now,
    updatedAt: now,
  };

  await routes.updateOne(
    { routeId: catchAllRoute.routeId },
    { $setOnInsert: catchAllRoute },
    { upsert: true }
  );

  console.log('[seed] routes: done');
}
