/**
 * Block Kit builders for A2H intents.
 *
 * All block_id values encode the intent ID so the interaction handler can
 * look up the pending resolver without relying on fragile action_id parsing.
 */

import type { Block } from '@slack/bolt';
import type { A2HAuthorizeIntent, A2HCollectIntent } from '@openthreads/core';

// ---------------------------------------------------------------------------
// AUTHORIZE blocks
// ---------------------------------------------------------------------------

/**
 * Renders an AUTHORIZE intent as a Block Kit message with Approve / Deny buttons.
 *
 * block_id on the actions block: `auth_actions_<intentId>`
 * action_id on buttons: `a2h_approve` / `a2h_deny`
 */
export function buildAuthorizeBlocks(intent: A2HAuthorizeIntent): Block[] {
  const detailsLine = intent.context.details
    ? `\n*Details:* ${intent.context.details}`
    : '';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🔐 Authorization Required',
        emoji: true,
      },
    },
    {
      type: 'section',
      block_id: `auth_info_${intent.id}`,
      text: {
        type: 'mrkdwn',
        text: `*Action:* ${intent.context.action}${detailsLine}`,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'actions',
      block_id: `auth_actions_${intent.id}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: 'a2h_approve',
          value: 'approve',
          confirm: {
            title: { type: 'plain_text', text: 'Confirm Approval' },
            text: {
              type: 'mrkdwn',
              text: `Are you sure you want to approve *${intent.context.action}*?`,
            },
            confirm: { type: 'plain_text', text: 'Yes, approve' },
            deny: { type: 'plain_text', text: 'Cancel' },
            style: 'primary',
          },
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Deny', emoji: true },
          style: 'danger',
          action_id: 'a2h_deny',
          value: 'deny',
        },
      ],
    },
  ] as Block[];
}

/**
 * Replacement block shown after an AUTHORIZE is resolved (approved).
 */
export function buildApprovedBlock(action: string): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Approved:* ${action}`,
      },
    },
  ] as Block[];
}

/**
 * Replacement block shown after an AUTHORIZE is resolved (denied).
 */
export function buildDeniedBlock(action: string): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *Denied:* ${action}`,
      },
    },
  ] as Block[];
}

// ---------------------------------------------------------------------------
// COLLECT (select menu) blocks
// ---------------------------------------------------------------------------

/**
 * Renders a COLLECT intent with `options` as a static-select menu.
 *
 * block_id on the section: `collect_section_<intentId>`
 * action_id on the select: `a2h_collect_select`
 */
export function buildCollectSelectBlocks(intent: A2HCollectIntent): Block[] {
  if (!intent.options || intent.options.length === 0) {
    throw new Error('buildCollectSelectBlocks requires at least one option');
  }

  return [
    {
      type: 'section',
      block_id: `collect_section_${intent.id}`,
      text: {
        type: 'mrkdwn',
        text: `📋 *${intent.question}*`,
      },
      accessory: {
        type: 'static_select',
        placeholder: {
          type: 'plain_text',
          text: 'Select an option',
          emoji: true,
        },
        action_id: 'a2h_collect_select',
        options: intent.options.map((opt) => ({
          text: { type: 'plain_text', text: opt.label, emoji: true },
          value: opt.value,
        })),
      },
    },
  ] as Block[];
}

/**
 * Replacement block shown after a COLLECT select is resolved.
 */
export function buildCollectResponseBlock(question: string, answer: string): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📋 *${question}*\n✅ *Selected:* ${answer}`,
      },
    },
  ] as Block[];
}
