import { describe, it, expect } from 'bun:test';
import {
  globToRegex,
  matchGlob,
  matchStringCriterion,
  matchBooleanCriterion,
  matchRoute,
  router,
} from './router.js';
import type { Route, InboundMessage, Recipient } from './types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const alice: Recipient = { id: 'r1', name: 'Alice', url: 'https://alice.example.com/webhook' };
const bob: Recipient = { id: 'r2', name: 'Bob', url: 'https://bob.example.com/webhook' };

/** Convenience factory for test routes */
function makeRoute(overrides: Partial<Route> & { id?: string }): Route {
  return {
    id: overrides.id ?? 'r-default',
    name: overrides.name ?? 'Default Route',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 0,
    criteria: overrides.criteria ?? {},
    recipients: overrides.recipients ?? [alice],
  };
}

/** A generic inbound message used as the baseline for most tests */
const baseMessage: InboundMessage = {
  channel: 'slack-main',
  target: 'C0123',
  sender: 'U456',
  content: 'Hello world',
  isThread: false,
  isMention: false,
  isDM: false,
};

// ─── globToRegex ─────────────────────────────────────────────────────────────

describe('globToRegex', () => {
  it('produces a case-insensitive regex anchored at both ends', () => {
    const re = globToRegex('hello');
    expect(re.flags).toContain('i');
    expect(re.source).toBe('^hello$');
  });

  it('converts * to .*', () => {
    const re = globToRegex('foo*');
    expect(re.source).toBe('^foo.*$');
  });

  it('converts ? to .', () => {
    const re = globToRegex('foo?');
    expect(re.source).toBe('^foo.$');
  });

  it('escapes regex metacharacters', () => {
    const re = globToRegex('U.456');
    // The dot should be escaped → \\.
    expect(re.source).toBe('^U\\.456$');
  });

  it('handles a pattern with no wildcards', () => {
    const re = globToRegex('slack-main');
    expect('slack-main').toMatch(re);
    expect('slack-other').not.toMatch(re);
  });
});

// ─── matchGlob ───────────────────────────────────────────────────────────────

describe('matchGlob', () => {
  it('matches exact strings', () => {
    expect(matchGlob('hello', 'hello')).toBe(true);
    expect(matchGlob('hello', 'world')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchGlob('Hello', 'hello')).toBe(true);
    expect(matchGlob('SLACK-MAIN', 'slack-main')).toBe(true);
  });

  it('* matches zero or more characters', () => {
    expect(matchGlob('slack-*', 'slack-main')).toBe(true);
    expect(matchGlob('slack-*', 'slack-')).toBe(true);
    expect(matchGlob('slack-*', 'slack')).toBe(false);
    expect(matchGlob('*', 'anything')).toBe(true);
    expect(matchGlob('*', '')).toBe(true);
  });

  it('? matches exactly one character', () => {
    expect(matchGlob('U?56', 'U456')).toBe(true);
    expect(matchGlob('U?56', 'U4556')).toBe(false);
    expect(matchGlob('U?56', 'U56')).toBe(false);
  });

  it('handles multiple wildcards', () => {
    expect(matchGlob('*hello*', 'say hello world')).toBe(true);
    expect(matchGlob('*hello*', 'goodbye')).toBe(false);
    expect(matchGlob('U?4*', 'U456extra')).toBe(true);
  });

  it('treats literal dots in channel/user IDs correctly', () => {
    expect(matchGlob('user.name', 'user.name')).toBe(true);
    // A literal dot should NOT act as regex "any char"
    expect(matchGlob('user.name', 'userXname')).toBe(false);
  });

  it('matches content patterns', () => {
    expect(matchGlob('deploy *', 'deploy feature-x to staging')).toBe(true);
    expect(matchGlob('deploy *', 'please deploy')).toBe(false);
    expect(matchGlob('*error*', 'unexpected error occurred')).toBe(true);
  });
});

// ─── matchStringCriterion ────────────────────────────────────────────────────

