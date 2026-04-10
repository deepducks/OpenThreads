/**
 * Unit tests for message normalization utilities.
 */
import { describe, test, expect } from 'bun:test';
import { extractText, isBot, buildReplyToUrl, collectThreadKey } from '../utils/normalize.js';
import type { GenericMessageEvent } from '@slack/bolt';

// ---------------------------------------------------------------------------
// extractText
// ---------------------------------------------------------------------------

describe('extractText()', () => {
  test('returns trimmed text from a message event', () => {
    const event = { text: '  hello world  ' } as unknown as GenericMessageEvent;
    expect(extractText(event)).toBe('hello world');
  });

  test('returns empty string when text is undefined', () => {
    const event = {} as unknown as GenericMessageEvent;
    expect(extractText(event)).toBe('');
  });

  test('returns empty string when text is null', () => {
    const event = { text: null } as unknown as GenericMessageEvent;
    expect(extractText(event)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isBot
// ---------------------------------------------------------------------------

describe('isBot()', () => {
  test('returns true when bot_id is present', () => {
    const event = { bot_id: 'B12345' } as unknown as GenericMessageEvent;
    expect(isBot(event)).toBe(true);
  });

  test('returns false when bot_id is absent', () => {
    const event = { user: 'U12345' } as unknown as GenericMessageEvent;
    expect(isBot(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildReplyToUrl
// ---------------------------------------------------------------------------

describe('buildReplyToUrl()', () => {
  test('builds a correct OpenThreads reply URL', () => {
    const url = buildReplyToUrl(
      'https://openthreads.example.com',
      'C01234',
      '1234567890.000100',
    );
    expect(url).toBe(
      'https://openthreads.example.com/send/channel/slack/target/C01234/thread/1234567890.000100',
    );
  });
});

// ---------------------------------------------------------------------------
// collectThreadKey
// ---------------------------------------------------------------------------

describe('collectThreadKey()', () => {
  test('produces a stable, unique key', () => {
    const key = collectThreadKey('C01234', '9876543210.000200');
    expect(key).toBe('thread:C01234:9876543210.000200');
  });

  test('different channels produce different keys', () => {
    const k1 = collectThreadKey('C111', '1234.000');
    const k2 = collectThreadKey('C222', '1234.000');
    expect(k1).not.toBe(k2);
  });
});
