/**
 * In-memory StorageAdapter implementation.
 *
 * Intended for testing and development.  Not suitable for production use
 * because state is lost on restart and is not shared between processes.
 */

import type {
  StorageAdapter,
  TokenRecord,
  ChannelApiKeyRecord,
  ThreadRecord,
  TurnRecord,
} from '../types/index.js';

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly channelApiKeys = new Map<string, ChannelApiKeyRecord>();
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly turns = new Map<string, TurnRecord>();

  // ------ Token operations -----------------------------------------------

  async saveToken(token: TokenRecord): Promise<void> {
    this.tokens.set(token.id, { ...token });
  }

  async getToken(tokenId: string): Promise<TokenRecord | null> {
    return this.tokens.get(tokenId) ?? null;
  }

  async deleteToken(tokenId: string): Promise<void> {
    this.tokens.delete(tokenId);
  }

  // ------ Channel API key operations -------------------------------------

  async saveChannelApiKey(key: ChannelApiKeyRecord): Promise<void> {
    this.channelApiKeys.set(key.id, { ...key });
  }

  async getChannelApiKey(keyId: string): Promise<ChannelApiKeyRecord | null> {
    return this.channelApiKeys.get(keyId) ?? null;
  }

  async deleteChannelApiKey(keyId: string): Promise<void> {
    this.channelApiKeys.delete(keyId);
  }

  // ------ Thread operations ----------------------------------------------

  async saveThread(thread: ThreadRecord): Promise<void> {
    this.threads.set(thread.id, { ...thread });
  }

  async getThread(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null;
  }

  async getThreadByNativeId(channelId: string, nativeThreadId: string): Promise<ThreadRecord | null> {
    for (const thread of this.threads.values()) {
      if (thread.channelId === channelId && thread.nativeThreadId === nativeThreadId) {
        return { ...thread };
      }
    }
    return null;
  }

  async getMainThread(channelId: string, targetId: string): Promise<ThreadRecord | null> {
    for (const thread of this.threads.values()) {
      if (thread.channelId === channelId && thread.targetId === targetId && thread.kind === 'main') {
        return { ...thread };
      }
    }
    return null;
  }

  async getThreadsByChannelAndTarget(channelId: string, targetId: string): Promise<ThreadRecord[]> {
    const results: ThreadRecord[] = [];
    for (const thread of this.threads.values()) {
      if (thread.channelId === channelId && thread.targetId === targetId) {
        results.push({ ...thread });
      }
    }
    return results;
  }

  // ------ Turn operations ------------------------------------------------

  async saveTurn(turn: TurnRecord): Promise<void> {
    this.turns.set(turn.id, { ...turn });
  }

  async getTurn(turnId: string): Promise<TurnRecord | null> {
    return this.turns.get(turnId) ?? null;
  }

  async listTurnsByThread(threadId: string): Promise<TurnRecord[]> {
    const results: TurnRecord[] = [];
    for (const turn of this.turns.values()) {
      if (turn.threadId === threadId) {
        results.push({ ...turn });
      }
    }
    return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
