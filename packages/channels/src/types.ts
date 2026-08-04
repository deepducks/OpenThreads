import type { Channel } from '@openthreads/core'

export interface ChannelAdapter {
  channel: Channel
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(target: string, message: unknown): Promise<void>
}
