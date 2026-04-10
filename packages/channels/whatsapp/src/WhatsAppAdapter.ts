/**
 * WhatsApp channel adapter for OpenThreads.
 *
 * Implements the full ChannelAdapter interface using Baileys (WhatsApp Web protocol).
 *
 * ### A2H delivery methods used
 *
 *   Method 1 (inline buttons)
 *     AUTHORIZE with ≤3 options → WhatsApp interactive quick-reply buttons
 *
 *   Method 2 (quoted reply capture)
 *     External form link messages: the adapter registers a quoted-reply listener
 *     so the human can respond by quoting the form-link message.
 *
 *   Method 3 (external form)
 *     AUTHORIZE with >3 options, COLLECT (any) → external form link
 *
 * ### Thread model
 *   WhatsApp has no native threads. OpenThreads creates virtual threads by
 *   tracking quoted-reply chains. The "threadId" for an inbound message is set
 *   to the root message ID in the reply chain (or the message's own ID when
 *   there is no parent).
 */

import { randomUUID } from 'crypto';
import { SessionManager } from './SessionManager.js';
import type {
  WhatsAppAdapterConfig,
  WhatsAppAdapterDeps,
  MockableSocket,
  ChannelCapabilities,
  MessageHandler,
  InboundEnvelope,
  OutboundEnvelope,
  SendResult,
  A2HInformIntent,
  A2HAuthorizeIntent,
  A2HCollectIntent,
  A2HResponse,
  A2HSendOptions,
  MessageItem,
  PendingCapture,
} from './types.js';
import { WHATSAPP_CAPABILITIES } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_FORM_BASE_URL = 'https://openthreads.host/form';
const MAX_INLINE_BUTTONS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTextItem(item: MessageItem): item is { text: string } {
  return !('intent' in item);
}

// ---------------------------------------------------------------------------
// WhatsAppAdapter
// ---------------------------------------------------------------------------

export class WhatsAppAdapter {
  readonly channelType = 'whatsapp';

  /**
   * WhatsApp capability flags.
   * - No native threads (virtual threads via quoted reply chains)
   * - Buttons: limited (≤3 quick-reply buttons)
   * - No select menus
   * - Reply messages (quoted replies): yes
   */
  readonly capabilities: ChannelCapabilities = WHATSAPP_CAPABILITIES;

  private sock?: MockableSocket;
  private sessionManager?: SessionManager;
  private messageHandler?: MessageHandler;

  /**
   * Pending A2H interactions.
   *
   * Keys:
   *   `intentId`         — for button interactions (method 1)
   *   `reply:<msgId>`    — for quoted-reply captures (method 2)
   */
  private readonly pending = new Map<string, PendingCapture>();

