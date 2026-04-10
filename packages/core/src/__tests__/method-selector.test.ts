import { describe, it, expect } from 'bun:test';
import {
  selectMethod,
  determineCaptureMode,
  isClosedCollect,
  isFreeTextSingleFieldCollect,
} from '../engine/method-selector.js';
import type { A2HMessage, ChannelCapabilities } from '../types/index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fullCapabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsSelectMenus: true,
  supportsNativeThreads: true,
  supportsReplyMessages: true,
  isDM: false,
};

const noCapabilities: ChannelCapabilities = {
  supportsButtons: false,
  supportsSelectMenus: false,
  supportsNativeThreads: false,
  supportsReplyMessages: false,
  isDM: false,
};

const dmCapabilities: ChannelCapabilities = {
  ...noCapabilities,
  isDM: true,
};

const buttonsOnlyCapabilities: ChannelCapabilities = {
  ...noCapabilities,
  supportsButtons: true,
};

const replyCapabilities: ChannelCapabilities = {
  ...noCapabilities,
  supportsReplyMessages: true,
};

// ---------------------------------------------------------------------------
// isClosedCollect
// ---------------------------------------------------------------------------

describe('isClosedCollect', () => {
  it('returns true when all fields are closed types', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [
        { id: 'choice', label: 'Pick one', type: 'select', options: [{ value: 'a', label: 'A' }] },
      ],
    };
    expect(isClosedCollect(msg)).toBe(true);
  });

  it('returns true for mixed closed types (select + checkbox)', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [
        { id: 'choice', label: 'Pick', type: 'multiselect' },
        { id: 'confirm', label: 'Confirm', type: 'checkbox' },
      ],
    };
    expect(isClosedCollect(msg)).toBe(true);
  });

  it('returns false when a field is text type', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [{ id: 'reason', label: 'Reason', type: 'text' }],
    };
    expect(isClosedCollect(msg)).toBe(false);
  });

  it('returns false when fields is empty', () => {
    expect(isClosedCollect({ intent: 'COLLECT', fields: [] })).toBe(false);
  });

  it('returns false when fields is undefined', () => {
    expect(isClosedCollect({ intent: 'COLLECT' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFreeTextSingleFieldCollect
// ---------------------------------------------------------------------------

describe('isFreeTextSingleFieldCollect', () => {
  it('returns true for a single text field', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [{ id: 'answer', label: 'Your answer', type: 'text' }],
    };
    expect(isFreeTextSingleFieldCollect(msg)).toBe(true);
  });

  it('returns true for a single number field', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [{ id: 'amount', label: 'Amount', type: 'number' }],
    };
    expect(isFreeTextSingleFieldCollect(msg)).toBe(true);
  });

  it('returns false for a select field', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [{ id: 'opt', label: 'Option', type: 'select' }],
    };
    expect(isFreeTextSingleFieldCollect(msg)).toBe(false);
  });

  it('returns false when there are multiple fields', () => {
    const msg: A2HMessage = {
      intent: 'COLLECT',
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'email', label: 'Email', type: 'text' },
      ],
    };
    expect(isFreeTextSingleFieldCollect(msg)).toBe(false);
  });

  it('returns false when fields is empty', () => {
    expect(isFreeTextSingleFieldCollect({ intent: 'COLLECT', fields: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineCaptureMode
// ---------------------------------------------------------------------------

describe('determineCaptureMode', () => {
  it('prefers thread when native threads are supported', () => {
    expect(determineCaptureMode(fullCapabilities)).toBe('thread');
  });

  it('falls back to reply when only reply messages are supported', () => {
    expect(determineCaptureMode(replyCapabilities)).toBe('reply');
  });

  it('falls back to dm when context is a DM', () => {
    expect(determineCaptureMode(dmCapabilities)).toBe('dm');
  });

  it('returns undefined when no capture mode is available', () => {
    expect(determineCaptureMode(noCapabilities)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// selectMethod — trust layer
// ---------------------------------------------------------------------------

describe('selectMethod — trust layer active', () => {
  it('always returns method 3 regardless of intent', () => {
    for (const intent of ['AUTHORIZE', 'COLLECT', 'INFORM', 'ESCALATE'] as const) {
      const result = selectMethod({ intent }, fullCapabilities, { trustLayerActive: true });
      expect(result.method).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// selectMethod — multiple A2H intents (method 4)
// ---------------------------------------------------------------------------

describe('selectMethod — multiple A2H intents', () => {
  it('returns method 4 when a2hCount > 1', () => {
    const result = selectMethod({ intent: 'AUTHORIZE' }, fullCapabilities, { a2hCount: 2 });
    expect(result.method).toBe(4);
  });

  it('returns method 4 even for INFORM when a2hCount > 1', () => {
    const result = selectMethod({ intent: 'INFORM' }, fullCapabilities, { a2hCount: 3 });
    expect(result.method).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// selectMethod — INFORM
// ---------------------------------------------------------------------------

describe('selectMethod — INFORM', () => {
  it('returns method 1 (fire-and-forget display)', () => {
    const result = selectMethod({ intent: 'INFORM' }, fullCapabilities);
    expect(result.method).toBe(1);
  });

  it('returns method 1 even on limited channels', () => {
    const result = selectMethod({ intent: 'INFORM' }, noCapabilities);
    expect(result.method).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// selectMethod — AUTHORIZE
// ---------------------------------------------------------------------------

describe('selectMethod — AUTHORIZE', () => {
  it('returns method 1 when channel supports buttons', () => {
    const result = selectMethod({ intent: 'AUTHORIZE' }, fullCapabilities);
    expect(result.method).toBe(1);
  });

  it('returns method 3 when channel does not support buttons', () => {
    const result = selectMethod({ intent: 'AUTHORIZE' }, noCapabilities);
    expect(result.method).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// selectMethod — COLLECT
// ---------------------------------------------------------------------------

describe('selectMethod — COLLECT with closed options', () => {
  const msg: A2HMessage = {
    intent: 'COLLECT',
    fields: [
      {
        id: 'env',
        label: 'Target environment',
        type: 'select',
        options: [
          { value: 'staging', label: 'Staging' },
          { value: 'production', label: 'Production' },
        ],
      },
    ],
  };

  it('returns method 1 when channel supports buttons or select menus', () => {
    expect(selectMethod(msg, fullCapabilities).method).toBe(1);
    expect(selectMethod(msg, buttonsOnlyCapabilities).method).toBe(1);
  });

  it('returns method 3 when channel has no button/select support', () => {
    expect(selectMethod(msg, noCapabilities).method).toBe(3);
  });
});

describe('selectMethod — COLLECT with free-text single field', () => {
  const msg: A2HMessage = {
    intent: 'COLLECT',
    fields: [{ id: 'reason', label: 'Reason for the change', type: 'text' }],
  };

  it('returns method 2 with thread capture when threads are supported', () => {
    const result = selectMethod(msg, fullCapabilities);
    expect(result.method).toBe(2);
    expect(result.captureMode).toBe('thread');
  });

  it('returns method 2 with reply capture when only replies are supported', () => {
    const result = selectMethod(msg, replyCapabilities);
    expect(result.method).toBe(2);
    expect(result.captureMode).toBe('reply');
  });

  it('returns method 2 with dm capture for DM context', () => {
    const result = selectMethod(msg, dmCapabilities);
    expect(result.method).toBe(2);
    expect(result.captureMode).toBe('dm');
  });

  it('returns method 3 when no capture mode is available', () => {
    const result = selectMethod(msg, noCapabilities);
    expect(result.method).toBe(3);
  });
});

describe('selectMethod — COLLECT with multiple fields', () => {
  const msg: A2HMessage = {
    intent: 'COLLECT',
    fields: [
      { id: 'name', label: 'Your name', type: 'text' },
      { id: 'email', label: 'Your email', type: 'text' },
    ],
  };

  it('always returns method 3', () => {
    expect(selectMethod(msg, fullCapabilities).method).toBe(3);
    expect(selectMethod(msg, noCapabilities).method).toBe(3);
  });
});

describe('selectMethod — COLLECT with no fields', () => {
  it('returns method 1 when channel supports buttons (treat as closed/unspecified)', () => {
    const result = selectMethod({ intent: 'COLLECT' }, buttonsOnlyCapabilities);
    expect(result.method).toBe(1);
  });

  it('returns method 3 when channel has no capabilities', () => {
    const result = selectMethod({ intent: 'COLLECT' }, noCapabilities);
    expect(result.method).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// selectMethod — ESCALATE / RESULT
// ---------------------------------------------------------------------------

describe('selectMethod — ESCALATE and RESULT', () => {
  it('returns method 3 for ESCALATE', () => {
    expect(selectMethod({ intent: 'ESCALATE' }, fullCapabilities).method).toBe(3);
  });

  it('returns method 3 for RESULT', () => {
    expect(selectMethod({ intent: 'RESULT' }, fullCapabilities).method).toBe(3);
  });
});
