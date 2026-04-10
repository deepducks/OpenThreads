import { describe, it, expect } from 'bun:test';
import {
  isA2HMessage,
  normalizeMessageInput,
  classifyItem,
  parseAndClassify,
} from '../engine/message-classifier.js';
import type { A2HIntentType } from '../types/index.js';

// ---------------------------------------------------------------------------
// isA2HMessage
// ---------------------------------------------------------------------------

describe('isA2HMessage', () => {
  it('returns true for objects with an intent field', () => {
    expect(isA2HMessage({ intent: 'AUTHORIZE' as A2HIntentType })).toBe(true);
    expect(isA2HMessage({ intent: 'COLLECT' as A2HIntentType, fields: [] })).toBe(true);
    expect(isA2HMessage({ intent: 'INFORM' as A2HIntentType })).toBe(true);
    expect(isA2HMessage({ intent: 'ESCALATE' as A2HIntentType })).toBe(true);
    expect(isA2HMessage({ intent: 'RESULT' as A2HIntentType })).toBe(true);
  });

  it('returns false for Chat SDK messages', () => {
    expect(isA2HMessage({ text: 'Hello' })).toBe(false);
    expect(isA2HMessage({ text: 'Hello', attachments: [] })).toBe(false);
    expect(isA2HMessage({})).toBe(false);
    expect(isA2HMessage({ markdown: '**bold**' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeMessageInput
// ---------------------------------------------------------------------------

describe('normalizeMessageInput', () => {
  it('wraps a single object into a 1-item array', () => {
    const msg = { text: 'Hello' };
    const result = normalizeMessageInput(msg);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(msg);
  });

  it('returns an existing array unchanged', () => {
    const msgs = [{ text: 'Hello' }, { intent: 'INFORM' as A2HIntentType }];
    expect(normalizeMessageInput(msgs)).toBe(msgs);
  });

  it('handles an empty array', () => {
    expect(normalizeMessageInput([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------

describe('classifyItem', () => {
  it('classifies A2H messages correctly', () => {
    const result = classifyItem({ intent: 'AUTHORIZE' as A2HIntentType });
    expect(result.type).toBe('a2h');
    if (result.type === 'a2h') {
      expect(result.message.intent).toBe('AUTHORIZE');
    }
  });

  it('classifies Chat SDK messages correctly', () => {
    const result = classifyItem({ text: 'Hello world' });
    expect(result.type).toBe('chat-sdk');
    if (result.type === 'chat-sdk') {
      expect(result.message.text).toBe('Hello world');
    }
  });
});

// ---------------------------------------------------------------------------
// parseAndClassify
// ---------------------------------------------------------------------------

describe('parseAndClassify', () => {
  it('handles a single Chat SDK message object', () => {
    const result = parseAndClassify({ text: 'Deploy started. ETA 3 minutes.' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('chat-sdk');
  });

  it('handles a single A2H message object', () => {
    const result = parseAndClassify({ intent: 'AUTHORIZE' as A2HIntentType });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('a2h');
  });

  it('handles a mixed array (text + AUTHORIZE)', () => {
    const result = parseAndClassify([
      { text: 'Tests passed. Ready for production.' },
      { intent: 'AUTHORIZE' as A2HIntentType, context: { action: 'deploy-to-production' } },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('chat-sdk');
    expect(result[1].type).toBe('a2h');
  });

  it('handles an array of only Chat SDK messages', () => {
    const result = parseAndClassify([
      { text: 'Step 1 complete.' },
      { text: 'Step 2 complete.' },
    ]);
    expect(result.every((item) => item.type === 'chat-sdk')).toBe(true);
  });

  it('handles an array of only A2H intents', () => {
    const result = parseAndClassify([
      { intent: 'AUTHORIZE' as A2HIntentType },
      { intent: 'COLLECT' as A2HIntentType, fields: [] },
    ]);
    expect(result.every((item) => item.type === 'a2h')).toBe(true);
  });

  it('handles an empty array', () => {
    expect(parseAndClassify([])).toHaveLength(0);
  });
});
