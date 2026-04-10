import { describe, it, expect } from 'bun:test'

describe('@openthreads/core', () => {
  it('exports types', async () => {
    const mod = await import('./index')
    expect(mod).toBeDefined()
  })
})
