/**
 * Outbound message rendering: OpenThreads MessageItem[] → Slack Web API calls.
 *
 * Handles:
 *  - TextMessage → plain text / mrkdwn
 *  - A2H AUTHORIZE → Block Kit buttons (method 1)
 *  - A2H COLLECT with options → static_select (method 1)
 *  - A2H COLLECT free-text → question + thread listener (method 2)
 *  - A2H INFORM → text block
 */

import type { WebClient } from "@slack/web-api";
import type { MessageItem, A2HCollect } from "@openthreads/core";
import { isA2HItem, isAuthorize, isCollect, isInform } from "@openthreads/core";
import {
  renderAuthorize,
  renderCollectWithOptions,
  renderCollectFreeText,
  renderInform,
  type SlackMessagePayload,
} from "./a2h.js";

export interface SendOptions {
  channelId: string;
  /** Slack thread_ts to reply into — null posts a new top-level message */
  threadTs: string | null;
}

export interface PendingFreeTextCollect {
  requestId: string;
  channelId: string;
  threadTs: string;
  askedAt: Date;
}

export interface OutboundResult {
  /** Slack message timestamps for each posted message (may be used as thread_ts) */
  messageTs: string[];
  /**
   * Free-text COLLECT requests that were posted and are waiting for a thread reply.
   * The caller must register thread-reply listeners for each of these.
   */
  pendingFreeTextCollects: PendingFreeTextCollect[];
}

/**
 * Send an array of MessageItems to Slack, converting each one to the
 * appropriate Slack format.
 *
 * @param client  Initialised Slack WebClient
 * @param items   Array of Chat SDK messages and/or A2H intents
 * @param opts    Channel and optional thread to post into
 */
export async function sendMessages(
  client: WebClient,
  items: MessageItem[],
  opts: SendOptions
): Promise<OutboundResult> {
  const { channelId, threadTs } = opts;
  const result: OutboundResult = {
    messageTs: [],
    pendingFreeTextCollects: [],
  };

  for (const item of items) {
    if (isA2HItem(item)) {
      if (isAuthorize(item)) {
        const payload = renderAuthorize(item);
        const ts = await postSlackMessage(client, channelId, threadTs, payload);
        if (ts) result.messageTs.push(ts);
      } else if (isCollect(item)) {
        if (hasOptions(item)) {
          const payload = renderCollectWithOptions(
            item as A2HCollect & { options: string[] }
          );
          const ts = await postSlackMessage(client, channelId, threadTs, payload);
          if (ts) result.messageTs.push(ts);
        } else {
          // Free-text collect: post question and register pending listener
          const payload = renderCollectFreeText(item);
          const ts = await postSlackMessage(client, channelId, threadTs, payload);
          if (ts) {
            result.messageTs.push(ts);
            result.pendingFreeTextCollects.push({
              requestId: item.requestId,
              channelId,
              // The new message becomes the thread root if there was no thread
              threadTs: threadTs ?? ts,
              askedAt: new Date(),
            });
          }
        }
      } else if (isInform(item)) {
        const payload = renderInform(item);
        const ts = await postSlackMessage(client, channelId, threadTs, payload);
        if (ts) result.messageTs.push(ts);
      }
      // ESCALATE and RESULT are not rendered here — callers handle them
    } else {
      // Plain Chat SDK TextMessage
      const payload: SlackMessagePayload = {
        text: item.text ?? "",
      };
      const ts = await postSlackMessage(client, channelId, threadTs, payload);
      if (ts) result.messageTs.push(ts);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postSlackMessage(
  client: WebClient,
  channel: string,
  threadTs: string | null,
  payload: SlackMessagePayload
): Promise<string | null> {
  const response = await client.chat.postMessage({
    channel,
    text: payload.text,
    blocks: payload.blocks as Parameters<typeof client.chat.postMessage>[0]["blocks"],
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });

  return (response.ts as string | undefined) ?? null;
}

function hasOptions(item: A2HCollect): item is A2HCollect & { options: string[] } {
  return Array.isArray(item.options) && item.options.length > 0;
}