describe('matchStringCriterion', () => {
  it('returns true when criterion is undefined (wildcard)', () => {
    expect(matchStringCriterion(undefined, 'any-value')).toBe(true);
  });

  it('matches a single string pattern', () => {
    expect(matchStringCriterion('slack-main', 'slack-main')).toBe(true);
    expect(matchStringCriterion('slack-main', 'discord-general')).toBe(false);
  });

  it('matches a single glob pattern', () => {
    expect(matchStringCriterion('slack-*', 'slack-main')).toBe(true);
    expect(matchStringCriterion('slack-*', 'discord-general')).toBe(false);
  });

  it('uses OR semantics for arrays — any match is sufficient', () => {
    expect(matchStringCriterion(['slack-main', 'discord-general'], 'discord-general')).toBe(true);
    expect(matchStringCriterion(['slack-main', 'discord-general'], 'telegram-chat')).toBe(false);
  });

  it('supports glob patterns inside arrays', () => {
    expect(matchStringCriterion(['slack-*', 'discord-*'], 'discord-general')).toBe(true);
    expect(matchStringCriterion(['slack-*', 'discord-*'], 'telegram-chat')).toBe(false);
  });

  it('handles an empty array as never-matching', () => {
    expect(matchStringCriterion([], 'anything')).toBe(false);
  });
});

// ─── matchBooleanCriterion ───────────────────────────────────────────────────

describe('matchBooleanCriterion', () => {
  it('returns true when criterion is undefined (wildcard)', () => {
    expect(matchBooleanCriterion(undefined, true)).toBe(true);
    expect(matchBooleanCriterion(undefined, false)).toBe(true);
  });

  it('matches when criterion equals value', () => {
    expect(matchBooleanCriterion(true, true)).toBe(true);
    expect(matchBooleanCriterion(false, false)).toBe(true);
  });

  it('does not match when criterion differs from value', () => {
    expect(matchBooleanCriterion(true, false)).toBe(false);
    expect(matchBooleanCriterion(false, true)).toBe(false);
  });
});

// ─── matchRoute ──────────────────────────────────────────────────────────────

describe('matchRoute', () => {
  it('matches when all criteria are undefined (catch-all route)', () => {
    const route = makeRoute({ criteria: {} });
    expect(matchRoute(route, baseMessage)).toBe(true);
  });

  it('does not match when route is disabled', () => {
    const route = makeRoute({ enabled: false, criteria: {} });
    expect(matchRoute(route, baseMessage)).toBe(false);
  });

  it('matches on exact channel', () => {
    const route = makeRoute({ criteria: { channel: 'slack-main' } });
    expect(matchRoute(route, baseMessage)).toBe(true);
    expect(matchRoute(route, { ...baseMessage, channel: 'discord-general' })).toBe(false);
  });

  it('matches on channel glob', () => {
    const route = makeRoute({ criteria: { channel: 'slack-*' } });
    expect(matchRoute(route, baseMessage)).toBe(true);
    expect(matchRoute(route, { ...baseMessage, channel: 'discord-general' })).toBe(false);
  });

  it('matches on sender glob', () => {
    const route = makeRoute({ criteria: { sender: 'U*' } });
    expect(matchRoute(route, baseMessage)).toBe(true);
    expect(matchRoute(route, { ...baseMessage, sender: 'bot-123' })).toBe(false);
  });

  it('matches on content glob', () => {
    const route = makeRoute({ criteria: { content: 'Hello *' } });
    expect(matchRoute(route, baseMessage)).toBe(true);
    expect(matchRoute(route, { ...baseMessage, content: 'Goodbye world' })).toBe(false);
  });

  it('matches on isThread boolean', () => {
    const route = makeRoute({ criteria: { isThread: true } });
    expect(matchRoute(route, { ...baseMessage, isThread: true })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, isThread: false })).toBe(false);
  });

  it('matches on isMention boolean', () => {
    const route = makeRoute({ criteria: { isMention: true } });
    expect(matchRoute(route, { ...baseMessage, isMention: true })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, isMention: false })).toBe(false);
  });

  it('matches on isDM boolean', () => {
    const route = makeRoute({ criteria: { isDM: true } });
    expect(matchRoute(route, { ...baseMessage, isDM: true })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, isDM: false })).toBe(false);
  });

  it('requires ALL defined criteria to match (AND semantics)', () => {
    const route = makeRoute({
      criteria: {
        channel: 'slack-main',
        isMention: true,
      },
    });
    // Both match
    expect(matchRoute(route, { ...baseMessage, isMention: true })).toBe(true);
    // Channel matches but mention does not
    expect(matchRoute(route, { ...baseMessage, isMention: false })).toBe(false);
    // Mention matches but channel does not
    expect(
      matchRoute(route, { ...baseMessage, channel: 'discord-general', isMention: true }),
    ).toBe(false);
  });

  it('supports array criteria with OR semantics per field', () => {
    const route = makeRoute({
      criteria: { channel: ['slack-main', 'discord-general'] },
    });
    expect(matchRoute(route, { ...baseMessage, channel: 'slack-main' })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, channel: 'discord-general' })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, channel: 'telegram-chat' })).toBe(false);
  });

  it('combines array channel with boolean isDM correctly', () => {
    const route = makeRoute({
      criteria: {
        channel: ['slack-*', 'discord-*'],
        isDM: true,
      },
    });
    expect(matchRoute(route, { ...baseMessage, isDM: true })).toBe(true);
    expect(matchRoute(route, { ...baseMessage, isDM: false })).toBe(false);
    expect(
      matchRoute(route, { ...baseMessage, channel: 'telegram-chat', isDM: true }),
    ).toBe(false);
  });
});

