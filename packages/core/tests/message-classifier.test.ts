import { describe, test, expect } from 'bun:test';
import {
  isA2HMessage,
  isChatSDKMessage,
  classifyMessages,
  normaliseToArray,
  hasA2HMessages,
  hasChatSDKMessages,
} from '../src/utils/message-classifier';
import type { A2HMessage } from '../src/types/a2h';
import type { ChatSDKMessage, OpenThreadsMessage } from '../src/types/message';

// ---- Test fixtures ----

const chatMsg: ChatSDKMessage = { text: 'Hello world' };
const chatMsgWithAttachments: ChatSDKMessage = {
  text: 'See attached',
  attachments: [{ url: 'https://example.com/file.pdf', name: 'file.pdf' }],
};

const informMsg: A2HMessage = { intent: 'INFORM', description: 'Deploy completed' };
const collectMsg: A2HMessage = {
  intent: 'COLLECT',
  context: { field: 'address', prompt: 'What is your shipping address?' },
};
const authorizeMsg: A2HMessage = {
  intent: 'AUTHORIZE',
  context: { action: 'deploy-to-prod', details: 'branch feature-x → production' },
};
const escalateMsg: A2HMessage = { intent: 'ESCALATE' };
const resultMsg: A2HMessage = { intent: 'RESULT', context: { status: 'success' } };

describe('isA2HMessage', () => {
  test('returns true for INFORM intent', () => {
    expect(isA2HMessage(informMsg)).toBe(true);
  });

  test('returns true for COLLECT intent', () => {
    expect(isA2HMessage(collectMsg)).toBe(true);
  });

  test('returns true for AUTHORIZE intent', () => {
    expect(isA2HMessage(authorizeMsg)).toBe(true);
  });

  test('returns true for ESCALATE intent', () => {
    expect(isA2HMessage(escalateMsg)).toBe(true);
  });

  test('returns true for RESULT intent', () => {
    expect(isA2HMessage(resultMsg)).toBe(true);
  });

  test('returns false for Chat SDK message with text only', () => {
    expect(isA2HMessage(chatMsg)).toBe(false);
  });

  test('returns false for Chat SDK message with attachments', () => {
    expect(isA2HMessage(chatMsgWithAttachments)).toBe(false);
  });

  test('returns false for message with unknown intent string', () => {
    const unknownIntent = { intent: 'UNKNOWN_INTENT' } as unknown as OpenThreadsMessage;
    expect(isA2HMessage(unknownIntent)).toBe(false);
  });

  test('returns false for message with intent as non-string', () => {
    const badIntent = { intent: 42 } as unknown as OpenThreadsMessage;
    expect(isA2HMessage(badIntent)).toBe(false);
  });

  test('returns false for empty object', () => {
    const empty = {} as OpenThreadsMessage;
    expect(isA2HMessage(empty)).toBe(false);
  });
});

describe('isChatSDKMessage', () => {
  test('returns true for plain text Chat SDK message', () => {
    expect(isChatSDKMessage(chatMsg)).toBe(true);
  });

  test('returns true for message with attachments', () => {
    expect(isChatSDKMessage(chatMsgWithAttachments)).toBe(true);
  });

  test('returns false for A2H message', () => {
    expect(isChatSDKMessage(authorizeMsg)).toBe(false);
  });

  test('returns false for COLLECT message', () => {
    expect(isChatSDKMessage(collectMsg)).toBe(false);
  });

  test('isChatSDKMessage is complement of isA2HMessage', () => {
    const messages: OpenThreadsMessage[] = [
      chatMsg,
      chatMsgWithAttachments,
      informMsg,
      collectMsg,
      authorizeMsg,
      escalateMsg,
      resultMsg,
    ];
    for (const msg of messages) {
      expect(isChatSDKMessage(msg)).toBe(!isA2HMessage(msg));
    }
  });
});

describe('classifyMessages', () => {
  test('classifies a single Chat SDK message correctly', () => {
    const result = classifyMessages(chatMsg);
    expect(result.chatSDK).toHaveLength(1);
    expect(result.a2h).toHaveLength(0);
    expect(result.chatSDK[0]).toBe(chatMsg);
  });

  test('classifies a single A2H message correctly', () => {
    const result = classifyMessages(authorizeMsg);
    expect(result.chatSDK).toHaveLength(0);
    expect(result.a2h).toHaveLength(1);
    expect(result.a2h[0]).toBe(authorizeMsg);
  });

  test('classifies a mixed array correctly (VISION.md example)', () => {
    const mixed = [chatMsg, authorizeMsg];
    const result = classifyMessages(mixed);
    expect(result.chatSDK).toHaveLength(1);
    expect(result.a2h).toHaveLength(1);
    expect(result.chatSDK[0]).toBe(chatMsg);
    expect(result.a2h[0]).toBe(authorizeMsg);
  });

  test('handles all-Chat SDK array', () => {
    const result = classifyMessages([chatMsg, chatMsgWithAttachments]);
    expect(result.chatSDK).toHaveLength(2);
    expect(result.a2h).toHaveLength(0);
  });

  test('handles all-A2H array', () => {
    const result = classifyMessages([informMsg, collectMsg, authorizeMsg]);
    expect(result.chatSDK).toHaveLength(0);
    expect(result.a2h).toHaveLength(3);
  });
});

describe('normaliseToArray', () => {
  test('wraps a single message in an array', () => {
    const result = normaliseToArray(chatMsg);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(chatMsg);
  });

  test('returns an array as-is', () => {
    const arr = [chatMsg, authorizeMsg];
    const result = normaliseToArray(arr);
    expect(result).toBe(arr);
    expect(result).toHaveLength(2);
  });
});

describe('hasA2HMessages', () => {
  test('returns true when array contains an A2H message', () => {
    expect(hasA2HMessages([chatMsg, authorizeMsg])).toBe(true);
  });

  test('returns true for a single A2H message', () => {
    expect(hasA2HMessages(informMsg)).toBe(true);
  });

  test('returns false when array contains only Chat SDK messages', () => {
    expect(hasA2HMessages([chatMsg, chatMsgWithAttachments])).toBe(false);
  });

  test('returns false for a single Chat SDK message', () => {
    expect(hasA2HMessages(chatMsg)).toBe(false);
  });
});

describe('hasChatSDKMessages', () => {
  test('returns true when array contains a Chat SDK message', () => {
    expect(hasChatSDKMessages([chatMsg, authorizeMsg])).toBe(true);
  });

  test('returns true for a single Chat SDK message', () => {
    expect(hasChatSDKMessages(chatMsg)).toBe(true);
  });

  test('returns false when array contains only A2H messages', () => {
    expect(hasChatSDKMessages([informMsg, authorizeMsg])).toBe(false);
  });

  test('returns false for a single A2H message', () => {
    expect(hasChatSDKMessages(authorizeMsg)).toBe(false);
  });
});
