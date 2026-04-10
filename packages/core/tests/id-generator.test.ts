import { describe, test, expect } from 'bun:test';
import {
  generateThreadId,
  generateTurnId,
  generateTokenId,
  generateChannelSecretKey,
  isThreadId,
  isTurnId,
  isTokenId,
  isChannelSecretKey,
  ID_PREFIXES,
} from '../src/utils/id-generator';

describe('ID generation', () => {
  describe('generateThreadId', () => {
    test('produces the correct ot_thr_ prefix', () => {
      const id = generateThreadId();
      expect(id).toStartWith('ot_thr_');
    });

    test('produces unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateThreadId()));
      expect(ids.size).toBe(100);
    });

    test('has the expected format length', () => {
      const id = generateThreadId();
      // "ot_thr_" (7) + 16 random chars = 23
      expect(id.length).toBe(ID_PREFIXES.thread.length + 16);
    });

    test('only contains alphanumeric characters after the prefix', () => {
      const id = generateThreadId();
      const suffix = id.slice(ID_PREFIXES.thread.length);
      expect(suffix).toMatch(/^[0-9a-zA-Z]+$/);
    });
  });

  describe('generateTurnId', () => {
    test('produces the correct ot_turn_ prefix', () => {
      const id = generateTurnId();
      expect(id).toStartWith('ot_turn_');
    });

    test('produces unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTurnId()));
      expect(ids.size).toBe(100);
    });

    test('has the expected format length', () => {
      const id = generateTurnId();
      // "ot_turn_" (8) + 16 random chars = 24
      expect(id.length).toBe(ID_PREFIXES.turn.length + 16);
    });

    test('only contains alphanumeric characters after the prefix', () => {
      const id = generateTurnId();
      const suffix = id.slice(ID_PREFIXES.turn.length);
      expect(suffix).toMatch(/^[0-9a-zA-Z]+$/);
    });
  });

  describe('generateTokenId', () => {
    test('produces the correct ot_tk_ prefix', () => {
      const id = generateTokenId();
      expect(id).toStartWith('ot_tk_');
    });

    test('produces unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTokenId()));
      expect(ids.size).toBe(100);
    });

    test('has the expected format length', () => {
      const id = generateTokenId();
      expect(id.length).toBe(ID_PREFIXES.token.length + 16);
    });
  });

  describe('generateChannelSecretKey', () => {
    test('produces the correct ot_ch_sk_ prefix', () => {
      const id = generateChannelSecretKey();
      expect(id).toStartWith('ot_ch_sk_');
    });

    test('produces unique IDs on each call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateChannelSecretKey()));
      expect(ids.size).toBe(100);
    });

    test('has the expected format length', () => {
      const id = generateChannelSecretKey();
      expect(id.length).toBe(ID_PREFIXES.channelSecretKey.length + 16);
    });
  });

  describe('type guards', () => {
    test('isThreadId returns true for valid thread IDs', () => {
      expect(isThreadId(generateThreadId())).toBe(true);
    });

    test('isThreadId returns false for other ID types', () => {
      expect(isThreadId(generateTurnId())).toBe(false);
      expect(isThreadId(generateTokenId())).toBe(false);
      expect(isThreadId(generateChannelSecretKey())).toBe(false);
      expect(isThreadId('random-string')).toBe(false);
      expect(isThreadId('ot_thr_')).toBe(false); // prefix only, no suffix
    });

    test('isTurnId returns true for valid turn IDs', () => {
      expect(isTurnId(generateTurnId())).toBe(true);
    });

    test('isTurnId returns false for other ID types', () => {
      expect(isTurnId(generateThreadId())).toBe(false);
      expect(isTurnId(generateTokenId())).toBe(false);
      expect(isTurnId('ot_turn_')).toBe(false); // prefix only, no suffix
    });

    test('isTokenId returns true for valid token IDs', () => {
      expect(isTokenId(generateTokenId())).toBe(true);
    });

    test('isTokenId returns false for other ID types', () => {
      expect(isTokenId(generateThreadId())).toBe(false);
      expect(isTokenId(generateChannelSecretKey())).toBe(false);
      expect(isTokenId('ot_tk_')).toBe(false); // prefix only, no suffix
    });

    test('isChannelSecretKey returns true for valid channel secret keys', () => {
      expect(isChannelSecretKey(generateChannelSecretKey())).toBe(true);
    });

    test('isChannelSecretKey returns false for other ID types', () => {
      expect(isChannelSecretKey(generateThreadId())).toBe(false);
      expect(isChannelSecretKey(generateTokenId())).toBe(false);
      expect(isChannelSecretKey('ot_ch_sk_')).toBe(false); // prefix only, no suffix
    });
  });

  describe('ID_PREFIXES constants', () => {
    test('has all expected prefix values', () => {
      expect(ID_PREFIXES.thread).toBe('ot_thr_');
      expect(ID_PREFIXES.turn).toBe('ot_turn_');
      expect(ID_PREFIXES.token).toBe('ot_tk_');
      expect(ID_PREFIXES.channelSecretKey).toBe('ot_ch_sk_');
    });
  });
});
