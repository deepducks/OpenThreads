/**
 * Mock channel servers for integration and E2E testing.
 *
 * Each `MockChannelServer` simulates a platform's webhook callback mechanism:
 *   - Accepts outbound messages "sent" by an adapter and records them.
 *   - Provides helpers to emit inbound events (as if a user sent a message).
 *   - Exposes a `lastSent` accessor to assert on outbound messages.
 *
 * These mocks are pure in-process objects — no real HTTP servers are started.
 * They are intended to be injected into adapter constructors via dependency-
 * injection interfaces wherever possible, or patched onto adapter internals
 * when the adapter does not expose a DI surface.
 *
 * ### Usage
 *
 * ```ts
 * const server = new MockSlackServer();
 *
 * // Simulate an inbound Slack message:
 * server.emitMessage({ userId: 'U123', channelId: 'C456', text: 'Hello!' });
 *
 * // Assert the adapter sent back an outbound message:
 * expect(server.lastSent?.text).toBe('Got it!');
 * ```
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface MockSentMessage {
  target: string;
  payload: unknown;
  sentAt: Date;
}

export interface MockInboundEvent {
  senderId: string;
  senderName?: string;
  targetId: string;
  text: string;
  nativeThreadId?: string;
  isDm?: boolean;
  isMention?: boolean;
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base class for mock channel servers.
 *
 * Tracks outbound messages and provides helpers common to all platforms.
 */
export abstract class BaseMockChannelServer {
  protected readonly _sent: MockSentMessage[] = [];
  private readonly inboundListeners: Array<(event: MockInboundEvent) => void> = [];

  /** All outbound messages recorded so far (oldest first). */
  get sent(): ReadonlyArray<MockSentMessage> {
    return this._sent;
  }

  /** The most recent outbound message, or `undefined` if none yet. */
  get lastSent(): MockSentMessage | undefined {
    return this._sent[this._sent.length - 1];
  }

  /** Clear all recorded outbound messages. */
  clearSent(): void {
    this._sent.length = 0;
  }

  /** Register a listener that receives emulated inbound events. */
  onInbound(listener: (event: MockInboundEvent) => void): () => void {
    this.inboundListeners.push(listener);
    return () => {
      const idx = this.inboundListeners.indexOf(listener);
      if (idx !== -1) this.inboundListeners.splice(idx, 1);
    };
  }

  /** Emit a simulated inbound message to all registered listeners. */
  emitInbound(event: MockInboundEvent): void {
    for (const listener of this.inboundListeners) {
      listener(event);
    }
  }

  /**
   * Record an outbound message (called by the mock send implementation).
   */
  protected recordSent(target: string, payload: unknown): void {
    this._sent.push({ target, payload, sentAt: new Date() });
  }
}

// ---------------------------------------------------------------------------
// Slack mock
// ---------------------------------------------------------------------------

export interface MockSlackMessage {
  channel: string;
  thread_ts?: string;
  text?: string;
  blocks?: unknown[];
}

/**
 * Mock Slack server.
 *
 * Simulates the Slack API's `chat.postMessage` / `chat.update` surface.
 * Inject via `SlackAdapterDeps.client` when creating a `SlackAdapter` for tests.
 */
export class MockSlackServer extends BaseMockChannelServer {
  private ts = 1_000;

  /** Create a mock Slack `WebClient`-compatible client surface. */
  createMockClient() {
    const server = this;
    return {
      chat: {
        postMessage: async (msg: MockSlackMessage) => {
          const messageTs = `${++server.ts}.000000`;
          server.recordSent(msg.channel, msg);
          return { ok: true, ts: messageTs };
        },
        update: async (msg: { channel: string; ts: string }) => {
          server.recordSent(msg.channel, { ...msg, _type: 'update' });
          return { ok: true };
        },
      },
      users: {
        info: async ({ user }: { user: string }) => ({
          ok: true,
          user: { name: user, real_name: `Mock User (${user})` },
        }),
      },
    };
  }

  /** Create a mock Slack `App`-compatible event dispatcher. */
  createMockApp() {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<void>> = {};

    return {
      app: {
        message: (h: (args: Record<string, unknown>) => Promise<void>) => {
          handlers['message'] = h;
        },
        event: (name: string, h: (args: Record<string, unknown>) => Promise<void>) => {
          handlers[`event:${name}`] = h;
        },
        command: (name: string, h: (args: Record<string, unknown>) => Promise<void>) => {
          handlers[`command:${name}`] = h;
        },
        action: (name: string, h: (args: Record<string, unknown>) => Promise<void>) => {
          handlers[`action:${name}`] = h;
        },
        start: async () => {},
        stop: async () => {},
      },
      /** Trigger a registered handler directly (for testing). */
      trigger: async (key: string, args: Record<string, unknown>) => {
        const handler = handlers[key];
        if (!handler) throw new Error(`No Slack handler registered for "${key}"`);
        await handler(args);
      },
      handlers,
    };
  }
}

