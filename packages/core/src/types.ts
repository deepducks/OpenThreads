// Core types for OpenThreads

export interface Thread {
  threadId: string
  channelId: string
  nativeThreadId?: string
  createdAt: Date
}

export interface Turn {
  turnId: string
  threadId: string
  message: Message | Message[]
  createdAt: Date
}

export type Message = ChatMessage | A2HIntent

export interface ChatMessage {
  text: string
  attachments?: unknown[]
}

export type A2HIntentType = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT'

export interface A2HIntent {
  intent: A2HIntentType
  context: Record<string, unknown>
  traceId?: string
}

export interface Envelope {
  threadId: string
  turnId: string
  replyTo: string
  source: {
    channel: string
    channelId: string
    sender: { id: string; name: string }
  }
  message: Message | Message[]
}

export interface Channel {
  channelId: string
  type: string
  name: string
  config: Record<string, unknown>
  createdAt: Date
}

export interface Route {
  routeId: string
  name: string
  channelId: string
  recipient: {
    webhookUrl: string
  }
  filters: Record<string, unknown>
  createdAt: Date
}

export interface StorageAdapter {
  getThread(threadId: string): Promise<Thread | null>
  createThread(thread: Omit<Thread, 'createdAt'>): Promise<Thread>
  getChannel(channelId: string): Promise<Channel | null>
  getRoutes(channelId: string): Promise<Route[]>
}
