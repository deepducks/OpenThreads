/**
 * Route matching engine for OpenThreads.
 *
 * Given a set of configured routes and an inbound message, the engine returns
 * the ordered list of matching routes (descending priority).  Each matching
 * route's recipients all receive the message (fan-out).
 */

import type { Route, InboundMessage, RouteCriteria } from './types.js';

// ─── Glob matching ───────────────────────────────────────────────────────────

/**
 * Convert a glob pattern string into a RegExp.
 *
 * Supported wildcards:
 *  - `*`  matches zero or more characters (excluding path separators is not
 *         enforced here — all characters are fair game for chat IDs/text).
 *  - `?`  matches exactly one character.
 *
 * All other regex metacharacters are escaped so that literal dots, brackets,
 * etc. in channel/user IDs don't cause unexpected behaviour.
 *
 * Matching is case-insensitive to accommodate platforms that vary their casing
 * (e.g. Slack user IDs are uppercase, but configs may use lowercase).
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    // Escape all regex metacharacters except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // * → match any sequence of characters
    .replace(/\*/g, '.*')
    // ? → match exactly one character
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Test whether `value` matches `pattern` using glob semantics.
 */
export function matchGlob(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

// ─── Criterion matching ──────────────────────────────────────────────────────

/**
 * Match a single message field against a string criterion.
 *
 * - `undefined` criterion → always matches (wildcard / "any").
 * - A single string → matched as a glob pattern.
 * - An array of strings → OR semantics; matches if *any* pattern matches.
 */
export function matchStringCriterion(
  criterion: string | string[] | undefined,
  value: string,
): boolean {
  if (criterion === undefined) return true;
  const patterns = Array.isArray(criterion) ? criterion : [criterion];
  return patterns.some((pattern) => matchGlob(pattern, value));
}

/**
 * Match a boolean message field against a boolean criterion.
 *
 * - `undefined` criterion → always matches.
 * - Defined criterion → must equal the field value exactly.
 */
export function matchBooleanCriterion(
  criterion: boolean | undefined,
  value: boolean,
): boolean {
  return criterion === undefined || criterion === value;
}

// ─── Route matching ──────────────────────────────────────────────────────────

/**
 * Test whether an inbound message satisfies all criteria of a single route.
 *
 * All criteria fields use AND semantics — every *defined* field must match.
 * Disabled routes never match.
 */
export function matchRoute(route: Route, message: InboundMessage): boolean {
  if (!route.enabled) return false;

  const c: RouteCriteria = route.criteria;

  return (
    matchStringCriterion(c.channel, message.channel) &&
    matchStringCriterion(c.target, message.target) &&
    matchStringCriterion(c.sender, message.sender) &&
    matchStringCriterion(c.content, message.content) &&
    matchBooleanCriterion(c.isThread, message.isThread) &&
    matchBooleanCriterion(c.isMention, message.isMention) &&
    matchBooleanCriterion(c.isDM, message.isDM)
  );
}

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Route an inbound message against a set of configured routes.
 *
 * @param routes  The full set of routes to evaluate (order does not matter as
 *                input — the function sorts by priority internally).
 * @param message The inbound message metadata to match against.
 * @returns       An ordered list of matching {@link Route}s, sorted by
 *                descending priority (highest priority first).  Returns an
 *                empty array when no route matches.
 *
 * Behaviour guarantees:
 * - Disabled routes are always excluded.
 * - Multiple routes may match the same message (overlapping routes are all
 *   returned; it is the caller's responsibility to fan-out to all recipients).
 * - Routes with equal priority retain their relative input order (stable sort).
 * - The original `routes` array is never mutated.
 */
export function router(routes: Route[], message: InboundMessage): Route[] {
  return routes
    .filter((r) => matchRoute(r, message))
    .sort((a, b) => b.priority - a.priority);
}
