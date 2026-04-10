import type { MongoClient, Db } from 'mongodb'
import type { StorageAdapter, Thread, Channel, Route } from '@openthreads/core'

export class MongoDBStorageAdapter implements StorageAdapter {
  private db: Db

  constructor(client: MongoClient, dbName?: string) {
    this.db = client.db(dbName)
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const doc = await this.db.collection<Thread>('threads').findOne({ threadId })
    return doc ?? null
  }

  async createThread(thread: Omit<Thread, 'createdAt'>): Promise<Thread> {
    const doc: Thread = { ...thread, createdAt: new Date() }
    await this.db.collection<Thread>('threads').insertOne(doc)
    return doc
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const doc = await this.db.collection<Channel>('channels').findOne({ channelId })
    return doc ?? null
  }

  async getRoutes(channelId: string): Promise<Route[]> {
    return this.db.collection<Route>('routes').find({ channelId }).toArray()
  }
}
