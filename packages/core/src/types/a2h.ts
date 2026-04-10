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

// ---------------------------------------------------------------------------
// Specific A2H intent types — used by channel adapter implementations
// ---------------------------------------------------------------------------

/**
 * INFORM intent — fire-and-forget notification, no response expected.
 */
export interface A2HInformIntent {
  intent: 'INFORM';
  /** Unique identifier for this intent instance */
  id: string;
  /** The notification text to display */
  text: string;
  context?: A2HContext;
  traceId?: string;
}

/**
 * AUTHORIZE intent — blocking request for human approval.
 */
export interface A2HAuthorizeIntent {
  intent: 'AUTHORIZE';
  /** Unique identifier for this intent instance */
  id: string;
  context: {
    /** Short description of the action requiring approval */
    action: string;
    /** Optional additional details */
    details?: string;
    [key: string]: unknown;
  };
  description?: string;
  traceId?: string;
}

/**
 * A single option in a COLLECT intent with closed options.
 */
export interface A2HCollectOption {
  /** Display label shown to the human */
  label: string;
  /** Machine-readable value returned when this option is selected */
  value: string;
}

/**
 * COLLECT intent — blocking request to collect a response from the human.
 * When `options` is provided, the adapter renders a selection UI (buttons/menu).
 * When `options` is absent, the adapter captures free-text input.
 */
export interface A2HCollectIntent {
  intent: 'COLLECT';
  /** Unique identifier for this intent instance */
  id: string;
  /** The question to ask the human */
  question: string;
  /** Closed options — if provided, renders as a selection UI */
  options?: A2HCollectOption[];
  context?: A2HContext;
  traceId?: string;
}

/**
 * Union of the three primary interaction intent types used by channel adapters.
 * ESCALATE and RESULT are handled separately by the Reply Engine.
 */
export type A2HIntentMessage = A2HInformIntent | A2HAuthorizeIntent | A2HCollectIntent;
