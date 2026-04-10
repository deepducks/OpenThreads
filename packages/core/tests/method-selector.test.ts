import { describe, test, expect } from 'bun:test';
import {
  selectReplyMethod,
  selectBatchMethod,
  resolveCaptureMethod,
} from '../src/reply-engine/method-selector.js';
import type { A2HMessage, ChannelCapabilities } from '../src/types/index.js';

// ---------------------------------------------------------------------------
// Capability presets for concise test cases
// ---------------------------------------------------------------------------

const fullCapabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: true,
  supportsNativeThreads: true,
  supportsNativeReplies: true,
  isDM: false,
};

const slackLike: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: true,
  supportsNativeThreads: true,
  supportsNativeReplies: false,
  isDM: false,
};

const telegramGroup: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: false,
  supportsNativeThreads: false,
  supportsNativeReplies: true,
  isDM: false,
};

const smsLike: ChannelCapabilities = {
  supportsButtons: false,
  supportsSelectMenus: false,
  supportsNativeThreads: false,
  supportsNativeReplies: false,
  isDM: false,
};

const dmCapabilities: ChannelCapabilities = {
  supportsButtons: false,
  supportsSelectMenus: false,
  supportsNativeThreads: false,
  supportsNativeReplies: false,
  isDM: true,
};

// ---------------------------------------------------------------------------
// Trust layer
// ---------------------------------------------------------------------------

describe('selectReplyMethod — trust layer active', () => {
  test('always returns method 3 regardless of intent or capabilities', () => {
    const intents: A2HMessage['intent'][] = ['AUTHORIZE', 'COLLECT', 'INFORM', 'ESCALATE'];
    for (const intent of intents) {
      expect(selectReplyMethod({ intent }, fullCapabilities, true)).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// AUTHORIZE
// ---------------------------------------------------------------------------

describe('selectReplyMethod — AUTHORIZE', () => {
  test('method 1 (inline) when channel supports buttons', () => {
    expect(selectReplyMethod({ intent: 'AUTHORIZE' }, slackLike, false)).toBe(1);
  });

  test('method 1 when channel supports buttons (Telegram)', () => {
    expect(selectReplyMethod({ intent: 'AUTHORIZE' }, telegramGroup, false)).toBe(1);
  });

  test('method 3 (external form) when channel has no buttons (SMS)', () => {
    expect(selectReplyMethod({ intent: 'AUTHORIZE' }, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — closed options
// ---------------------------------------------------------------------------

describe('selectReplyMethod — COLLECT closed options', () => {
  test('method 1 when channel supports select menus (single select field)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'env', type: 'select', options: ['staging', 'prod'] }] },
    };
    expect(selectReplyMethod(msg, slackLike, false)).toBe(1);
  });

  test('method 1 for checkbox field when channel has buttons', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'agree', type: 'checkbox', options: ['yes'] }] },
    };
    expect(selectReplyMethod(msg, telegramGroup, false)).toBe(1);
  });

  test('method 3 when channel has no select/buttons (SMS)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'env', type: 'select', options: ['staging', 'prod'] }] },
    };
    expect(selectReplyMethod(msg, smsLike, false)).toBe(3);
  });

  test('method 3 for multiselect when channel has no select/buttons', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'tags', type: 'multiselect', options: ['a', 'b'] }] },
    };
    expect(selectReplyMethod(msg, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — free-text (single text field)
// ---------------------------------------------------------------------------

describe('selectReplyMethod — COLLECT free-text single field', () => {
  test('method 2 (text capture) when channel supports native threads (Slack)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'reason', type: 'text' }] },
    };
    expect(selectReplyMethod(msg, slackLike, false)).toBe(2);
  });

  test('method 2 when channel supports native replies (Telegram group)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'reason', type: 'text' }] },
    };
    expect(selectReplyMethod(msg, telegramGroup, false)).toBe(2);
  });

  test('method 2 when context is DM (implicit capture)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'notes', type: 'textarea' }] },
    };
    expect(selectReplyMethod(msg, dmCapabilities, false)).toBe(2);
  });

  test('method 3 when channel cannot capture text natively (SMS)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { fields: [{ name: 'notes', type: 'text' }] },
    };
    expect(selectReplyMethod(msg, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — free-text (question, no fields)
// ---------------------------------------------------------------------------

describe('selectReplyMethod — COLLECT question (no fields)', () => {
  test('method 2 when channel supports threads', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { question: 'What is the deployment reason?' },
    };
    expect(selectReplyMethod(msg, slackLike, false)).toBe(2);
  });

  test('method 3 when channel cannot capture (SMS)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: { question: 'What is the deployment reason?' },
    };
    expect(selectReplyMethod(msg, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COLLECT — multiple fields
// ---------------------------------------------------------------------------

describe('selectReplyMethod — COLLECT multiple fields', () => {
  test('always method 3 regardless of channel capabilities', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      collect: {
        fields: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'text' },
        ],
      },
    };
    expect(selectReplyMethod(msg, fullCapabilities, false)).toBe(3);
    expect(selectReplyMethod(msg, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// INFORM
// ---------------------------------------------------------------------------

describe('selectReplyMethod — INFORM', () => {
  test('returns method 1 (fire-and-forget, no blocking)', () => {
    expect(selectReplyMethod({ intent: 'INFORM' }, smsLike, false)).toBe(1);
    expect(selectReplyMethod({ intent: 'INFORM' }, fullCapabilities, false)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ESCALATE
// ---------------------------------------------------------------------------

describe('selectReplyMethod — ESCALATE', () => {
  test('returns method 3 as fallback (actual handler is in ReplyEngine)', () => {
    expect(selectReplyMethod({ intent: 'ESCALATE' }, fullCapabilities, false)).toBe(3);
    expect(selectReplyMethod({ intent: 'ESCALATE' }, smsLike, false)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Batch method
// ---------------------------------------------------------------------------

describe('selectBatchMethod', () => {
  test('always returns method 4', () => {
    expect(selectBatchMethod()).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// resolveCaptureMethod
// ---------------------------------------------------------------------------

describe('resolveCaptureMethod', () => {
  test('returns "thread" when native threads are supported', () => {
    expect(resolveCaptureMethod(slackLike)).toBe('thread');
  });

  test('returns "reply" when no native threads but native replies supported', () => {
    expect(resolveCaptureMethod(telegramGroup)).toBe('reply');
  });

  test('returns "dm" when no threads/replies but context is DM', () => {
    expect(resolveCaptureMethod(dmCapabilities)).toBe('dm');
  });

  test('returns "none" when channel cannot capture text natively', () => {
    expect(resolveCaptureMethod(smsLike)).toBe('none');
  });

  test('prefers thread over reply when both are supported', () => {
    const caps: ChannelCapabilities = {
      ...fullCapabilities,
      supportsNativeThreads: true,
      supportsNativeReplies: true,
    };
    expect(resolveCaptureMethod(caps)).toBe('thread');
  });
});
