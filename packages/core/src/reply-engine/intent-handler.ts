/**
 * Extension point for custom A2H intent handlers in the Reply Engine.
 *
 * This module defines the IntentHandler interface and the IntentHandlerRegistry,
 * which allows registering handlers for Layer 2 intents (POLICY, REVOKE, DELEGATE,
 * SCOPE) or overriding the default handling of Layer 1 intents.
 *
 * ## When to use
 *
 * - **Layer 2 intents (stub):** Register handlers for `POLICY`, `REVOKE`, `DELEGATE`,
 *   `SCOPE` when the A2H Layer 2 spec stabilises. Until then, unhandled Layer 2 intents
 *   are acknowledged with a `layer2_not_implemented` response.
 *
 * - **Custom Layer 1 overrides:** Override the built-in handling for `INFORM`, `COLLECT`,
 *   `AUTHORIZE`, `ESCALATE`, or `RESULT` for specific deployments (e.g., custom auth flow).
 *
 * ## Registration
 *
 * ```ts
 * import { intentHandlerRegistry } from '@openthreads/core/reply-engine';
 *
 * intentHandlerRegistry.register('POLICY', async (message, context) => {
 *   // Parse the standing approval rule from message.context
 *   // Persist to your policy store
 *   // Return an acknowledgement
 *   return {
 *     intent: 'POLICY',
 *     response: { acknowledged: true, policyId: 'pol_...' },
 *     respondedAt: new Date(),
 *   };
 * });
 * ```
 *
 * @see https://github.com/twilio-labs/a2h-spec — Layer 2 spec (roadmap)
 */

import type { A2HMessage, A2HIntent } from '../types/a2h.js';

// ─── IntentHandler interface ──────────────────────────────────────────────────

/**
 * The context passed to a custom intent handler.
 */
export interface IntentHandlerContext {
  /** The turn identifier for this interaction. */
  turnId: string;
  /** The OpenThreads channel ID this intent arrived on. */
  channelId?: string;
}

/**
 * The response returned by a custom intent handler.
 * Mirrors the A2HResponse shape expected by the Reply Engine.
 */
export interface IntentHandlerResponse {
  intent: A2HIntent;
  /** The handler's response payload. Shape is intent-specific. */
  response: unknown;
  /** Optional human-readable comment (e.g., for AUTHORIZE). */
  comment?: string;
  /** When the response was generated. */
  respondedAt: Date;
  /** Handler-specific metadata (for audit/debug). */
  meta?: Record<string, unknown>;
}

/**
 * A handler function for a specific A2H intent type.
 *
 * Handlers are async functions that receive an A2H message and return a response.
 * Throwing from a handler causes the Reply Engine to reject the intent with an error.
 */
export type IntentHandlerFn = (
  message: A2HMessage,
  context: IntentHandlerContext,
) => Promise<IntentHandlerResponse>;

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Registry of custom intent handlers.
 *
 * Handlers registered here are invoked by the Reply Engine when it encounters
 * an intent of the matching type. Built-in Layer 1 handling takes precedence
 * unless a handler is explicitly registered for a Layer 1 intent type.
 */
export class IntentHandlerRegistry {
  private readonly handlers = new Map<A2HIntent, IntentHandlerFn>();

  /**
   * Register a handler for the given intent type.
   * Replaces any previously registered handler for the same intent.
   */
  register(intent: A2HIntent, handler: IntentHandlerFn): this {
    this.handlers.set(intent, handler);
    return this;
  }

  /**
   * Remove the handler for the given intent type.
   */
  unregister(intent: A2HIntent): this {
    this.handlers.delete(intent);
    return this;
  }

  /**
   * Returns the handler registered for the given intent type, or `undefined` if none.
   */
  get(intent: A2HIntent): IntentHandlerFn | undefined {
    return this.handlers.get(intent);
  }

  /**
   * Returns true if a handler is registered for the given intent type.
   */
  has(intent: A2HIntent): boolean {
    return this.handlers.has(intent);
  }
}

/**
 * Global intent handler registry shared across all Reply Engine instances.
 *
 * Register Layer 2 handlers here once the A2H spec stabilises:
 * ```ts
 * import { intentHandlerRegistry } from '@openthreads/core';
 *
 * intentHandlerRegistry.register('POLICY', myPolicyHandler);
 * intentHandlerRegistry.register('REVOKE', myRevokeHandler);
 * ```
 */
export const intentHandlerRegistry = new IntentHandlerRegistry();
