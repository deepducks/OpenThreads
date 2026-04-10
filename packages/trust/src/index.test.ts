import { describe, it, expect } from 'bun:test'

describe('@openthreads/trust', () => {
  it('exports trust types', async () => {
    const mod = await import('./index')
    expect(mod).toBeDefined()
  })
})