// ---------------------------------------------------------------------------
// Telegram mock
// ---------------------------------------------------------------------------

export interface MockTelegramMessage {
  chat_id: string | number;
  text?: string;
  reply_markup?: unknown;
  parse_mode?: string;
  reply_to_message_id?: number;
}

/**
 * Mock Telegram server.
 *
 * Simulates the Telegram Bot API's `sendMessage` / `answerCallbackQuery`
 * surface. Inject via `TelegramAdapterOptions.apiClient` when creating a
 * `TelegramAdapter` for tests.
 */
export class MockTelegramServer extends BaseMockChannelServer {
  private messageId = 100;
  private readonly callbackListeners: Array<(queryId: string, text?: string) => void> = [];

  /** Create a mock `TelegramApiClient`-compatible surface. */
  createMockApiClient() {
    const server = this;
    return {
      sendMessage: async (params: MockTelegramMessage) => {
        const id = ++server.messageId;
        server.recordSent(String(params.chat_id), params);
        return { message_id: id, date: Math.floor(Date.now() / 1000) };
      },
      editMessageReplyMarkup: async (params: unknown) => {
        server.recordSent('_edit', params);
        return {};
      },
      answerCallbackQuery: async (params: { callback_query_id: string; text?: string }) => {
        for (const listener of server.callbackListeners) {
          listener(params.callback_query_id, params.text);
        }
        return {};
      },
      setWebhook: async (_params: unknown) => ({ ok: true }),
      deleteWebhook: async () => ({ ok: true }),
    };
  }

  /** Listen for `answerCallbackQuery` calls (useful for testing A2H flows). */
  onCallbackAnswered(listener: (queryId: string, text?: string) => void): () => void {
    this.callbackListeners.push(listener);
    return () => {
      const idx = this.callbackListeners.indexOf(listener);
      if (idx !== -1) this.callbackListeners.splice(idx, 1);
    };
  }
}

// ---------------------------------------------------------------------------
// Generic (HTTP webhook) mock server
// ---------------------------------------------------------------------------

export interface MockWebhookRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: Date;
}

export interface MockWebhookResponse {
  status: number;
  body?: unknown;
}

/**
 * Mock HTTP webhook server.
 *
 * Records all "sent" webhook requests and allows tests to inspect them.
 * Used to simulate the recipient's endpoint that receives OpenThreads envelopes.
 *
 * Replace the real `fetch` in tests via the `interceptFetch` helper.
 */
export class MockWebhookServer {
  private readonly _requests: MockWebhookRequest[] = [];
  private responseMap = new Map<string, MockWebhookResponse>();

  /** All recorded webhook requests (oldest first). */
  get requests(): ReadonlyArray<MockWebhookRequest> {
    return this._requests;
  }

  /** The most recent request, or `undefined` if none. */
  get lastRequest(): MockWebhookRequest | undefined {
    return this._requests[this._requests.length - 1];
  }

  /** Clear all recorded requests. */
  clear(): void {
    this._requests.length = 0;
  }

  /**
   * Configure a response to return for requests matching the given URL prefix.
   * Default response is `{ status: 200 }`.
   */
  setResponse(urlPrefix: string, response: MockWebhookResponse): void {
    this.responseMap.set(urlPrefix, response);
  }

  /**
   * Returns a `fetch`-compatible mock function that records calls and
   * returns configured responses.
   *
   * Inject this as a replacement for `globalThis.fetch` in your test setup.
   */
  createFetchMock(): typeof fetch {
    const server = this;

    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      let body: unknown;
      try {
        body = init?.body ? JSON.parse(init.body as string) : undefined;
      } catch {
        body = init?.body;
      }

      server._requests.push({
        url,
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
        body,
        receivedAt: new Date(),
      });

      // Find the best matching response.
      let response: MockWebhookResponse = { status: 200 };
      for (const [prefix, res] of server.responseMap) {
        if (url.startsWith(prefix)) {
          response = res;
          break;
        }
      }

      const responseBody = response.body !== undefined ? JSON.stringify(response.body) : '{}';
      return new Response(responseBody, { status: response.status });
    };
  }
}
