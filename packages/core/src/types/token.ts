/**
 * Token — an ephemeral authentication token included in replyTo URLs.
 *
 * When OpenThreads delivers an outbound envelope, the replyTo URL includes
 * a `?token=ot_tk_...` with a configurable TTL (default 24h). This allows
 * recipients to reply without managing an API key — the token is scoped to
 * the specific thread/message.
 */
export interface Token {
  /** Unique identifier for the token record */
  tokenId: string;
  /** The actual token value included in the URL (e.g. "ot_tk_e8f2a1...") */
  value: string;
  /** The channel this token grants access to */
  channelId: string;
  /** The thread this token is scoped to */
  threadId: string;
  /** The specific turn this token was generated for (if applicable) */
  turnId?: string;
  /** When the token expires — MongoDB TTL index will auto-delete expired tokens */
  expiresAt: Date;
  /** Whether the token has already been used (for single-use tokens) */
  used: boolean;
  createdAt: Date;
}

export type TokenInput = Omit<Token, 'createdAt'>;