  constructor(
    private readonly config: WhatsAppAdapterConfig,
    private readonly deps: WhatsAppAdapterDeps = {},
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialise the adapter.
   *
   * When `deps.socket` is injected (test mode), the adapter uses it directly.
   * Otherwise a `SessionManager` handles the QR-code pairing flow and persistent
   * auth state, then returns a live Baileys WASocket.
   */
  async initialize(): Promise<void> {
    if (this.deps.socket) {
      // Test / injection path — skip the real Baileys connection
      this.sock = this.deps.socket;
      return;
    }

    // Production path — connect via Baileys
    const manager = new SessionManager({
      sessionDir: this.config.sessionDir,
      qrCallback: this.config.qrCallback,
      maxRetries: this.config.maxRetries,
    });

    manager.onMessage = (messages) => this.handleIncomingMessages(messages);

    this.sessionManager = manager;

    // The cast is safe: WASocket satisfies MockableSocket's shape
    this.sock = (await manager.connect()) as unknown as MockableSocket;
  }

  /** Gracefully close the WhatsApp connection. */
  async shutdown(): Promise<void> {
    if (this.sessionManager) {
      await this.sessionManager.disconnect();
    } else if (this.sock) {
      this.sock.end(undefined);
    }
    this.sock = undefined;
  }

  // ---------------------------------------------------------------------------
  // Message handler registration
  // ---------------------------------------------------------------------------

  /**
   * Register a handler that is called for every inbound message that is NOT
   * a response to a pending A2H interaction.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  /**
   * Send a conventional message or INFORM A2H item to a WhatsApp target.
   *
   * Blocking A2H intents (AUTHORIZE, COLLECT) must go through `sendA2H()`.
   */
  async send(envelope: OutboundEnvelope): Promise<SendResult> {
    const jid = envelope.channelId;
    const items: MessageItem[] = Array.isArray(envelope.message)
      ? envelope.message
      : [envelope.message];

    let lastMessageId: string | undefined;

    for (const item of items) {
      if (isTextItem(item)) {
        lastMessageId = await this.sendText(jid, item.text);
      } else if ('intent' in item && item.intent === 'INFORM') {
        lastMessageId = await this.sendText(jid, (item as A2HInformIntent).text);
      }
      // Blocking intents are handled by sendA2H()
    }

    return {
      messageId: lastMessageId ?? randomUUID(),
      threadId: envelope.threadId ?? lastMessageId,
    };
  }

  // ---------------------------------------------------------------------------
  // A2H
  // ---------------------------------------------------------------------------

  /**
   * Deliver an A2H intent to a WhatsApp target and return the human's response.
   *
   * Method selection:
   *   INFORM              → fire-and-forget text, returns immediately
   *   AUTHORIZE ≤3 opts   → method 1 (interactive quick-reply buttons)
   *   AUTHORIZE >3 opts   → method 3 (external form link + quoted-reply capture)
   *   COLLECT any         → method 3 (external form link + quoted-reply capture)
   */
  async sendA2H(
    channelId: string,
    _threadId: string | undefined,
    intent: A2HInformIntent | A2HAuthorizeIntent | A2HCollectIntent,
    options: A2HSendOptions = {},
  ): Promise<A2HResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const jid = channelId;

    switch (intent.intent) {
      case 'INFORM': {
        await this.sendText(jid, intent.text);
        return { intentId: intent.id, type: 'INFORM' };
      }

      case 'AUTHORIZE':
        return this.handleAuthorize(jid, intent, timeoutMs, options);

      case 'COLLECT':
        return this.handleCollect(jid, intent, timeoutMs, options);
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound message processing
  // ---------------------------------------------------------------------------

  /**
   * Entry point called by SessionManager for every batch of incoming messages.
   * Exposed as a public method so test doubles can inject synthetic messages.
   */
  async handleIncomingMessages(messages: unknown[]): Promise<void> {
    for (const msg of messages) {
      await this.dispatchMessage(msg);
    }
  }

  private async dispatchMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;
    const key = msg['key'] as Record<string, unknown> | undefined;
    const message = msg['message'] as Record<string, unknown> | undefined;

    if (!key || !message) return;
    if (key['fromMe']) return; // ignore messages sent by ourselves

    const jid = key['remoteJid'] as string;
    const messageId = key['id'] as string;

    // ── Button response — method 1 capture ──────────────────────────────────
    const buttonResponse = message['buttonsResponseMessage'] as
      | Record<string, unknown>
      | undefined;
    if (buttonResponse) {
      const buttonId = buttonResponse['selectedButtonId'] as string | undefined;
      if (buttonId) {
        const colonIdx = buttonId.lastIndexOf(':');
        if (colonIdx >= 0) {
          const intentId = buttonId.slice(0, colonIdx);
          const value = buttonId.slice(colonIdx + 1);
          const capture = this.pending.get(intentId);
          if (capture) {
            capture.resolver(value);
            this.pending.delete(intentId);
            return;
          }
        }
      }
    }

    // ── Quoted reply — method 2 capture ─────────────────────────────────────
    const contextInfo = this.extractContextInfo(message);
    if (contextInfo?.['stanzaId']) {
      const quotedId = contextInfo['stanzaId'] as string;
      const captureKey = `reply:${quotedId}`;
      const capture = this.pending.get(captureKey);
      if (capture) {
        const text = this.extractText(message);
        capture.resolver(text);
        this.pending.delete(captureKey);
        return;
      }
    }

    // ── Normal inbound message ───────────────────────────────────────────────
    if (!this.messageHandler) return;

    const text = this.extractText(message);
    if (!text) return;

    // Virtual thread: use the quoted-message ID as the thread root, or own ID
    const threadId = (contextInfo?.['stanzaId'] as string | undefined) ?? messageId;
    const pushName = (msg['pushName'] as string | undefined) ?? jid;
    const baseUrl = this.config.baseUrl ?? 'http://localhost:3001';

    const envelope: InboundEnvelope = {
      threadId,
      turnId: `ot_turn_${randomUUID()}`,
      replyTo: `${baseUrl}/send/channel/whatsapp/target/${encodeURIComponent(jid)}/thread/${encodeURIComponent(threadId)}`,
      source: {
        channel: 'whatsapp',
        channelId: jid,
        sender: { id: jid, name: pushName },
        raw: rawMsg,
      },
      message: [{ text }],
    };

    await this.messageHandler(envelope);
  }

  // ---------------------------------------------------------------------------
  // A2H handlers
  // ---------------------------------------------------------------------------

  private handleAuthorize(
    jid: string,
    intent: A2HAuthorizeIntent,
    timeoutMs: number,
    options: A2HSendOptions,
  ): Promise<A2HResponse> {
    const opts = intent.options ?? [];

    // Method 1: ≤ MAX_INLINE_BUTTONS options → WhatsApp interactive buttons
    if (opts.length === 0 || opts.length <= MAX_INLINE_BUTTONS) {
      return this.sendAuthorizeButtons(jid, intent, timeoutMs);
    }

    // Method 3: > MAX_INLINE_BUTTONS options → external form
    return this.sendFormLinkCapture(
      jid,
      intent.id,
      'AUTHORIZE',
      `${intent.context.action}${intent.context.details ? ` — ${intent.context.details}` : ''}`,
      timeoutMs,
      options,
    );
  }

  private sendAuthorizeButtons(
    jid: string,
    intent: A2HAuthorizeIntent,
    timeoutMs: number,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const opts = intent.options ?? [];

        const buttons =
          opts.length > 0
            ? opts.map((o) => ({
                buttonId: `${intent.id}:${o.value}`,
                buttonText: { displayText: o.label },
                type: 1,
              }))
            : [
                {
                  buttonId: `${intent.id}:approve`,
                  buttonText: { displayText: '✅ Approve' },
                  type: 1,
                },
                {
                  buttonId: `${intent.id}:deny`,
                  buttonText: { displayText: '❌ Deny' },
                  type: 1,
                },
              ];

        const bodyText =
          `🔐 *Authorization required*\n\n` +
          `*Action:* ${intent.context.action}` +
          (intent.context.details ? `\n*Details:* ${intent.context.details}` : '');

        const msgId = await this.sendButtonMessage(jid, bodyText, buttons);

        const timer = setTimeout(() => {
          this.pending.delete(intent.id);
          reject(new Error(`AUTHORIZE timeout for intent ${intent.id}`));
        }, timeoutMs);

        this.pending.set(intent.id, {
          jid,
          messageId: msgId,
          resolver: (value: string) => {
            clearTimeout(timer);
            resolve({
              intentId: intent.id,
              type: 'AUTHORIZE',
              approved: value === 'approve',
              response: value,
            });
          },
        });
      })().catch(reject);
    });
  }

  private handleCollect(
    jid: string,
    intent: A2HCollectIntent,
    timeoutMs: number,
    options: A2HSendOptions,
  ): Promise<A2HResponse> {
    // COLLECT always falls back to method 3 (external form) on WhatsApp
    // because there are no select menus and free-text capture via quoted reply
    // is unreliable for structured data.
    return this.sendFormLinkCapture(jid, intent.id, 'COLLECT', intent.question, timeoutMs, options);
  }

  /**
   * Method 3 + optional method 2 capture:
   *   1. Sends a message with the external form URL.
   *   2. Registers a quoted-reply listener for that message as a fallback,
   *      so the human can skip the form and reply directly.
   */
  private sendFormLinkCapture(
    jid: string,
    intentId: string,
    type: 'AUTHORIZE' | 'COLLECT',
    description: string,
    timeoutMs: number,
    options: A2HSendOptions,
  ): Promise<A2HResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const formBaseUrl = options.formBaseUrl ?? DEFAULT_FORM_BASE_URL;
        const formUrl = `${formBaseUrl}/${intentId}`;

        const text =
          `📋 *${description}*\n\n` +
          `Please respond via the secure form:\n${formUrl}\n\n` +
          `_You can also reply directly to this message._`;

        const msgId = await this.sendText(jid, text);

        // Register the quoted-reply capture key
        const captureKey = `reply:${msgId}`;

        const timer = setTimeout(() => {
          this.pending.delete(captureKey);
          this.pending.delete(intentId);
          reject(new Error(`${type} timeout for intent ${intentId}`));
        }, timeoutMs);

        const resolver = (value: string) => {
          clearTimeout(timer);
          this.pending.delete(captureKey);
          this.pending.delete(intentId);
          resolve({
            intentId,
            type,
            ...(type === 'AUTHORIZE'
              ? { approved: /^(approve|yes|y)$/i.test(value.trim()) }
              : {}),
            response: value,
          });
        };

        // Both keys point to the same resolver so either path resolves the promise
        this.pending.set(captureKey, { jid, messageId: msgId, resolver });
        this.pending.set(intentId, { jid, messageId: msgId, resolver });
      })().catch(reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Low-level send helpers
  // ---------------------------------------------------------------------------

  private async sendText(jid: string, text: string): Promise<string> {
    const sock = this.requireSocket();
    const result = await sock.sendMessage(jid, { text });
    return result?.key?.id ?? randomUUID();
  }

  private async sendButtonMessage(
    jid: string,
    text: string,
    buttons: Array<{ buttonId: string; buttonText: { displayText: string }; type: number }>,
  ): Promise<string> {
    const sock = this.requireSocket();
    const result = await sock.sendMessage(jid, {
      text,
      buttons,
      headerType: 1,
    });
    return result?.key?.id ?? randomUUID();
  }

  private requireSocket(): MockableSocket {
    if (!this.sock) {
      throw new Error('WhatsAppAdapter is not initialised. Call initialize() first.');
    }
    return this.sock;
  }

  // ---------------------------------------------------------------------------
  // Message parsing helpers
  // ---------------------------------------------------------------------------

  private extractContextInfo(
    message: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const sources = [
      message['extendedTextMessage'],
      message['imageMessage'],
      message['videoMessage'],
      message['audioMessage'],
      message['documentMessage'],
    ] as Array<Record<string, unknown> | undefined>;

    for (const src of sources) {
      if (src?.['contextInfo']) {
        return src['contextInfo'] as Record<string, unknown>;
      }
    }
    return undefined;
  }

  private extractText(message: Record<string, unknown>): string {
    if (typeof message['conversation'] === 'string') {
      return message['conversation'];
    }

    const ext = message['extendedTextMessage'] as Record<string, unknown> | undefined;
    if (typeof ext?.['text'] === 'string') return ext['text'];

    const img = message['imageMessage'] as Record<string, unknown> | undefined;
    if (typeof img?.['caption'] === 'string') return img['caption'];
    if (img) return '[image]';

    const vid = message['videoMessage'] as Record<string, unknown> | undefined;
    if (typeof vid?.['caption'] === 'string') return vid['caption'];
    if (vid) return '[video]';

    const doc = message['documentMessage'] as Record<string, unknown> | undefined;
    if (typeof doc?.['fileName'] === 'string') return `[document: ${doc['fileName']}]`;
    if (doc) return '[document]';

    if (message['audioMessage']) return '[voice message]';
    if (message['stickerMessage']) return '[sticker]';

    return '';
  }
}
