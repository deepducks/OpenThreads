import type { OpenThreadsMessage } from './message.js';

/**
 * Direction of a turn within a thread.
 * - inbound:  A message arriving from a human sender via a channel.
 * - outbound: A message sent to a human sender via a channel (the reply).
 */
export type TurnDirection = 'inbound' | 'outbound';

/**
 * A Turn represents one individual interaction within a Thread —
 * one sender-message → recipient-response cycle.
 */
export interface Turn {
  /** OpenThreads turn identifier, prefixed with "ot_turn_" */
  turnId: string;
  /** The thread this turn belongs to */
  threadId: string;
  /** Whether this is an inbound (human→system) or outbound (system→human) message */
  direction: TurnDirection;
  /** The message payload (Chat SDK or A2H, single or array) */
  message: OpenThreadsMessage | OpenThreadsMessage[];
  /** Timestamp of this turn */
  timestamp: Date;
}

export type CreateTurnInput = Omit<Turn, 'turnId' | 'timestamp'> & {
  turnId?: string;
  timestamp?: Date;
};
