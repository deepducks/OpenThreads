/**
 * Unit tests — A2H method selector
 */

import { describe, expect, it } from 'bun:test';
import { selectA2HMethod, deriveCaptureMode } from '../selector.js';
import type {
  A2HMessage,
  ChannelCapabilities,
  ReplyContext,
} from '../../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fullCaps: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: true,
  hasNativeThreads: true,
  hasReplyMessages: true,
};

const minimalCaps: ChannelCapabilities = {
  supportsButtons: false,
  supportsSelectMenus: false,
  hasNativeThreads: false,
  hasReplyMessages: false,
};

function makeContext(
  overrides: Partial<ReplyContext> = {},
): ReplyContext {
  return {
    channelId: 'C001',
    isDM: false,
    capabilities: fullCaps,
    trustLayerActive: false,
    turnId: 'ot_turn_test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Trust layer
// ---------------------------------------------------------------------------

describe('selectA2HMethod — trust layer', () => {
  it('always returns method 3 when the trust layer is active', () => {
    const ctx = makeContext({ trustLayerActive: true });

    const cases: A2HMessage[] = [
      { intent: 'AUTHORIZE' },
      { intent: 'COLLECT' },
      { intent: 'COLLECT', schema: { fields: [{ name: 'f', label: 'F', type: 'text' }] } },
    ];

    for (const msg of cases) {
      expect(selectA2HMethod(msg, ctx)).toEqual({ method: 3 });
    }
  });
});

// ---------------------------------------------------------------------------
// INFORM / ESCALATE / RESULT
// ---------------------------------------------------------------------------

describe('selectA2HMethod — fire-and-forget intents', () => {
  it('returns inform-fire-forget for INFORM', () => {
    const ctx = makeContext();
    expect(selectA2HMethod({ intent: 'INFORM' }, ctx)).toEqual({
      method: 'inform-fire-forget',
    });
  });

  it('returns escalate for ESCALATE', () => {
    const ctx = makeContext();
    expect(selectA2HMethod({ intent: 'ESCALATE' }, ctx)).toEqual({
      method: 'escalate',
    });
  });

  it('returns inform-fire-forget for RESULT', () => {
    const ctx = makeContext();
    expect(selectA2HMethod({ intent: 'RESULT' }, ctx)).toEqual({
      method: 'inform-fire-forget',
    });
  });
});

// ---------------------------------------------------------------------------
// AUTHORIZE
// ---------------------------------------------------------------------------

describe('selectA2HMethod — AUTHORIZE', () => {
  it('returns method 1 for simple AUTHORIZE when channel supports buttons', () => {
    const ctx = makeContext({ capabilities: { ...fullCaps, supportsButtons: true } });
    expect(selectA2HMethod({ intent: 'AUTHORIZE' }, ctx)).toEqual({ method: 1 });
  });

  it('returns method 3 for simple AUTHORIZE when channel has no buttons', () => {
    const ctx = makeContext({ capabilities: minimalCaps });
    expect(selectA2HMethod({ intent: 'AUTHORIZE' }, ctx)).toEqual({ method: 3 });
  });

  it('returns method 3 for complex AUTHORIZE (has schema fields)', () => {
    const ctx = makeContext();
    const msg: A2HMessage = {
      intent: 'AUTHORIZE',
      schema: {
        fields: [{ name: 'reason', label: 'Reason', type: 'text' }],
      },
    };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 3 });
  });
});

// ---------------------------------------------------------------------------
// COLLECT — closed options
// ---------------------------------------------------------------------------

