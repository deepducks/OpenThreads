import { describe, test, expect } from 'bun:test';
import { normalizeMessage } from '../src/reply-engine/normalizer.js';
import type { ChatSDKMessage, A2HMessage } from '../src/types/index.js';

describe('normalizeMessage', () => {
  test('wraps a single Chat SDK object in an array', () => {
    const msg: ChatSDKMessage = { text: 'Hello' };
    expect(normalizeMessage(msg)).toEqual([{ text: 'Hello' }]);
  });

  test('wraps a single A2H object in an array', () => {
    const msg: A2HMessage = { intent: 'AUTHORIZE' };
    expect(normalizeMessage(msg)).toEqual([{ intent: 'AUTHORIZE' }]);
  });

  test('returns the array unchanged when given an array', () => {
    const msgs = [{ text: 'First' }, { intent: 'INFORM' }] as Array<ChatSDKMessage | A2HMessage>;
    const result = normalizeMessage(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: 'First' });
    expect(result[1]).toEqual({ intent: 'INFORM' });
  });

  test('returns a 1-item array when given a 1-item array', () => {
    const msgs: ChatSDKMessage[] = [{ text: 'Only' }];
    const result = normalizeMessage(msgs);
    expect(result).toHaveLength(1);
  });

  test('preserves item order in multi-item array', () => {
    const msgs = [
      { text: 'Item 1' },
      { intent: 'AUTHORIZE' as const },
      { text: 'Item 3' },
    ] as Array<ChatSDKMessage | A2HMessage>;
    const result = normalizeMessage(msgs);
    expect(result[0]).toEqual({ text: 'Item 1' });
    expect(result[1]).toEqual({ intent: 'AUTHORIZE' });
    expect(result[2]).toEqual({ text: 'Item 3' });
  });
});
