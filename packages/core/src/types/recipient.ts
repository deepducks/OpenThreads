/**
 * A Recipient represents an external system (agent, API, service) that
 * consumes messages from OpenThreads and sends replies back.
 * It is the interface between OpenThreads and the machine world.
 */
export interface Recipient {
  /** Unique identifier for the recipient */
  id: string;
  /** The URL to POST outbound envelopes to */
  webhookUrl: string;
  /** Optional API key for authenticating outbound webhook calls */
  apiKey?: string;
  /** Arbitrary metadata for this recipient */
  metadata?: Record<string, unknown>;
}

export type CreateRecipientInput = Recipient;
