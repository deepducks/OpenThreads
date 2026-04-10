import type { EnvelopeMessage } from './message.js';

/**
 * Source information carried in the outbound envelope — describes the originating
 * channel and the human sender.
 */
export interface EnvelopeSource {
  /** The platform identifier (e.g., "slack", "telegram") */
  channel: string;
  /** The OpenThreads channel ID */
  channelId: string;
  /** The human sender */
  sender: {
    /** Native platform user ID */
    id: string;
    /** Display name of the sender */
    name?: string;
  };
}

/**
 * An ephemeral token record issued for a replyTo URL.
 */
export interface Token {
  /** OpenThreads token identifier, prefixed with "ot_tk_" */
  id: string;
  /** The thread this token is scoped to */
  threadId: string;
  /** Expiry timestamp */
  expiresAt: Date;
  /** Whether the token has been revoked */
  revoked: boolean;
}

/**
 * The OpenThreads Envelope — the canonical routing wrapper sent to recipients
 * (recipient outbound) and received back from recipients (recipient inbound).
 *
 * Outbound (OpenThreads → recipient):
 *   Carries threadId, turnId, a replyTo URL, source info, and the inbound message.
 *
 * Inbound (recipient → OpenThreads):
 *   The `message` field accepts Chat SDK messages, A2H messages, or mixed arrays.
 *   Type is inferred automatically via duck typing (presence of `intent` = A2H).
 */
export interface Envelope {
  /** OpenThreads thread identifier (ot_thr_*) */
  threadId: string;
  /** OpenThreads turn identifier (ot_turn_*) */
  turnId: string;
  /**
   * Pre-authenticated reply URL for the recipient to POST responses back.
   * Includes an ephemeral token (?token=ot_tk_*) with a configurable TTL (default 24h).
   *
   * Example: https://openthreads.host/send/channel/slack-main/target/C0123/thread/ot_thr_abc123?token=ot_tk_e8f2a1
   */
  replyTo: string;
  /** Source channel and sender information */
  source: EnvelopeSource;
  /**
   * The message payload. Accepts:
   * - A single Chat SDK or A2H message object (treated as a 1-item array)
   * - An array of Chat SDK and/or A2H messages (processed sequentially by the Reply Engine)
   */
  message: EnvelopeMessage;
}
