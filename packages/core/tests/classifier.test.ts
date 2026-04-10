import { describe, test, expect } from 'bun:test';
import { isA2HMessage, isChatSDKMessage, classifyMessage } from '../src/reply-engine/classifier.js';
import type { A2HMessage, ChatSDKMessage } from '../src/types/index.js';

describe('classifier', () => {
  describe('isA2HMessage', () => {
    test('returns true for A2H message with intent field', () => {
      const msg: A2HMessage = { intent: 'AUTHORIZE' };
      expect(isA2HMessage(msg)).toBe(true);
    });

    test('returns true for all A2H intent types', () => {
      const intents: A2HMessage['intent'][] = [
        'INFORM',
        'COLLECT',
        'AUTHORIZE',
        'ESCALATE',
        'RESULT',
      ];
      for (const intent of intents) {
        expect(isA2HMessage({ intent })).toBe(true);
      }
    });

    test('returns false for Chat SDK text message', () => {
      const msg: ChatSDKMessage = { text: 'Hello' };
      expect(isA2HMessage(msg)).toBe(false);
    });

    test('returns false for Chat SDK message with blocks', () => {
      const msg: ChatSDKMessage = { blocks: [{ type: 'section' }] };
      expect(isA2HMessage(msg)).toBe(false);
    });

    test('returns false for empty Chat SDK message', () => {
      const msg: ChatSDKMessage = {};
      expect(isA2HMessage(msg)).toBe(false);
    });

    test('returns false for Chat SDK message with attachments', () => {
      const msg: ChatSDKMessage = { attachments: [{ url: 'https://example.com/img.png' }] };
      expect(isA2HMessage(msg)).toBe(false);
    });
  });

  describe('isChatSDKMessage', () => {
    test('returns true for Chat SDK message', () => {
      const msg: ChatSDKMessage = { text: 'Hi' };
      expect(isChatSDKMessage(msg)).toBe(true);
    });

    test('returns false for A2H message', () => {
      const msg: A2HMessage = { intent: 'COLLECT' };
      expect(isChatSDKMessage(msg)).toBe(false);
    });
  });

  describe('classifyMessage', () => {
    test('classifies A2H message as "a2h"', () => {
      expect(classifyMessage({ intent: 'AUTHORIZE' })).toBe('a2h');
    });

    test('classifies Chat SDK message as "chatSdk"', () => {
      expect(classifyMessage({ text: 'Hello' })).toBe('chatSdk');
    });

    test('classifies A2H with full context as "a2h"', () => {
      const msg: A2HMessage = {
        intent: 'COLLECT',
        context: { action: 'get_name' },
        collect: { question: 'What is your name?' },
      };
      expect(classifyMessage(msg)).toBe('a2h');
    });
  });
});
