import { describe, it, expect } from "bun:test";
import {
  buildTextBlocks,
  buildAuthorizeBlocks,
  buildSelectBlocks,
} from "../utils/blocks.js";

describe("buildTextBlocks()", () => {
  it("returns a single section block", () => {
    const blocks = buildTextBlocks("Hello, world!");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
  });

  it("uses mrkdwn text type", () => {
    const blocks = buildTextBlocks("*bold*");
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.type).toBe("mrkdwn");
    expect(section.text.text).toBe("*bold*");
  });

  it("preserves text verbatim", () => {
    const text = "Deploy started. ETA 3 minutes.";
    const blocks = buildTextBlocks(text);
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.text).toBe(text);
  });
});

describe("buildAuthorizeBlocks()", () => {
  const context = {
    action: "deploy-to-production",
    details: "Branch feature-x → production",
  };
  const requestId = "req_001";

  it("returns a section and an actions block", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("actions");
  });

  it("includes the action name in the section text", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.text).toContain("deploy-to-production");
  });

  it("includes the details in the section text", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.text).toContain("Branch feature-x");
  });

  it("renders Approve button with primary style", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const actionsBlock = blocks[1] as {
      type: string;
      elements: Array<{ type: string; style?: string; action_id: string }>;
    };
    const approve = actionsBlock.elements.find((e) =>
      e.action_id.includes("approve")
    );
    expect(approve).toBeDefined();
    expect(approve!.style).toBe("primary");
  });

  it("renders Deny button with danger style", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const actionsBlock = blocks[1] as {
      type: string;
      elements: Array<{ type: string; style?: string; action_id: string }>;
    };
    const deny = actionsBlock.elements.find((e) =>
      e.action_id.includes("deny")
    );
    expect(deny).toBeDefined();
    expect(deny!.style).toBe("danger");
  });

  it("embeds requestId in approve action_id", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const actionsBlock = blocks[1] as {
      type: string;
      elements: Array<{ action_id: string }>;
    };
    const approve = actionsBlock.elements.find((e) =>
      e.action_id.includes("approve")
    );
    expect(approve!.action_id).toBe(`a2h_authorize_approve_${requestId}`);
  });

  it("embeds requestId in deny action_id", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const actionsBlock = blocks[1] as {
      type: string;
      elements: Array<{ action_id: string }>;
    };
    const deny = actionsBlock.elements.find((e) =>
      e.action_id.includes("deny")
    );
    expect(deny!.action_id).toBe(`a2h_authorize_deny_${requestId}`);
  });

  it("approve button includes a confirm dialog", () => {
    const blocks = buildAuthorizeBlocks(context, requestId);
    const actionsBlock = blocks[1] as {
      type: string;
      elements: Array<{ action_id: string; confirm?: unknown }>;
    };
    const approve = actionsBlock.elements.find((e) =>
      e.action_id.includes("approve")
    );
    expect(approve!.confirm).toBeDefined();
  });

  it("handles missing action gracefully", () => {
    const blocks = buildAuthorizeBlocks({}, requestId);
    expect(blocks).toHaveLength(2);
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.text).toContain("Unknown action");
  });
});

describe("buildSelectBlocks()", () => {
  const context = {
    question: "Which environment should be deployed?",
    options: [
      { label: "Staging", value: "staging" },
      { label: "Production", value: "production" },
      { label: "Preview", value: "preview" },
    ],
  };
  const requestId = "req_002";

  it("returns a single section block", () => {
    const blocks = buildSelectBlocks(context, requestId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
  });

  it("includes the question in section text", () => {
    const blocks = buildSelectBlocks(context, requestId);
    const section = blocks[0] as { type: string; text: { type: string; text: string } };
    expect(section.text.text).toBe(context.question);
  });

  it("attaches a static_select accessory", () => {
    const blocks = buildSelectBlocks(context, requestId);
    const section = blocks[0] as {
      type: string;
      text: { type: string; text: string };
      accessory?: { type: string; action_id: string; options: unknown[] };
    };
    expect(section.accessory?.type).toBe("static_select");
  });

  it("maps options to Slack option format", () => {
    const blocks = buildSelectBlocks(context, requestId);
    const section = blocks[0] as {
      type: string;
      accessory?: {
        type: string;
        options: Array<{
          text: { type: string; text: string };
          value: string;
        }>;
      };
    };
    const opts = section.accessory!.options;
    expect(opts).toHaveLength(3);
    expect(opts[0].value).toBe("staging");
    expect(opts[0].text.text).toBe("Staging");
    expect(opts[1].value).toBe("production");
    expect(opts[2].value).toBe("preview");
  });

  it("embeds requestId in action_id", () => {
    const blocks = buildSelectBlocks(context, requestId);
    const section = blocks[0] as {
      type: string;
      accessory?: { type: string; action_id: string };
    };
    expect(section.accessory!.action_id).toBe(
      `a2h_collect_select_${requestId}`
    );
  });

  it("handles empty options array", () => {
    const blocks = buildSelectBlocks({ question: "Pick one:", options: [] }, requestId);
    const section = blocks[0] as {
      type: string;
      accessory?: { options: unknown[] };
    };
    expect(section.accessory?.options).toHaveLength(0);
  });

  it("falls back to default question text when missing", () => {
    const blocks = buildSelectBlocks({ options: [] }, requestId);
    const section = blocks[0] as { type: string; text: { text: string } };
    expect(section.text.text).toBe("Please select an option:");
  });
});
