/**
 * Unit tests for normalization utilities.
 */
import { describe, test, expect } from 'bun:test';
import { collectReplyKey, buildReplyToUrl, deriveSenderName } from '../utils/normalize.js';

describe('collectReplyKey', () => {
  test('returns expected format', () => {
    expect(collectReplyKey('123', '456')).toBe('reply:123:456');
  });

  test('different chatIds produce different keys', () => {
    const k1 = collectReplyKey('100', '1');
    const k2 = collectReplyKey('200', '1');
    expect(k1).not.toBe(k2);
  });

  test('different messageIds produce different keys', () => {
    const k1 = collectReplyKey('100', '1');
    const k2 = collectReplyKey('100', '2');
    expect(k1).not.toBe(k2);
  });
});

describe('buildReplyToUrl', () => {
  test('includes all parts', () => {
    const url = buildReplyToUrl('https://ot.example.com', '777', '42');
    expect(url).toBe('https://ot.example.com/send/channel/telegram/target/777/thread/42');
  });

  test('works with different base URLs', () => {
    const url = buildReplyToUrl('http://localhost:3001', '1', '2');
    expect(url).toContain('http://localhost:3001');
    expect(url).toContain('/target/1/thread/2');
  });
});

describe('deriveSenderName', () => {
  test('first_name only', () => {
    expect(deriveSenderName({ id: 1, first_name: 'Alice' })).toBe('Alice');
  });

  test('first_name + last_name', () => {
    expect(deriveSenderName({ id: 1, first_name: 'Alice', last_name: 'Smith' })).toBe('Alice Smith');
  });

  test('falls back to username when no name', () => {
    expect(deriveSenderName({ id: 1, username: 'alice_bot' })).toBe('alice_bot');
  });

  test('falls back to string id when nothing else', () => {
    expect(deriveSenderName({ id: 12345 })).toBe('12345');
  });

  test('prefers full name over username', () => {
    expect(
      deriveSenderName({ id: 1, first_name: 'Bob', username: 'bob_user' }),
    ).toBe('Bob');
  });
});
