/**
 * Turn management for OpenThreads.
 *
 * Each turn represents one sender-message → recipient-response cycle within
 * a thread.  Turns are logged for every inbound and outbound interaction,
 * forming a chronological audit trail of all activity within a thread.
 */

import type {
  StorageAdapter,
  TurnRecord,
  CreateTurnOptions,
} from '../types/index.js';
import { generateTurnId } from '../utils/id.js';

export interface TurnManagerOptions {
  storage: StorageAdapter;
}

export class TurnManager {
  private readonly storage: StorageAdapter;

  constructor(options: TurnManagerOptions) {
    this.storage = options.storage;
  }

  // ---------------------------------------------------------------------------
  // Turn creation
  // ---------------------------------------------------------------------------

  /**
   * Log an inbound or outbound interaction as a turn within a thread.
   *
   * Every time a message is received from a sender or forwarded to a recipient,
   * call this method to record the event.  The resulting `TurnRecord` is
   * persisted and retrievable via `getTurnById` or `listTurnsByThread`.
   *
   * @returns the newly created `TurnRecord`.
   */
  async createTurn(options: CreateTurnOptions): Promise<TurnRecord> {
    const { threadId, direction, message, senderId, recipientId } = options;

    const turn: TurnRecord = {
      id: generateTurnId(),
      threadId,
      direction,
      message,
      senderId,
      recipientId,
      createdAt: new Date(),
    };

    await this.storage.saveTurn(turn);
    return turn;
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  /**
   * Look up a single turn by its ID.
   *
   * Returns `null` when the turn does not exist.
   */
  async getTurnById(turnId: string): Promise<TurnRecord | null> {
    return this.storage.getTurn(turnId);
  }

  /**
   * Return all turns for a thread in chronological order (oldest first).
   *
   * Returns an empty array when the thread has no turns.
   */
  async listTurns(threadId: string): Promise<TurnRecord[]> {
    return this.storage.listTurnsByThread(threadId);
  }
}
