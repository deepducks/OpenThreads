/**
 * Recipient — an external system that consumes messages from OpenThreads
 * and optionally sends replies back (agent, API, service, n8n workflow, etc.).
 * Represents the interface with the machine world.
 */
export interface Recipient {
  /** Unique identifier for the recipient */
  recipientId: string;
  /** Human-readable display name */
  name: string;
  /** Webhook URL where OpenThreads delivers inbound envelopes */
  webhookUrl: string;
  /** Optional secret for signing outbound webhook requests */
  webhookSecret?: string;
  /** Whether the recipient is currently active */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type RecipientInput = Omit<Recipient, 'createdAt' | 'updatedAt'>;
