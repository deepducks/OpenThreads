/**
 * Unit tests — message parser (parseMessage, classifyItem, classifyAll)
 */

import { describe, expect, it } from 'bun:test';
import {
  parseMessage,
  isA2HItem,
  classifyItem,
  classifyAll,
} from '../parser.js';
import type { A2HMessage, ChatSDKMessage } from '../../types/index.js';

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe('parseMessage', () => {
  it('wraps a single object in a 1-item array', () => {
    const msg: ChatSDKMessage = { text: 'hello' };
    expect(parseMessage(msg)).toEqual([msg]);
  });

  it('returns an existing array unchanged', () => {
    const items = [{ text: 'a' }, { text: 'b' }];
    const result = parseMessage(items);
    expect(result).toBe(items); // same reference — no copy
    expect(result).toHaveLength(2);
  });

  it('handles an empty array', () => {
    expect(parseMessage([])).toEqual([]);
  });

  it('handles a 1-item array', () => {
    const items: ChatSDKMessage[] = [{ text: 'single' }];
    expect(parseMessage(items)).toEqual([{ text: 'single' }]);
  });

  it('normalises an A2H object to a 1-item array', () => {
    const intent: A2HMessage = { intent: 'AUTHORIZE' };
    expect(parseMessage(intent)).toEqual([intent]);
  });
});

// ---------------------------------------------------------------------------
// isA2HItem / classifyItem
// ---------------------------------------------------------------------------

describe('isA2HItem', () => {
  it('returns true when `intent` is present', () => {
    expect(isA2HItem({ intent: 'INFORM' })).toBe(true);
    expect(isA2HItem({ intent: 'COLLECT', schema: { fields: [] } })).toBe(true);
  });

  it('returns false when `intent` is absent', () => {
    expect(isA2HItem({ text: 'hello' })).toBe(false);
    expect(isA2HItem({ blocks: [] })).toBe(false);
  });

  it('returns false when `intent` is not a string', () => {
    expect(isA2HItem({ intent: 42 } as unknown as Record<string, unknown>)).toBe(false);
    expect(isA2HItem({ intent: null } as unknown as Record<string, unknown>)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isA2HItem({})).toBe(false);
  });
});

describe('classifyItem', () => {
  it('classifies a Chat SDK item', () => {
    const item: ChatSDKMessage = { text: 'Deploy complete.' };
    expect(classifyItem(item)).toEqual({ type: 'chat-sdk', item });
  });

  it('classifies an A2H AUTHORIZE item', () => {
    const item: A2HMessage = {
      intent: 'AUTHORIZE',
      context: { action: 'deploy' },
    };
    expect(classifyItem(item)).toEqual({ type: 'a2h', item });
  });

  it('classifies an A2H COLLECT item', () => {
    const item: A2HMessage = { intent: 'COLLECT' };
    expect(classifyItem(item)).toEqual({ type: 'a2h', item });
  });

  it('classifies an A2H INFORM item', () => {
    const item: A2HMessage = { intent: 'INFORM', context: { message: 'ok' } };
    expect(classifyItem(item)).toEqual({ type: 'a2h', item });
  });
});

// ---------------------------------------------------------------------------
// classifyAll
// ---------------------------------------------------------------------------

describe('classifyAll', () => {
  it('classifies a mixed array correctly', () => {
    const text: ChatSDKMessage = { text: 'Tests passed.' };
    const auth: A2HMessage = { intent: 'AUTHORIZE' };

    const result = classifyAll([text, auth]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'chat-sdk', item: text });
    expect(result[1]).toEqual({ type: 'a2h', item: auth });
  });

  it('classifies an all-Chat-SDK array', () => {
    const items: ChatSDKMessage[] = [{ text: 'a' }, { text: 'b' }];
    const result = classifyAll(items);
    expect(result.every((r) => r.type === 'chat-sdk')).toBe(true);
  });

  it('classifies an all-A2H array', () => {
    const items: A2HMessage[] = [
      { intent: 'INFORM' },
      { intent: 'COLLECT' },
    ];
    const result = classifyAll(items);
    expect(result.every((r) => r.type === 'a2h')).toBe(true);
  });

  it('handles an empty array', () => {
    expect(classifyAll([])).toEqual([]);
  });
});
