/**
 * Unit tests for Slack capability reporting.
 */

import { describe, expect, test } from "bun:test";
import { SLACK_CAPABILITIES } from "../src/capabilities.js";

describe("SLACK_CAPABILITIES", () => {
  test("reports threads support", () => {
    expect(SLACK_CAPABILITIES.threads).toBe(true);
  });

  test("reports buttons support", () => {
    expect(SLACK_CAPABILITIES.buttons).toBe(true);
  });

  test("reports selectMenus support", () => {
    expect(SLACK_CAPABILITIES.selectMenus).toBe(true);
  });

  test("reports no replyMessages support", () => {
    expect(SLACK_CAPABILITIES.replyMessages).toBe(false);
  });

  test("reports DM support", () => {
    expect(SLACK_CAPABILITIES.dms).toBe(true);
  });

  test("reports fileUpload support", () => {
    expect(SLACK_CAPABILITIES.fileUpload).toBe(true);
  });

  test("matches the documented capability object", () => {
    expect(SLACK_CAPABILITIES).toEqual({
      threads: true,
      buttons: true,
      selectMenus: true,
      replyMessages: false,
      dms: true,
      fileUpload: true,
    });
  });
});
