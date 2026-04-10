import type { ChannelCapabilities } from "@openthreads/core";

/**
 * Slack channel capabilities.
 *
 * Slack is the richest channel — it supports native threads, Block Kit buttons,
 * select menus, DMs, and file uploads.
 */
export const SLACK_CAPABILITIES: ChannelCapabilities = {
  threads: true,
  buttons: true,
  selectMenus: true,
  replyMessages: false,
  dms: true,
  fileUpload: true,
};