describe('selectA2HMethod — COLLECT with closed options', () => {
  it('returns method 1 when options array present and channel supports buttons', () => {
    const ctx = makeContext({ capabilities: { ...fullCaps, supportsButtons: true } });
    const msg: A2HMessage = { intent: 'COLLECT', options: ['yes', 'no', 'maybe'] };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 1 });
  });

  it('returns method 1 when options array present and channel supports select menus', () => {
    const ctx = makeContext({
      capabilities: {
        ...minimalCaps,
        supportsSelectMenus: true,
      },
    });
    const msg: A2HMessage = { intent: 'COLLECT', options: ['a', 'b'] };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 1 });
  });

  it('returns method 3 when options present but channel supports neither buttons nor selects', () => {
    const ctx = makeContext({ capabilities: minimalCaps });
    const msg: A2HMessage = { intent: 'COLLECT', options: ['a', 'b'] };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 3 });
  });

  it('returns method 1 for all-select schema on capable channel', () => {
    const ctx = makeContext();
    const msg: A2HMessage = {
      intent: 'COLLECT',
      schema: {
        fields: [
          { name: 'env', label: 'Environment', type: 'select', options: ['staging', 'prod'] },
        ],
      },
    };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 1 });
  });
});

// ---------------------------------------------------------------------------
// COLLECT — free-text, single field
// ---------------------------------------------------------------------------

describe('selectA2HMethod — COLLECT free-text single field', () => {
  it('returns method 2 when channel has native threads', () => {
    const ctx = makeContext({
      capabilities: { ...minimalCaps, hasNativeThreads: true },
    });
    expect(selectA2HMethod({ intent: 'COLLECT' }, ctx)).toEqual({ method: 2 });
  });

  it('returns method 2 when channel has reply messages (no threads)', () => {
    const ctx = makeContext({
      capabilities: { ...minimalCaps, hasReplyMessages: true },
    });
    expect(selectA2HMethod({ intent: 'COLLECT' }, ctx)).toEqual({ method: 2 });
  });

  it('returns method 2 when context is DM (no threads/reply)', () => {
    const ctx = makeContext({ capabilities: minimalCaps, isDM: true });
    expect(selectA2HMethod({ intent: 'COLLECT' }, ctx)).toEqual({ method: 2 });
  });

  it('returns method 3 when no thread/reply/DM available', () => {
    const ctx = makeContext({ capabilities: minimalCaps, isDM: false });
    expect(selectA2HMethod({ intent: 'COLLECT' }, ctx)).toEqual({ method: 3 });
  });

  it('prefers thread over reply and DM', () => {
    const ctx = makeContext({
      capabilities: { ...minimalCaps, hasNativeThreads: true, hasReplyMessages: true },
      isDM: true,
    });
    expect(selectA2HMethod({ intent: 'COLLECT' }, ctx)).toEqual({ method: 2 });
  });
});

// ---------------------------------------------------------------------------
// COLLECT — multiple fields
// ---------------------------------------------------------------------------

describe('selectA2HMethod — COLLECT multiple fields', () => {
  it('returns method 3 regardless of channel capabilities', () => {
    const ctx = makeContext(); // full capabilities
    const msg: A2HMessage = {
      intent: 'COLLECT',
      schema: {
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'email', label: 'Email', type: 'email' },
        ],
      },
    };
    expect(selectA2HMethod(msg, ctx)).toEqual({ method: 3 });
  });
});

// ---------------------------------------------------------------------------
// deriveCaptureMode
// ---------------------------------------------------------------------------

describe('deriveCaptureMode', () => {
  it('returns thread when native threads are available', () => {
    const ctx = makeContext({ capabilities: { ...minimalCaps, hasNativeThreads: true } });
    expect(deriveCaptureMode(ctx)).toBe('thread');
  });

  it('returns reply when no native threads but has reply messages', () => {
    const ctx = makeContext({
      capabilities: { ...minimalCaps, hasReplyMessages: true },
    });
    expect(deriveCaptureMode(ctx)).toBe('reply');
  });

  it('returns dm when only DM context is available', () => {
    const ctx = makeContext({ capabilities: minimalCaps, isDM: true });
    expect(deriveCaptureMode(ctx)).toBe('dm');
  });
});
