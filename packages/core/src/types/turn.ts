/**
 * Turn — each individual interaction within a thread.
 * Represents one sender-message → recipient-response cycle,
 * identified by a turnId.
 */
export interface Turn {
  /** OpenThreads-generated turn identifier (e.g. "ot_turn_001") */
  turnId: string;
  /** The thread this turn belongs to */
  threadId: string;
  /** The inbound message from the sender (human) */
  inbound: TurnInbound;
  /** The outbound response from the recipient (system), if received */
  outbound?: TurnOutbound;
  /** Current lifecycle status of the turn */
  status: TurnStatus;
  /** Timestamp of the inbound message (used for chronological ordering) */
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TurnInbound {
  /** Raw message payload as received from the channel */
  message: unknown;
  /** Sender identity on the platform */
  sender: {
    id: string;
    name?: string;
    username?: string;
  };
  /** When the message was received */
  timestamp: Date;
  /** Native message ID from the platform */
  nativeMessageId?: string;
}

export interface TurnOutbound {
  /** Reply payload sent back to the channel */
  message: unknown;
  /** When the reply was sent */
  timestamp: Date;
  /** Native message ID of the reply on the platform */
  nativeMessageId?: string;
}

export type TurnStatus = 'pending' | 'delivered' | 'responded' | 'failed';

export type TurnInput = Omit<Turn, 'createdAt' | 'updatedAt'>;
