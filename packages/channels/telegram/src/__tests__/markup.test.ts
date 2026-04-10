/**
 * Unit tests for inline keyboard builders and callback data parser.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildAuthorizeKeyboard,
  buildCollectKeyboard,
  parseCallbackData,
} from '../utils/markup.js';

// ---------------------------------------------------------------------------
// buildAuthorizeKeyboard
// ---------------------------------------------------------------------------

describe('buildAuthorizeKeyboard', () => {
  test('returns an inline_keyboard array', () => {
    const kb = buildAuthorizeKeyboard('intent-001');
    expect(kb).toHaveProperty('inline_keyboard');
    expect(Array.isArray(kb.inline_keyboard)).toBe(true);
  });

  test('has exactly one row', () => {
    const kb = buildAuthorizeKeyboard('intent-001');
    expect(kb.inline_keyboard.length).toBe(1);
  });

  test('row has exactly two buttons', () => {
    const kb = buildAuthorizeKeyboard('intent-001');
    expect(kb.inline_keyboard[0].length).toBe(2);
  });

  test('first button is Approve', () => {
    const kb = buildAuthorizeKeyboard('intent-001');
    const btn = kb.inline_keyboard[0][0];
    expect(btn.text).toContain('Approve');
    expect(btn.callback_data).toBe('a2h:intent-001:approve');
  });

  test('second button is Deny', () => {
    const kb = buildAuthorizeKeyboard('intent-001');
    const btn = kb.inline_keyboard[0][1];
    expect(btn.text).toContain('Deny');
    expect(btn.callback_data).toBe('a2h:intent-001:deny');
  });

  test('encodes intentId correctly', () => {
    const kb = buildAuthorizeKeyboard('my-unique-id-42');
    expect(kb.inline_keyboard[0][0].callback_data).toContain('my-unique-id-42');
  });
});

// ---------------------------------------------------------------------------
// buildCollectKeyboard
// ---------------------------------------------------------------------------

describe('buildCollectKeyboard', () => {
  test('throws when options array is empty', () => {
    expect(() => buildCollectKeyboard('i', [])).toThrow();
  });

  test('single option — 1 row × 1 button', () => {
    const kb = buildCollectKeyboard('i', [{ label: 'Only', value: 'only' }]);
    expect(kb.inline_keyboard.length).toBe(1);
    expect(kb.inline_keyboard[0].length).toBe(1);
  });

  test('two options — 1 row × 2 buttons', () => {
    const kb = buildCollectKeyboard('i', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ]);
    expect(kb.inline_keyboard.length).toBe(1);
    expect(kb.inline_keyboard[0].length).toBe(2);
  });

  test('three options — 2 rows (2+1)', () => {
    const kb = buildCollectKeyboard('i', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ]);
    expect(kb.inline_keyboard.length).toBe(2);
    expect(kb.inline_keyboard[0].length).toBe(2);
    expect(kb.inline_keyboard[1].length).toBe(1);
  });

  test('button text is option label', () => {
    const kb = buildCollectKeyboard('i', [{ label: 'My Label', value: 'v' }]);
    expect(kb.inline_keyboard[0][0].text).toBe('My Label');
  });

  test('callback_data format: a2h:{intentId}:{value}', () => {
    const kb = buildCollectKeyboard('myId', [{ label: 'Choose', value: 'chosen' }]);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('a2h:myId:chosen');
  });

  test('value containing colons is preserved', () => {
    const kb = buildCollectKeyboard('id', [{ label: 'L', value: 'us-east-1' }]);
    expect(kb.inline_keyboard[0][0].callback_data).toBe('a2h:id:us-east-1');
  });
});

// ---------------------------------------------------------------------------
// parseCallbackData
// ---------------------------------------------------------------------------

describe('parseCallbackData', () => {
  test('returns null for non-a2h data', () => {
    expect(parseCallbackData('some_random_data')).toBeNull();
    expect(parseCallbackData('')).toBeNull();
    expect(parseCallbackData('a2h_approve')).toBeNull(); // wrong separator
  });

  test('returns null for malformed a2h data (no value part)', () => {
    expect(parseCallbackData('a2h:intent-id')).toBeNull();
  });

  test('returns null when intentId is empty', () => {
    expect(parseCallbackData('a2h::value')).toBeNull();
  });

  test('parses approve callback correctly', () => {
    const result = parseCallbackData('a2h:intent-001:approve');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('intent-001');
    expect(result!.value).toBe('approve');
  });

  test('parses deny callback correctly', () => {
    const result = parseCallbackData('a2h:intent-002:deny');
    expect(result!.intentId).toBe('intent-002');
    expect(result!.value).toBe('deny');
  });

  test('preserves value that contains colons', () => {
    const result = parseCallbackData('a2h:id:us-east-1:extra');
    expect(result!.intentId).toBe('id');
    expect(result!.value).toBe('us-east-1:extra');
  });

  test('handles UUID-style intentIds', () => {
    const result = parseCallbackData('a2h:f47ac10b-58cc-4372-a567-0e02b2c3d479:approve');
    expect(result!.intentId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(result!.value).toBe('approve');
  });
});
