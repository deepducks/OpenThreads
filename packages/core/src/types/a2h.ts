/**
 * A2H (Agent-to-Human) Protocol intent types.
 *
 * ── Layer 1 (implemented) ───────────────────────────────────────────────────
 * 5 atomic, composable intents from the A2H spec (Twilio, Feb 2026):
 *
 * - INFORM:    Fire-and-forget notification. "Letting you know I did X."
 * - COLLECT:   Blocking request to collect structured data. "What's your address?"
 * - AUTHORIZE: Blocking request for approval with evidence. "Can I deploy to prod?"
 * - ESCALATE:  Handoff to a human operator.
 * - RESULT:    Returns a task result to the agent.
 *
 * ── Layer 2 (stubs — pending spec stabilisation) ───────────────────────────
 * Autonomy governance intents from the A2H roadmap. These are stubbed here to
 * allow type-safe extension without breaking Layer 1 consumers. Monitor
 * https://github.com/twilio-labs/a2h-spec for Layer 2 stabilisation.
 *
 * - POLICY:    Define a standing approval rule. "Pre-approve all deploys under $100."
 * - REVOKE:    Cancel a previously granted policy or delegation.
 * - DELEGATE:  Grant another agent or human the ability to act on your behalf.
 * - SCOPE:     Restrict or expand the authority of an agent for a defined context.
 */

// ── Layer 1 intents ───────────────────────────────────────────────────────────

export type A2HLayer1Intent = 'INFORM' | 'COLLECT' | 'AUTHORIZE' | 'ESCALATE' | 'RESULT';

// ── Layer 2 intents (stubs — not yet processed by the Reply Engine) ───────────

/**
 * POLICY — define a standing approval rule (e.g. "approve all transactions < $50").
 * @stub Layer 2 — monitor twilio-labs/a2h-spec for spec stabilisation.
 */
export type A2HPolicyIntent = 'POLICY';

/**
 * REVOKE — cancel a previously granted policy or delegation.
 * @stub Layer 2 — monitor twilio-labs/a2h-spec for spec stabilisation.
 */
export type A2HRevokeIntent = 'REVOKE';

/**
 * DELEGATE — grant another principal (agent or human) the ability to act on behalf of this principal.
 * @stub Layer 2 — monitor twilio-labs/a2h-spec for spec stabilisation.
 */
export type A2HDelegateIntent = 'DELEGATE';

/**
 * SCOPE — restrict or expand an agent's authority for a defined context window.
 * @stub Layer 2 — monitor twilio-labs/a2h-spec for spec stabilisation.
 */
export type A2HScopeIntent = 'SCOPE';

/** All Layer 2 intents (stubs). */
export type A2HLayer2Intent = A2HPolicyIntent | A2HRevokeIntent | A2HDelegateIntent | A2HScopeIntent;

/** Union of all A2H intents (Layer 1 + Layer 2 stubs). */
export type A2HIntent = A2HLayer1Intent | A2HLayer2Intent;

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

// ─── Type guards ──────────────────────────────────────────────────────────────

const LAYER1_INTENTS: ReadonlySet<string> = new Set<A2HLayer1Intent>([
  'INFORM', 'COLLECT', 'AUTHORIZE', 'ESCALATE', 'RESULT',
]);

const LAYER2_INTENTS: ReadonlySet<string> = new Set<A2HLayer2Intent>([
  'POLICY', 'REVOKE', 'DELEGATE', 'SCOPE',
]);

/** Returns true if the intent is a Layer 1 intent (fully supported). */
export function isLayer1Intent(intent: A2HIntent): intent is A2HLayer1Intent {
  return LAYER1_INTENTS.has(intent);
}

/** Returns true if the intent is a Layer 2 stub (not yet processed). */
export function isLayer2Intent(intent: A2HIntent): intent is A2HLayer2Intent {
  return LAYER2_INTENTS.has(intent);
}
