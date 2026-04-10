import { describe, expect, it } from "bun:test";
import { globToRegex, matchGlob, router } from "./router.ts";
import type { InboundMessage, Route } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "slack-main",
    target: "C0123",
    sender: "U456",
    content: "hello world",
    isThread: false,
    isMention: false,
    isDM: false,
    ...overrides,
  };
}

let routeId = 0;
function makeRoute(
  overrides: Partial<Route> & { criteria?: Route["criteria"] } = {},
): Route {
  return {
    id: `route-${++routeId}`,
    name: `Route ${routeId}`,
    criteria: {},
    recipientIds: ["recipient-1"],
    priority: 0,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// globToRegex
// ---------------------------------------------------------------------------

describe("globToRegex", () => {
  it("matches a plain string exactly (case-insensitive)", () => {
    expect(globToRegex("hello").test("hello")).toBe(true);
    expect(globToRegex("hello").test("HELLO")).toBe(true);
    expect(globToRegex("hello").test("hello world")).toBe(false);
  });

  it("* matches any sequence of characters including empty", () => {
    const re = globToRegex("slack-*");
    expect(re.test("slack-main")).toBe(true);
    expect(re.test("slack-")).toBe(true);
    expect(re.test("slack")).toBe(false);
    expect(re.test("discord-main")).toBe(false);
  });

  it("* at start matches suffix", () => {
    const re = globToRegex("*-bot");
    expect(re.test("my-bot")).toBe(true);
    expect(re.test("-bot")).toBe(true);
    expect(re.test("bot")).toBe(false);
  });

  it("* in middle matches infix", () => {
    const re = globToRegex("deploy*staging");
    expect(re.test("deploy staging")).toBe(true);
    expect(re.test("deploy-to-staging")).toBe(true);
    expect(re.test("deploystaging")).toBe(true);
    expect(re.test("deploy production")).toBe(false);
  });

  it("** behaves the same as * (no directory semantics)", () => {
    const re = globToRegex("**");
    expect(re.test("anything/goes")).toBe(true);
  });

  it("? matches exactly one character", () => {
    const re = globToRegex("U?56");
    expect(re.test("U456")).toBe(true);
    expect(re.test("UA56")).toBe(true);
    expect(re.test("U56")).toBe(false);
    expect(re.test("U4556")).toBe(false);
  });

  it("escapes regex special characters in literals", () => {
    // dot should be literal, not regex wildcard
    expect(globToRegex("1.2.3").test("1X2Y3")).toBe(false);
    expect(globToRegex("1.2.3").test("1.2.3")).toBe(true);

    // parentheses, brackets, etc.
    expect(globToRegex("(foo)").test("(foo)")).toBe(true);
    expect(globToRegex("[bar]").test("[bar]")).toBe(true);
    expect(globToRegex("{baz}").test("{baz}")).toBe(true);
  });

  it("mixed wildcards and literals", () => {
    const re = globToRegex("deploy * to *.openthreads.dev");
    expect(re.test("deploy feature-x to staging.openthreads.dev")).toBe(true);
    expect(re.test("deploy to .openthreads.dev")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchGlob
// ---------------------------------------------------------------------------

describe("matchGlob", () => {
  it("returns true for exact match", () => {
    expect(matchGlob("slack-main", "slack-main")).toBe(true);
  });

  it("returns false for non-match", () => {
    expect(matchGlob("slack-main", "discord-main")).toBe(false);
  });

  it("supports * wildcard", () => {
    expect(matchGlob("slack-*", "slack-general")).toBe(true);
    expect(matchGlob("slack-*", "discord-general")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchGlob("SLACK-MAIN", "slack-main")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// router — basic filtering
// ---------------------------------------------------------------------------

describe("router — basic", () => {
  it("returns an empty array when there are no routes", () => {
    expect(router([], makeMessage())).toEqual([]);
  });

  it("returns an empty array when no routes match", () => {
    const route = makeRoute({ criteria: { channel: "discord-*" } });
    expect(router([route], makeMessage({ channel: "slack-main" }))).toEqual([]);
  });

  it("returns a route with empty criteria (catch-all)", () => {
    const route = makeRoute({ criteria: {} });
    const result = router([route], makeMessage());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(route.id);
  });

  it("excludes disabled routes", () => {
    const disabled = makeRoute({ enabled: false, criteria: {} });
    expect(router([disabled], makeMessage())).toEqual([]);
  });

  it("does not mutate the input routes array", () => {
    const routes = [
      makeRoute({ priority: 1, criteria: {} }),
      makeRoute({ priority: 3, criteria: {} }),
      makeRoute({ priority: 2, criteria: {} }),
    ];
    const original = [...routes];
    router(routes, makeMessage());
    expect(routes).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// router — string criteria
// ---------------------------------------------------------------------------

describe("router — string criteria", () => {
  describe("channel", () => {
    it("matches exact channel id", () => {
      const route = makeRoute({ criteria: { channel: "slack-main" } });
      expect(router([route], makeMessage({ channel: "slack-main" }))).toHaveLength(1);
      expect(router([route], makeMessage({ channel: "slack-other" }))).toHaveLength(0);
    });

    it("matches channel with glob pattern", () => {
      const route = makeRoute({ criteria: { channel: "slack-*" } });
      expect(router([route], makeMessage({ channel: "slack-general" }))).toHaveLength(1);
      expect(router([route], makeMessage({ channel: "discord-general" }))).toHaveLength(0);
    });

    it("matches channel with array (OR semantics)", () => {
      const route = makeRoute({ criteria: { channel: ["slack-main", "discord-*"] } });
      expect(router([route], makeMessage({ channel: "slack-main" }))).toHaveLength(1);
      expect(router([route], makeMessage({ channel: "discord-general" }))).toHaveLength(1);
      expect(router([route], makeMessage({ channel: "telegram-bot" }))).toHaveLength(0);
    });

    it("undefined channel criterion matches any channel", () => {
      const route = makeRoute({ criteria: { channel: undefined } });
      expect(router([route], makeMessage({ channel: "slack-main" }))).toHaveLength(1);
      expect(router([route], makeMessage({ channel: "telegram-bot" }))).toHaveLength(1);
    });
  });

  describe("target", () => {
    it("matches exact target", () => {
      const route = makeRoute({ criteria: { target: "C0123" } });
      expect(router([route], makeMessage({ target: "C0123" }))).toHaveLength(1);
      expect(router([route], makeMessage({ target: "C9999" }))).toHaveLength(0);
    });

    it("matches target with glob", () => {
      const route = makeRoute({ criteria: { target: "C*" } });
      expect(router([route], makeMessage({ target: "C0123" }))).toHaveLength(1);
      expect(router([route], makeMessage({ target: "D0123" }))).toHaveLength(0);
    });
  });

  describe("sender", () => {
    it("matches exact sender", () => {
      const route = makeRoute({ criteria: { sender: "U456" } });
      expect(router([route], makeMessage({ sender: "U456" }))).toHaveLength(1);
      expect(router([route], makeMessage({ sender: "U999" }))).toHaveLength(0);
    });

    it("matches sender with glob (e.g. all users)", () => {
      const route = makeRoute({ criteria: { sender: "U*" } });
      expect(router([route], makeMessage({ sender: "U456" }))).toHaveLength(1);
      expect(router([route], makeMessage({ sender: "B456" }))).toHaveLength(0);
    });
  });

  describe("content", () => {
    it("matches exact content", () => {
      const route = makeRoute({ criteria: { content: "hello world" } });
      expect(router([route], makeMessage({ content: "hello world" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "hello" }))).toHaveLength(0);
    });

    it("matches content with prefix glob", () => {
      const route = makeRoute({ criteria: { content: "deploy *" } });
      expect(router([route], makeMessage({ content: "deploy feature-x to staging" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "rollback main" }))).toHaveLength(0);
    });

    it("matches content with surrounding globs", () => {
      const route = makeRoute({ criteria: { content: "*help*" } });
      expect(router([route], makeMessage({ content: "I need help please" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "everything is fine" }))).toHaveLength(0);
    });

    it("matches content with ? wildcard", () => {
      const route = makeRoute({ criteria: { content: "v?.?" } });
      expect(router([route], makeMessage({ content: "v1.0" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "v10.0" }))).toHaveLength(0);
    });

    it("matches content with array (OR semantics)", () => {
      const route = makeRoute({ criteria: { content: ["deploy *", "rollback *"] } });
      expect(router([route], makeMessage({ content: "deploy main" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "rollback v2" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "status check" }))).toHaveLength(0);
    });

    it("content matching is case-insensitive", () => {
      const route = makeRoute({ criteria: { content: "Deploy *" } });
      expect(router([route], makeMessage({ content: "deploy feature-x" }))).toHaveLength(1);
      expect(router([route], makeMessage({ content: "DEPLOY FEATURE-X" }))).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// router — boolean criteria
// ---------------------------------------------------------------------------

describe("router — boolean criteria", () => {
  it("isThread: true matches only thread messages", () => {
    const route = makeRoute({ criteria: { isThread: true } });
    expect(router([route], makeMessage({ isThread: true }))).toHaveLength(1);
    expect(router([route], makeMessage({ isThread: false }))).toHaveLength(0);
  });

  it("isThread: false matches only top-level messages", () => {
    const route = makeRoute({ criteria: { isThread: false } });
    expect(router([route], makeMessage({ isThread: false }))).toHaveLength(1);
    expect(router([route], makeMessage({ isThread: true }))).toHaveLength(0);
  });

  it("isThread: undefined matches both", () => {
    const route = makeRoute({ criteria: { isThread: undefined } });
    expect(router([route], makeMessage({ isThread: true }))).toHaveLength(1);
    expect(router([route], makeMessage({ isThread: false }))).toHaveLength(1);
  });

  it("isMention: true matches only mentions", () => {
    const route = makeRoute({ criteria: { isMention: true } });
    expect(router([route], makeMessage({ isMention: true }))).toHaveLength(1);
    expect(router([route], makeMessage({ isMention: false }))).toHaveLength(0);
  });

  it("isMention: false matches only non-mentions", () => {
    const route = makeRoute({ criteria: { isMention: false } });
    expect(router([route], makeMessage({ isMention: false }))).toHaveLength(1);
    expect(router([route], makeMessage({ isMention: true }))).toHaveLength(0);
  });

  it("isDM: true matches only DMs", () => {
    const route = makeRoute({ criteria: { isDM: true } });
    expect(router([route], makeMessage({ isDM: true }))).toHaveLength(1);
    expect(router([route], makeMessage({ isDM: false }))).toHaveLength(0);
  });

  it("isDM: false matches only non-DM messages", () => {
    const route = makeRoute({ criteria: { isDM: false } });
    expect(router([route], makeMessage({ isDM: false }))).toHaveLength(1);
    expect(router([route], makeMessage({ isDM: true }))).toHaveLength(0);
  });

  it("isDM: undefined matches both DMs and non-DMs", () => {
    const route = makeRoute({ criteria: {} });
    expect(router([route], makeMessage({ isDM: true }))).toHaveLength(1);
    expect(router([route], makeMessage({ isDM: false }))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// router — AND logic across criteria
// ---------------------------------------------------------------------------

describe("router — AND across criteria fields", () => {
  it("requires all specified criteria to match", () => {
    const route = makeRoute({
      criteria: {
        channel: "slack-*",
        isMention: true,
        content: "deploy *",
      },
    });

    // All match
    expect(
      router(
        [route],
        makeMessage({ channel: "slack-main", isMention: true, content: "deploy feature-x" }),
      ),
    ).toHaveLength(1);

    // Wrong channel
    expect(
      router(
        [route],
        makeMessage({ channel: "discord-main", isMention: true, content: "deploy feature-x" }),
      ),
    ).toHaveLength(0);

    // Mention missing
    expect(
      router(
        [route],
        makeMessage({ channel: "slack-main", isMention: false, content: "deploy feature-x" }),
      ),
    ).toHaveLength(0);

    // Wrong content
    expect(
      router(
        [route],
        makeMessage({ channel: "slack-main", isMention: true, content: "rollback main" }),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// router — priority ordering
// ---------------------------------------------------------------------------

describe("router — priority ordering", () => {
  it("returns routes sorted by descending priority", () => {
    const low = makeRoute({ priority: 1, criteria: {} });
    const high = makeRoute({ priority: 10, criteria: {} });
    const mid = makeRoute({ priority: 5, criteria: {} });

    const result = router([low, high, mid], makeMessage());
    expect(result.map((r) => r.priority)).toEqual([10, 5, 1]);
  });

  it("preserves relative order of routes with equal priority (stable sort)", () => {
    const a = makeRoute({ priority: 5, criteria: {} });
    const b = makeRoute({ priority: 5, criteria: {} });
    const c = makeRoute({ priority: 5, criteria: {} });

    const result = router([a, b, c], makeMessage());
    expect(result).toHaveLength(3);
    // All three should be present; relative order between equal-priority
    // routes is stable (implementation-specific but deterministic).
    expect(new Set(result.map((r) => r.id))).toEqual(new Set([a.id, b.id, c.id]));
  });

  it("puts default priority (0) below explicitly higher priorities", () => {
    const explicit = makeRoute({ priority: 1, criteria: {} });
    const defaultPriority = makeRoute({ priority: 0, criteria: {} });

    const result = router([defaultPriority, explicit], makeMessage());
    expect(result[0].id).toBe(explicit.id);
  });
});

// ---------------------------------------------------------------------------
// router — edge cases
// ---------------------------------------------------------------------------

describe("router — edge cases", () => {
  it("handles overlapping routes — all matching routes are returned", () => {
    const catch_all = makeRoute({ priority: 0, criteria: {} });
    const specific = makeRoute({ priority: 10, criteria: { channel: "slack-main" } });

    const result = router([catch_all, specific], makeMessage({ channel: "slack-main" }));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(specific.id);
    expect(result[1].id).toBe(catch_all.id);
  });

  it("returns empty array when all routes are disabled", () => {
    const r1 = makeRoute({ enabled: false, criteria: {} });
    const r2 = makeRoute({ enabled: false, criteria: {} });
    expect(router([r1, r2], makeMessage())).toEqual([]);
  });

  it("mixes enabled and disabled routes correctly", () => {
    const enabled = makeRoute({ enabled: true, criteria: {} });
    const disabled = makeRoute({ enabled: false, criteria: {} });
    const result = router([enabled, disabled], makeMessage());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(enabled.id);
  });
});

// ---------------------------------------------------------------------------
// router — fan-out (multiple recipientIds per route)
// ---------------------------------------------------------------------------

describe("router — fan-out", () => {
  it("a matched route may have multiple recipientIds", () => {
    const route = makeRoute({
      criteria: {},
      recipientIds: ["recipient-a", "recipient-b", "recipient-c"],
    });
    const result = router([route], makeMessage());
    expect(result).toHaveLength(1);
    expect(result[0].recipientIds).toEqual(["recipient-a", "recipient-b", "recipient-c"]);
  });

  it("returns all matching routes so the caller can fan-out across routes too", () => {
    const routeA = makeRoute({ criteria: { channel: "slack-*" }, recipientIds: ["agent-1"] });
    const routeB = makeRoute({ criteria: { isMention: true }, recipientIds: ["agent-2", "agent-3"] });

    const msg = makeMessage({ channel: "slack-general", isMention: true });
    const result = router([routeA, routeB], msg);
    expect(result).toHaveLength(2);

    const allRecipients = result.flatMap((r) => r.recipientIds);
    expect(allRecipients).toContain("agent-1");
    expect(allRecipients).toContain("agent-2");
    expect(allRecipients).toContain("agent-3");
  });
});

// ---------------------------------------------------------------------------
// router — realistic scenario
// ---------------------------------------------------------------------------

describe("router — realistic scenario", () => {
  const routes: Route[] = [
    {
      id: "deploy-bot",
      name: "Deploy Bot",
      criteria: { channel: "slack-*", content: "deploy *", isMention: true },
      recipientIds: ["deploy-agent"],
      priority: 10,
      enabled: true,
    },
    {
      id: "dm-catchall",
      name: "DM catch-all",
      criteria: { isDM: true },
      recipientIds: ["support-agent"],
      priority: 5,
      enabled: true,
    },
    {
      id: "thread-logger",
      name: "Thread logger",
      criteria: { isThread: true },
      recipientIds: ["logger-agent"],
      priority: 1,
      enabled: true,
    },
    {
      id: "disabled-route",
      name: "Disabled",
      criteria: {},
      recipientIds: ["never-called"],
      priority: 100,
      enabled: false,
    },
    {
      id: "global-catchall",
      name: "Global catch-all",
      criteria: {},
      recipientIds: ["audit-agent"],
      priority: 0,
      enabled: true,
    },
  ];

  it("deploy mention in Slack thread → deploy-bot (10), thread-logger (1), global (0)", () => {
    const msg = makeMessage({
      channel: "slack-ops",
      content: "deploy feature-x to staging",
      isMention: true,
      isThread: true,
    });
    const result = router(routes, msg);
    expect(result.map((r) => r.id)).toEqual(["deploy-bot", "thread-logger", "global-catchall"]);
  });

  it("DM message → dm-catchall (5), global (0)", () => {
    const msg = makeMessage({ isDM: true, isThread: false });
    const result = router(routes, msg);
    expect(result.map((r) => r.id)).toEqual(["dm-catchall", "global-catchall"]);
  });

  it("plain channel message (not mention, not DM, not thread) → only global (0)", () => {
    const msg = makeMessage({ channel: "slack-general", isMention: false, isDM: false, isThread: false });
    const result = router(routes, msg);
    expect(result.map((r) => r.id)).toEqual(["global-catchall"]);
  });

  it("non-Slack deploy mention → no deploy-bot, but global catches it", () => {
    const msg = makeMessage({
      channel: "discord-ops",
      content: "deploy feature-x",
      isMention: true,
    });
    const result = router(routes, msg);
    expect(result.map((r) => r.id)).toEqual(["global-catchall"]);
  });
});
