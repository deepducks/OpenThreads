import { describe, it, expect } from 'bun:test'

describe('@openthreads/storage-mongodb', () => {
  it('exports MongoDBStorageAdapter', async () => {
    const { MongoDBStorageAdapter } = await import('./index')
    expect(MongoDBStorageAdapter).toBeDefined()
  })
})
