/**
 * Unit tests for Block Kit builders.
 *
 * These are pure function tests — no Slack API calls, no mocking needed.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildAuthorizeBlocks,
  buildApprovedBlock,
  buildDeniedBlock,
  buildCollectSelectBlocks,
  buildCollectResponseBlock,
} from '../utils/blocks.js';
import type { A2HAuthorizeIntent, A2HCollectIntent } from '@openthreads/core';

// ---------------------------------------------------------------------------
// buildAuthorizeBlocks
// ---------------------------------------------------------------------------

describe('buildAuthorizeBlocks()', () => {
  const base: A2HAuthorizeIntent = {
    intent: 'AUTHORIZE',
    id: 'test-intent-001',
    context: { action: 'deploy-to-production' },
  };

  test('returns an array of blocks', () => {
    const blocks = buildAuthorizeBlocks(base);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  test('includes a header block', () => {
    const blocks = buildAuthorizeBlocks(base);
    const header = blocks.find((b) => b.type === 'header');
    expect(header).toBeDefined();
  });

  test('includes an actions block with Approve and Deny buttons', () => {
    const blocks = buildAuthorizeBlocks(base);
    const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
    expect(actions).toBeDefined();

    const elements = actions['elements'] as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(2);

    const approveBtn = elements.find((e) => e['action_id'] === 'a2h_approve');
    const denyBtn = elements.find((e) => e['action_id'] === 'a2h_deny');
    expect(approveBtn).toBeDefined();
    expect(denyBtn).toBeDefined();
  });

  test('actions block_id encodes the intent ID', () => {
    const blocks = buildAuthorizeBlocks(base);
    const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
    expect(actions?.['block_id']).toBe(`auth_actions_${base.id}`);
  });

  test('includes action details when provided', () => {
    const withDetails: A2HAuthorizeIntent = {
      ...base,
      context: { action: 'deploy', details: 'Branch feature-x → production' },
    };
    const blocks = buildAuthorizeBlocks(withDetails);
    const section = blocks.find((b) => b.type === 'section') as Record<string, unknown>;
    const text = section?.['text'] as Record<string, unknown>;
    expect(String(text?.['text'])).toContain('Branch feature-x → production');
  });

  test('omits details line when details not provided', () => {
    const blocks = buildAuthorizeBlocks(base);
    const section = blocks.find((b) => b.type === 'section') as Record<string, unknown>;
    const text = section?.['text'] as Record<string, unknown>;
    expect(String(text?.['text'])).not.toContain('Details:');
  });

  test('Approve button has primary style', () => {
    const blocks = buildAuthorizeBlocks(base);
    const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
    const elements = actions?.['elements'] as Array<Record<string, unknown>>;
    const approve = elements?.find((e) => e['action_id'] === 'a2h_approve');
    expect(approve?.['style']).toBe('primary');
  });

  test('Deny button has danger style', () => {
    const blocks = buildAuthorizeBlocks(base);
    const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
    const elements = actions?.['elements'] as Array<Record<string, unknown>>;
    const deny = elements?.find((e) => e['action_id'] === 'a2h_deny');
    expect(deny?.['style']).toBe('danger');
  });
});

// ---------------------------------------------------------------------------
// buildApprovedBlock / buildDeniedBlock
// ---------------------------------------------------------------------------

describe('buildApprovedBlock()', () => {
  test('contains ✅ and the action name', () => {
    const blocks = buildApprovedBlock('deploy-to-production');
    const text = JSON.stringify(blocks);
    expect(text).toContain('✅');
    expect(text).toContain('deploy-to-production');
  });
});

describe('buildDeniedBlock()', () => {
  test('contains ❌ and the action name', () => {
    const blocks = buildDeniedBlock('deploy-to-production');
    const text = JSON.stringify(blocks);
    expect(text).toContain('❌');
    expect(text).toContain('deploy-to-production');
  });
});

// ---------------------------------------------------------------------------
// buildCollectSelectBlocks
// ---------------------------------------------------------------------------

describe('buildCollectSelectBlocks()', () => {
  const intent: A2HCollectIntent = {
    intent: 'COLLECT',
    id: 'collect-001',
    question: 'Which environment?',
    options: [
      { label: 'Staging', value: 'staging' },
      { label: 'Production', value: 'production' },
    ],
  };

  test('returns a section block with static_select accessory', () => {
    const blocks = buildCollectSelectBlocks(intent);
    expect(blocks).toHaveLength(1);
    const section = blocks[0] as Record<string, unknown>;
    expect(section?.['type']).toBe('section');
    const accessory = section?.['accessory'] as Record<string, unknown>;
    expect(accessory?.['type']).toBe('static_select');
  });

  test('section block_id encodes the intent ID', () => {
    const blocks = buildCollectSelectBlocks(intent);
    const section = blocks[0] as Record<string, unknown>;
    expect(section?.['block_id']).toBe(`collect_section_${intent.id}`);
  });

  test('select action_id is a2h_collect_select', () => {
    const blocks = buildCollectSelectBlocks(intent);
    const section = blocks[0] as Record<string, unknown>;
    const accessory = section?.['accessory'] as Record<string, unknown>;
    expect(accessory?.['action_id']).toBe('a2h_collect_select');
  });

  test('maps options correctly', () => {
    const blocks = buildCollectSelectBlocks(intent);
    const section = blocks[0] as Record<string, unknown>;
    const accessory = section?.['accessory'] as Record<string, unknown>;
    const options = accessory?.['options'] as Array<Record<string, unknown>>;
    expect(options).toHaveLength(2);
    expect(options[0]?.['value']).toBe('staging');
    expect(options[1]?.['value']).toBe('production');
  });

  test('throws when options array is empty', () => {
    const empty: A2HCollectIntent = { ...intent, options: [] };
    expect(() => buildCollectSelectBlocks(empty)).toThrow();
  });

  test('throws when options is undefined', () => {
    const noOpts: A2HCollectIntent = { ...intent, options: undefined };
    expect(() => buildCollectSelectBlocks(noOpts)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildCollectResponseBlock
// ---------------------------------------------------------------------------

describe('buildCollectResponseBlock()', () => {
  test('includes the question and selected answer', () => {
    const blocks = buildCollectResponseBlock('Which env?', 'staging');
    const text = JSON.stringify(blocks);
    expect(text).toContain('Which env?');
    expect(text).toContain('staging');
    expect(text).toContain('✅');
  });
});