// ─── router ──────────────────────────────────────────────────────────────────

describe('router', () => {
  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('returns an empty array when no routes are provided', () => {
    expect(router([], baseMessage)).toEqual([]);
  });

  it('returns an empty array when no routes match', () => {
    const routes = [
      makeRoute({ id: 'r1', criteria: { channel: 'discord-general' } }),
      makeRoute({ id: 'r2', criteria: { isDM: true } }),
    ];
    expect(router(routes, baseMessage)).toEqual([]);
  });

  it('excludes disabled routes even when criteria match', () => {
    const routes = [
      makeRoute({ id: 'r1', enabled: false, criteria: {} }),
      makeRoute({ id: 'r2', enabled: true, criteria: {} }),
    ];
    const result = router(routes, baseMessage);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('r2');
  });

  // ── Priority ordering ───────────────────────────────────────────────────────

  it('returns a single matching route', () => {
    const routes = [makeRoute({ id: 'r1', priority: 5, criteria: {} })];
    const result = router(routes, baseMessage);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('r1');
  });

  it('orders matching routes by descending priority', () => {
    const routes = [
      makeRoute({ id: 'low', priority: 1, criteria: {} }),
      makeRoute({ id: 'high', priority: 10, criteria: {} }),
      makeRoute({ id: 'mid', priority: 5, criteria: {} }),
    ];
    const result = router(routes, baseMessage);
    expect(result.map((r) => r.id)).toEqual(['high', 'mid', 'low']);
  });

  it('preserves relative input order for routes with equal priority (stable sort)', () => {
    const routes = [
      makeRoute({ id: 'first', priority: 5, criteria: {} }),
      makeRoute({ id: 'second', priority: 5, criteria: {} }),
      makeRoute({ id: 'third', priority: 5, criteria: {} }),
    ];
    const result = router(routes, baseMessage);
    expect(result.map((r) => r.id)).toEqual(['first', 'second', 'third']);
  });

  it('handles negative priorities correctly', () => {
    const routes = [
      makeRoute({ id: 'negative', priority: -1, criteria: {} }),
      makeRoute({ id: 'zero', priority: 0, criteria: {} }),
      makeRoute({ id: 'positive', priority: 1, criteria: {} }),
    ];
    const result = router(routes, baseMessage);
    expect(result.map((r) => r.id)).toEqual(['positive', 'zero', 'negative']);
  });

  // ── Fan-out / multiple recipients ───────────────────────────────────────────

  it('returns routes with multiple recipients intact', () => {
    const route = makeRoute({
      id: 'fan-out',
      criteria: {},
      recipients: [alice, bob],
    });
    const result = router([route], baseMessage);
    expect(result).toHaveLength(1);
    expect(result[0]?.recipients).toHaveLength(2);
    expect(result[0]?.recipients[0]?.id).toBe('r1');
    expect(result[0]?.recipients[1]?.id).toBe('r2');
  });

  // ── Overlapping routes ──────────────────────────────────────────────────────

  it('returns all overlapping (matching) routes sorted by priority', () => {
    const routes = [
      makeRoute({ id: 'catch-all', priority: 0, criteria: {} }),
      makeRoute({ id: 'specific', priority: 10, criteria: { channel: 'slack-*' } }),
    ];
    const result = router(routes, { ...baseMessage, channel: 'slack-main' });
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('specific');
    expect(result[1]?.id).toBe('catch-all');
  });

  // ── Glob patterns in practice ───────────────────────────────────────────────

  it('matches content with wildcard prefix pattern', () => {
    const deployRoute = makeRoute({
      id: 'deploy',
      priority: 10,
      criteria: { content: 'deploy *' },
    });
    const generalRoute = makeRoute({ id: 'general', priority: 0, criteria: {} });

    const deployMsg = { ...baseMessage, content: 'deploy feature-x to staging' };
    const otherMsg = { ...baseMessage, content: 'please review this PR' };

    const deployResult = router([deployRoute, generalRoute], deployMsg);
    expect(deployResult.map((r) => r.id)).toEqual(['deploy', 'general']);

    const otherResult = router([deployRoute, generalRoute], otherMsg);
    expect(otherResult.map((r) => r.id)).toEqual(['general']);
  });

  it('matches sender with ? single-char wildcard', () => {
    const route = makeRoute({ criteria: { sender: 'U?56' } });
    expect(router([route], { ...baseMessage, sender: 'U456' })).toHaveLength(1);
    expect(router([route], { ...baseMessage, sender: 'U4556' })).toHaveLength(0);
  });

  it('matches content against multiple patterns (OR)', () => {
    const route = makeRoute({
      criteria: { content: ['*error*', '*fail*', '*exception*'] },
    });
    expect(router([route], { ...baseMessage, content: 'build failed' })).toHaveLength(1);
    expect(router([route], { ...baseMessage, content: 'connection error' })).toHaveLength(1);
    expect(router([route], { ...baseMessage, content: 'uncaught exception' })).toHaveLength(1);
    expect(router([route], { ...baseMessage, content: 'deploy succeeded' })).toHaveLength(0);
  });

  // ── Real-world scenario ─────────────────────────────────────────────────────

  it('handles a realistic multi-route configuration correctly', () => {
    const routes: Route[] = [
      // Highest priority: DM mention → tier-1 support agent
      makeRoute({
        id: 'dm-mention',
        priority: 100,
        criteria: { isDM: true, isMention: true },
        recipients: [alice],
      }),
      // High priority: alert keywords in any Slack channel → ops bot
      makeRoute({
        id: 'alerts',
        priority: 50,
        criteria: { channel: 'slack-*', content: '*alert*' },
        recipients: [bob],
      }),
      // Medium priority: thread replies on slack-support
      makeRoute({
        id: 'support-threads',
        priority: 30,
        criteria: { channel: 'slack-support', isThread: true },
        recipients: [alice, bob],
      }),
      // Disabled route — should never match
      makeRoute({
        id: 'disabled',
        priority: 200,
        enabled: false,
        criteria: {},
        recipients: [alice],
      }),
      // Low priority catch-all
      makeRoute({
        id: 'catch-all',
        priority: 0,
        criteria: {},
        recipients: [alice],
      }),
    ];

    // Scenario 1: DM mention → only dm-mention + catch-all (alerts needs slack-*, not a DM channel here)
    const dmMention: InboundMessage = {
      channel: 'dm-channel',
      target: 'U999',
      sender: 'U456',
      content: 'Hey can you help me?',
      isThread: false,
      isMention: true,
      isDM: true,
    };
    const dmResult = router(routes, dmMention);
    expect(dmResult.map((r) => r.id)).toEqual(['dm-mention', 'catch-all']);

    // Scenario 2: Alert in slack channel → alerts + catch-all
    const slackAlert: InboundMessage = {
      channel: 'slack-ops',
      target: 'C999',
      sender: 'U123',
      content: 'CRITICAL alert: disk full',
      isThread: false,
      isMention: false,
      isDM: false,
    };
    const alertResult = router(routes, slackAlert);
    expect(alertResult.map((r) => r.id)).toEqual(['alerts', 'catch-all']);

    // Scenario 3: Thread reply in slack-support → support-threads + catch-all
    const supportThread: InboundMessage = {
      channel: 'slack-support',
      target: 'C777',
      sender: 'U456',
      content: 'Still having issues',
      isThread: true,
      isMention: false,
      isDM: false,
    };
    const supportResult = router(routes, supportThread);
    expect(supportResult.map((r) => r.id)).toEqual(['support-threads', 'catch-all']);

    // Scenario 4: Plain message with no specific match → only catch-all
    const plain: InboundMessage = {
      channel: 'telegram-chat',
      target: 'chat-123',
      sender: 'user-789',
      content: 'Good morning!',
      isThread: false,
      isMention: false,
      isDM: false,
    };
    const plainResult = router(routes, plain);
    expect(plainResult.map((r) => r.id)).toEqual(['catch-all']);
  });

  // ── Input immutability ──────────────────────────────────────────────────────

  it('does not mutate the input routes array', () => {
    const routes = [
      makeRoute({ id: 'r1', priority: 1, criteria: {} }),
      makeRoute({ id: 'r2', priority: 10, criteria: {} }),
    ];
    const originalOrder = routes.map((r) => r.id);
    router(routes, baseMessage);
    expect(routes.map((r) => r.id)).toEqual(originalOrder);
  });
});
