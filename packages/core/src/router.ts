import type { InboundMessage, Route, RouteCriteria } from "./types.ts";

/**
 * Converts a glob pattern string into a RegExp.
 *
 * Supported wildcards:
 *   `*`  — matches any sequence of characters (including empty)
 *   `?`  — matches exactly one character
 *
 * Matching is case-insensitive and anchored (full-string match).
 */
export function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  for (const ch of pattern) {
    if (ch === "*") {
      regexStr += ".*";
    } else if (ch === "?") {
      regexStr += ".";
    } else {
      // Escape all regex meta-characters so literal dots, brackets, etc. work.
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Returns `true` if `value` satisfies the given pattern.
 *
 * The pattern is first tried as a glob (supports `*` and `?`); if it contains
 * no wildcards it falls back to a case-insensitive exact string comparison.
 */
export function matchGlob(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

/**
 * Tests a single string criterion against an actual value.
 *
 * - `undefined` criterion → matches anything
 * - Single string          → glob-matched against `value`
 * - Array of strings       → OR: matches if any element matches
 */
function matchStringCriterion(
  criterion: string | string[] | undefined,
  value: string,
): boolean {
  if (criterion === undefined) return true;
  if (Array.isArray(criterion)) {
    return criterion.some((pattern) => matchGlob(pattern, value));
  }
  return matchGlob(criterion, value);
}

/**
 * Tests a boolean criterion against an actual flag.
 *
 * - `undefined` → matches regardless of `value`
 * - `true`/`false` → must equal `value` exactly
 */
function matchBooleanCriterion(
  criterion: boolean | undefined,
  value: boolean,
): boolean {
  if (criterion === undefined) return true;
  return criterion === value;
}

/**
 * Returns `true` if the given `message` satisfies all criteria defined in
 * `criteria`.  All specified fields must match (AND logic across fields).
 */
function matchesCriteria(
  criteria: RouteCriteria,
  message: InboundMessage,
): boolean {
  return (
    matchStringCriterion(criteria.channel, message.channel) &&
    matchStringCriterion(criteria.target, message.target) &&
    matchStringCriterion(criteria.sender, message.sender) &&
    matchStringCriterion(criteria.content, message.content) &&
    matchBooleanCriterion(criteria.isThread, message.isThread) &&
    matchBooleanCriterion(criteria.isMention, message.isMention) &&
    matchBooleanCriterion(criteria.isDM, message.isDM)
  );
}

/**
 * Route matching engine.
 *
 * Given a list of configured routes and an inbound message, returns an ordered
 * list of matching routes sorted by descending priority (highest first).
 *
 * Behaviour:
 * - Disabled routes are never included.
 * - Routes with overlapping criteria may all match — every matching route is
 *   returned (fan-out is handled by the caller using `route.recipientIds`).
 * - If no routes match an empty array is returned.
 * - The input `routes` array is never mutated.
 *
 * @param routes  Full list of configured routes.
 * @param message Metadata for the inbound message to match against.
 * @returns       Matching routes ordered by descending priority.
 */
export function router(routes: Route[], message: InboundMessage): Route[] {
  return routes
    .filter((route) => route.enabled && matchesCriteria(route.criteria, message))
    .sort((a, b) => b.priority - a.priority);
}
