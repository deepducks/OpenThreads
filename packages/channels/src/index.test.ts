import { describe, it, expect } from 'bun:test'

describe('@openthreads/channels', () => {
  it('exports channel types', async () => {
    const mod = await import('./index')
    expect(mod).toBeDefined()
  })
})
