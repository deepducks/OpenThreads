/**
 * A2H (Agent-to-Human) Protocol intent types.
 *
 * 5 atomic, composable intents from the A2H spec (Twilio, Feb 2026):
 *
 * - INFORM:    Fire-and-forget notification. "Letting you know I did X."
 * - COLLECT:   Blocking request to collect structured data. "What's your address?"
 * - AUTHORIZE: Blocking request for approval with evidence. "Can I deploy to prod?"
 * - ESCALATE:  Handoff to a human operator.
 * - RESULT:    Returns a task result to the agent.
 */
export type A2HIntent = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT';

/**
 * Context payload carried within an A2H message. Contains structured
 * intent-specific data (action, details, fields, evidence, etc.).
 */
export type A2HContext = Record<string, unknown>;

/**
 * An A2H message sent by a recipient (agent/system) in the reply envelope.
 * Detected via duck-typing: presence of `intent` field marks a message as A2H.
 */
export interface A2HMessage {
  /** The A2H intent type — presence of this field is the duck-typing discriminator */
  intent: A2HIntent;
  /** Structured context for the intent (action details, fields to collect, etc.) */
  context?: A2HContext;
  /** Human-readable description of the intent for display purposes */
  description?: string;
  /** Trace/correlation ID for audit purposes */
  traceId?: string;
  /** Idempotency key to prevent duplicate processing */
  idempotencyKey?: string;
}
