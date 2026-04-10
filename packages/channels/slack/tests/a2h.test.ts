/**
 * Unit tests for A2H intent → Block Kit rendering and action_id parsing.
 */

import { describe, expect, test } from "bun:test";
import type { A2HAuthorize, A2HCollect, A2HInform } from "@openthreads/core";
import {
  renderAuthorize,
  renderCollectWithOptions,
  renderCollectFreeText,
  renderInform,
  parseActionId,
} from "../src/a2h.js";

// ---------------------------------------------------------------------------
// renderAuthorize
// ---------------------------------------------------------------------------

describe("renderAuthorize", () => {
  const intent: A2HAuthorize = {
    intent: "AUTHORIZE",
    requestId: "req-001",
    context: {
      action: "deploy-to-production",
      details: "Branch feature-x → production",
    },
  };

  test("returns a payload with text and blocks", () => {
    const payload = renderAuthorize(intent);
    expect(payload.text).toContain("deploy-to-production");
    expect(Array.isArray(payload.blocks)).toBe(true);
  });

  test("includes a section block with the action", () => {
    const payload = renderAuthorize(intent);
    const section = payload.blocks?.find((b) => b["type"] === "section") as
      | Record<string, unknown>
      | undefined;
    expect(section).toBeDefined();
    const text = section?.["text"] as { text: string } | undefined;
    expect(text?.text).toContain("deploy-to-production");
  });

  test("includes Approve and Deny buttons", () => {
    const payload = renderAuthorize(intent);
    const actionsBlock = payload.blocks?.find(
      (b) => b["type"] === "actions"
    ) as Record<string, unknown> | undefined;
    const elements = actionsBlock?.["elements"] as
      | Array<{ action_id: string; style: string }>
      | undefined;
    expect(elements).toHaveLength(2);

    const approve = elements?.find((e) =>
      e.action_id.includes("approved")
    );
    const deny = elements?.find((e) => e.action_id.includes("denied"));

    expect(approve?.style).toBe("primary");
    expect(deny?.style).toBe("danger");
  });

  test("encodes requestId in action_ids", () => {
    const payload = renderAuthorize(intent);
    const actionsBlock = payload.blocks?.find(
      (b) => b["type"] === "actions"
    ) as Record<string, unknown> | undefined;
    const elements = actionsBlock?.["elements"] as
      | Array<{ action_id: string }>
      | undefined;

    for (const el of elements ?? []) {
      expect(el.action_id).toContain("req-001");
    }
  });

  test("includes evidence fields when present", () => {
    const withEvidence: A2HAuthorize = {
      ...intent,
      context: {
        ...intent.context,
        evidence: { sha: "abc123", author: "alice" },
      },
    };
    const payload = renderAuthorize(withEvidence);
    const sectionWithFields = payload.blocks?.find(
      (b) => b["type"] === "section" && "fields" in b
    ) as Record<string, unknown> | undefined;
    expect(sectionWithFields).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// renderCollectWithOptions
// ---------------------------------------------------------------------------

describe("renderCollectWithOptions", () => {
  const intent: A2HCollect & { options: string[] } = {
    intent: "COLLECT",
    requestId: "req-002",
    question: "Which environment?",
    options: ["staging", "production", "dev"],
  };

  test("returns a payload with blocks", () => {
    const payload = renderCollectWithOptions(intent);
    expect(payload.text).toBe("Which environment?");
    expect(Array.isArray(payload.blocks)).toBe(true);
  });

  test("includes a static_select element", () => {
    const payload = renderCollectWithOptions(intent);
    const actionsBlock = payload.blocks?.find(
      (b) => b["type"] === "actions"
    ) as Record<string, unknown> | undefined;
    const elements = actionsBlock?.["elements"] as
      | Array<{ type: string; options: unknown[] }>
      | undefined;
    const select = elements?.find((e) => e.type === "static_select");
    expect(select).toBeDefined();
    expect(select?.options).toHaveLength(3);
  });

  test("encodes requestId in the action_id", () => {
    const payload = renderCollectWithOptions(intent);
    const actionsBlock = payload.blocks?.find(
      (b) => b["type"] === "actions"
    ) as Record<string, unknown> | undefined;
    const elements = actionsBlock?.["elements"] as
      | Array<{ action_id: string }>
      | undefined;
    const select = elements?.[0];
    expect(select?.action_id).toContain("req-002");
  });
});

// ---------------------------------------------------------------------------
// renderCollectFreeText
// ---------------------------------------------------------------------------

describe("renderCollectFreeText", () => {
  const intent: A2HCollect = {
    intent: "COLLECT",
    requestId: "req-003",
    question: "What is the ticket number?",
  };

  test("returns a payload with the question text", () => {
    const payload = renderCollectFreeText(intent);
    expect(payload.text).toBe("What is the ticket number?");
  });

  test("includes a reply hint in the block", () => {
    const payload = renderCollectFreeText(intent);
    const section = payload.blocks?.find((b) => b["type"] === "section") as
      | Record<string, unknown>
      | undefined;
    const text = section?.["text"] as { text: string } | undefined;
    expect(text?.text).toContain("Reply in this thread");
  });
});

// ---------------------------------------------------------------------------
// renderInform
// ---------------------------------------------------------------------------

describe("renderInform", () => {
  const intent: A2HInform = {
    intent: "INFORM",
    requestId: "req-004",
    message: "Deployment completed successfully.",
  };

  test("returns the message as text", () => {
    const payload = renderInform(intent);
    expect(payload.text).toBe("Deployment completed successfully.");
  });

  test("includes a section block with mrkdwn", () => {
    const payload = renderInform(intent);
    const section = payload.blocks?.find((b) => b["type"] === "section") as
      | Record<string, unknown>
      | undefined;
    const text = section?.["text"] as { type: string; text: string } | undefined;
    expect(text?.type).toBe("mrkdwn");
    expect(text?.text).toBe("Deployment completed successfully.");
  });
});

// ---------------------------------------------------------------------------
// parseActionId
// ---------------------------------------------------------------------------

describe("parseActionId", () => {
  test("parses an AUTHORIZE approved action_id", () => {
    const parsed = parseActionId(
      "ot_authorize__approved__req-001"
    );
    expect(parsed).toEqual({
      type: "authorize",
      approved: true,
      requestId: "req-001",
    });
  });

  test("parses an AUTHORIZE denied action_id", () => {
    const parsed = parseActionId("ot_authorize__denied__req-001");
    expect(parsed).toEqual({
      type: "authorize",
      approved: false,
      requestId: "req-001",
    });
  });

  test("parses a COLLECT action_id with selected value", () => {
    const parsed = parseActionId("ot_collect__req-002", "production");
    expect(parsed).toEqual({
      type: "collect",
      requestId: "req-002",
      value: "production",
    });
  });

  test("returns null for unknown action_id prefix", () => {
    const parsed = parseActionId("some_other_action__foo");
    expect(parsed).toBeNull();
  });

  test("handles requestId with double underscores", () => {
    const parsed = parseActionId(
      "ot_authorize__approved__org__project__req-001"
    );
    expect(parsed?.type).toBe("authorize");
    expect((parsed as { requestId: string }).requestId).toBe(
      "org__project__req-001"
    );
  });
});
