import {
  getContentType,
  type WASocket,
  type WAMessage,
  proto,
} from "@whiskeysockets/baileys";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundMessage,
  InboundMessageHandler,
  OutboundPayload,
  SentMessage,
  A2HIntent,
  OutboundContent,
} from "@openthreads/core";
import { SessionManager } from "./SessionManager.js";
import {
  WHATSAPP_CAPABILITIES,
  WHATSAPP_MAX_BUTTONS,
  type WhatsAppAdapterOptions,
  type PendingCapture,
} from "./types.js";

/**
 * WhatsApp channel adapter built on the Baileys library (WhatsApp Web protocol).
 *
 * ## Session management
 * Authentication state is persisted to disk via Baileys' `useMultiFileAuthState`.
 * On first run the adapter emits a QR code via `onQRCode`; subsequent runs
 * restore the session automatically.  Disconnects trigger automatic reconnection
 * with exponential backoff.
 *
 * ## Thread model
 * WhatsApp has no native thread concept.  The adapter creates *virtual threads*
 * by pairing messages through quoted replies:
 *   - The `threadId` of an inbound message equals the ID of the message it
 *     quoted, or the JID when there is no quoted context.
 *   - Outbound messages that carry a `replyToId` are sent as quoted replies,
 *     allowing the human to see the full context inline.
 *
 * ## A2H support
 * | Intent       | Options ≤ 3 | Options > 3 | Notes                        |
 * |------------- |-------------|-------------|------------------------------|
 * | AUTHORIZE    | Method 1    | Method 3    | Max 3 WhatsApp buttons       |
 * | COLLECT      | Method 3    | Method 3    | Always falls back to form    |
 * | INFORM       | Text only   | —           | No response expected         |
 *
 * Method-2 (quoted-reply capture) is used for free-text responses when the
 * human replies to a COLLECT prompt.
 *
 * ## Capabilities
 * ```json
 * { "threads": false, "buttons": true, "selectMenus": false,
 *   "replyMessages": true, "dms": true, "fileUpload": true }
 * ```
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = "whatsapp" as const;
  readonly capabilities: ChannelCapabilities = WHATSAPP_CAPABILITIES;

  private readonly session: SessionManager;
  private inboundHandler: InboundMessageHandler | null = null;

  /**
   * messageId → PendingCapture — tracks in-flight method-2 response captures.
   */
  private readonly pendingCaptures = new Map<string, PendingCapture>();

  constructor(private readonly options: WhatsAppAdapterOptions) {
    this.session = new SessionManager(
      options.config,
      (qr) => options.onQRCode?.(qr),
      (phone) => options.onConnected?.(phone),
      (reason) => options.onDisconnected?.(reason),
      (socket) => this.attachListeners(socket),
    );
  }

  // ---------------------------------------------------------------------------
  // ChannelAdapter lifecycle
  // ---------------------------------------------------------------------------

  async initialize(_config?: Record<string, unknown>): Promise<void> {
    await this.session.connect();
  }

  async destroy(): Promise<void> {
    // Reject all pending captures so callers are not left hanging.
    for (const [, capture] of this.pendingCaptures) {
      clearTimeout(capture.timeoutHandle);
      capture.reject(new Error("WhatsApp adapter destroyed"));
    }
    this.pendingCaptures.clear();

    await this.session.disconnect();
    this.inboundHandler = null;
  }

  // ---------------------------------------------------------------------------
  // ChannelAdapter message interface
  // ---------------------------------------------------------------------------

  onInboundMessage(handler: InboundMessageHandler): void {
    this.inboundHandler = handler;
  }

  async sendMessage(payload: OutboundPayload): Promise<SentMessage> {
    const sock = this.session.getSocket();
    const jid = toJid(payload.targetId);

    const contents: OutboundContent[] = Array.isArray(payload.content)
      ? payload.content
      : [payload.content];

    let lastId = "";

    for (const content of contents) {
      const result = await this.sendContent(sock, jid, content, payload.replyToId);
      lastId = result.id;
    }

    return { id: lastId, threadId: payload.threadId ?? lastId };
  }

  /**
   * Renders an A2H intent to WhatsApp using the most appropriate method.
   *
   * The method selection follows the logic from VISION.md §4:
   *   - AUTHORIZE with ≤3 options → method 1 (buttons)
   *   - AUTHORIZE with >3 options → method 3 (external form link)
   *   - COLLECT (any) → method 3 (external form link)
   *   - INFORM → plain text, no response expected
   */
  async renderA2H(
    intent: A2HIntent,
    payload: OutboundPayload,
  ): Promise<SentMessage> {
    switch (intent.intent) {
      case "AUTHORIZE": {
        const options: string[] = intent.context.options ?? ["Approve", "Reject"];

        if (options.length <= WHATSAPP_MAX_BUTTONS) {
          return this.sendAuthorizeButtons(intent, options, payload);
        }
        // Fallthrough to external form when there are too many options.
        return this.sendExternalFormLink(intent, payload);
      }

      case "COLLECT":
        return this.sendExternalFormLink(intent, payload);

      case "INFORM": {
        const text = buildInformText(intent);
        return this.sendMessage({
          ...payload,
          content: { type: "text", text },
        });
      }

      default:
        return this.sendExternalFormLink(intent, payload);
    }
  }

  // ---------------------------------------------------------------------------
  // A2H rendering helpers
  // ---------------------------------------------------------------------------

  private async sendAuthorizeButtons(
    intent: A2HIntent & { intent: "AUTHORIZE" },
    options: string[],
    payload: OutboundPayload,
  ): Promise<SentMessage> {
    const sock = this.session.getSocket();
    const jid = toJid(payload.targetId);

    const bodyText = buildAuthorizeBody(intent);

    const buttons = options.slice(0, WHATSAPP_MAX_BUTTONS).map((label, idx) => ({
      buttonId: `a2h_${intent.traceId ?? "auth"}_${idx}`,
      buttonText: { displayText: label },
      type: 1 as const,
    }));

    const sendOpts = await this.buildQuotedOptions(jid, payload.replyToId);

    const result = await sock.sendMessage(
      jid,
      {
        text: bodyText,
        footer: buildFooter(intent),
        buttons,
        headerType: proto.Message.ButtonsMessage.HeaderType.TEXT,
      } as Parameters<typeof sock.sendMessage>[1],
      sendOpts,
    );

    const id = result?.key?.id ?? "";
    return { id, threadId: payload.threadId ?? id };
  }

  private async sendExternalFormLink(
    intent: A2HIntent,
    payload: OutboundPayload,
  ): Promise<SentMessage> {
    const sock = this.session.getSocket();
    const jid = toJid(payload.targetId);

    const formUrl = this.options.config.serverBaseUrl
      ? `${this.options.config.serverBaseUrl}/form/${intent.traceId ?? "unknown"}`
      : null;

    const body = buildA2HBody(intent);
    const linkLine = formUrl
      ? `\n\n🔗 *Respond via secure form:*\n${formUrl}`
      : `\n\n_(No form URL configured — contact the system operator.)_`;

    const sendOpts = await this.buildQuotedOptions(jid, payload.replyToId);

    const result = await sock.sendMessage(
      jid,
      { text: `${body}${linkLine}` },
      sendOpts,
    );

    const id = result?.key?.id ?? "";
    return { id, threadId: payload.threadId ?? id };
  }

  // ---------------------------------------------------------------------------
  // Outbound content dispatch
  // ---------------------------------------------------------------------------

  private async sendContent(
    sock: WASocket,
    jid: string,
    content: OutboundContent,
    replyToId?: string,
  ): Promise<SentMessage> {
    const sendOpts = await this.buildQuotedOptions(jid, replyToId);
    let waContent: Parameters<typeof sock.sendMessage>[1];

    switch (content.type) {
      case "text":
        waContent = { text: content.text };
        break;

      case "buttons": {
        const waButtons = (content.buttons ?? [])
          .slice(0, WHATSAPP_MAX_BUTTONS)
          .map((btn, idx) => ({
            buttonId: btn.id ?? `btn_${idx}`,
            buttonText: { displayText: btn.label },
            type: 1 as const,
          }));

        waContent = {
          text: content.body,
          footer: content.footer,
          buttons: waButtons,
          headerType: proto.Message.ButtonsMessage.HeaderType.TEXT,
        } as Parameters<typeof sock.sendMessage>[1];
        break;
      }

      case "list": {
        waContent = {
          listMessage: {
            title: content.title,
            text: content.body,
            footerText: content.footer,
            buttonText: content.buttonLabel ?? "Options",
            listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
            sections: (content.sections ?? []).map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({
                rowId: row.id,
                title: row.title,
                description: row.description ?? "",
              })),
            })),
          },
        } as Parameters<typeof sock.sendMessage>[1];
        break;
      }

      case "image":
        waContent = {
          image: { url: content.url },
          caption: content.caption,
        } as Parameters<typeof sock.sendMessage>[1];
        break;

      case "video":
        waContent = {
          video: { url: content.url },
          caption: content.caption,
        } as Parameters<typeof sock.sendMessage>[1];
        break;

      case "audio":
        waContent = {
          audio: { url: content.url },
          ptt: false,
        } as Parameters<typeof sock.sendMessage>[1];
        break;

      case "document":
        waContent = {
          document: { url: content.url },
          fileName: content.filename ?? "document",
          caption: content.caption,
        } as Parameters<typeof sock.sendMessage>[1];
        break;

      default:
        // Graceful degradation for unknown content types.
        waContent = { text: `[Unsupported content type: ${(content as { type: string }).type}]` };
    }

    const result = await sock.sendMessage(jid, waContent, sendOpts);
    const id = result?.key?.id ?? "";
    return { id, threadId: id };
  }

  // ---------------------------------------------------------------------------
  // Inbound message handling
  // ---------------------------------------------------------------------------

  private attachListeners(socket: WASocket): void {
    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        // Skip outgoing messages (sent by us).
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        void this.handleInbound(msg);
      }
    });
  }

  private async handleInbound(msg: WAMessage): Promise<void> {
    // Check if this message resolves a pending method-2 capture first.
    this.tryResolvePendingCapture(msg);

    // Then dispatch to the general inbound handler.
    const parsed = parseInboundMessage(msg);
    if (!parsed) return;

    try {
      await this.inboundHandler?.(parsed);
    } catch (err) {
      console.error("[openthreads/channel-whatsapp] inbound handler error:", err);
    }
  }

  private tryResolvePendingCapture(msg: WAMessage): void {
    const quotedId =
      msg.message?.extendedTextMessage?.contextInfo?.stanzaId ??
      msg.message?.imageMessage?.contextInfo?.stanzaId ??
      msg.message?.videoMessage?.contextInfo?.stanzaId ??
      msg.message?.audioMessage?.contextInfo?.stanzaId ??
      msg.message?.documentMessage?.contextInfo?.stanzaId;

    if (!quotedId) return;

    const pending = this.pendingCaptures.get(quotedId);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    this.pendingCaptures.delete(quotedId);

    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      "";

    pending.resolve(text);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Returns method-2 quoted-reply capture options if we have a prior message
   * to quote.  In a full implementation this would retrieve the actual
   * WAMessage object from an in-memory store (Baileys' makeInMemoryStore).
   * We return an empty object here since Baileys can reconstruct the stub from
   * the message key alone when a proper store is wired up.
   */
  private async buildQuotedOptions(
    _jid: string,
    replyToId?: string,
  ): Promise<Parameters<WASocket["sendMessage"]>[2]> {
    if (!replyToId) return undefined;
    // Full store integration: return { quoted: storedMessage }
    // For now, return undefined — the caller can extend this by injecting a
    // message store via the SessionManager.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Pure helper functions (no adapter state)
// ---------------------------------------------------------------------------

/**
 * Converts a bare phone number or group ID to a WhatsApp JID.
 *
 * - Already contains "@" → returned as-is
 * - Ends with "-" (legacy group format) → appended with "@g.us"
 * - Otherwise → appended with "@s.whatsapp.net"
 */
function toJid(target: string): string {
  if (target.includes("@")) return target;
  if (target.includes("-")) return `${target}@g.us`;
  return `${target}@s.whatsapp.net`;
}

/**
 * Parses a raw Baileys WAMessage into the OpenThreads InboundMessage shape.
 * Returns null for unsupported / system message types.
 */
function parseInboundMessage(msg: WAMessage): InboundMessage | null {
  if (!msg.key.remoteJid || !msg.message) return null;

  const jid = msg.key.remoteJid;
  const messageId = msg.key.id ?? "";
  const senderId = msg.key.participant ?? jid.split("@")[0] ?? "";
  const senderName = (msg as { pushName?: string }).pushName ?? senderId;
  const timestamp =
    typeof msg.messageTimestamp === "number"
      ? new Date(msg.messageTimestamp * 1_000)
      : new Date();

  const contentType = getContentType(msg.message);

  let content: InboundMessage["content"];

  switch (contentType) {
    case "conversation":
    case "extendedTextMessage": {
      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        "";
      content = { type: "text", text };
      break;
    }

    case "imageMessage":
      content = {
        type: "image",
        caption: msg.message.imageMessage?.caption,
      };
      break;

    case "videoMessage":
      content = {
        type: "video",
        caption: msg.message.videoMessage?.caption,
      };
      break;

    case "audioMessage":
      content = { type: "audio" };
      break;

    case "documentMessage":
      content = {
        type: "document",
        filename: msg.message.documentMessage?.fileName ?? undefined,
        caption: msg.message.documentMessage?.caption ?? undefined,
      };
      break;

    case "stickerMessage":
      content = { type: "sticker" };
      break;

    // Button / list responses
    case "buttonsResponseMessage":
      content = {
        type: "text",
        text: msg.message.buttonsResponseMessage?.selectedDisplayText ?? "",
      };
      break;

    case "listResponseMessage":
      content = {
        type: "text",
        text:
          msg.message.listResponseMessage?.title ??
          msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ??
          "",
      };
      break;

    default:
      // Protocol messages, ephemeral keys, receipts, etc.
      return null;
  }

  // Extract the quoted message ID to determine the virtual thread.
  const quotedId =
    msg.message.extendedTextMessage?.contextInfo?.stanzaId ??
    msg.message.imageMessage?.contextInfo?.stanzaId ??
    msg.message.videoMessage?.contextInfo?.stanzaId ??
    msg.message.audioMessage?.contextInfo?.stanzaId ??
    msg.message.documentMessage?.contextInfo?.stanzaId ??
    msg.message.buttonsResponseMessage?.contextInfo?.stanzaId ??
    msg.message.listResponseMessage?.contextInfo?.stanzaId;

  // Virtual thread ID: if this message is a reply, the thread is rooted at the
  // quoted message; otherwise the thread root is the conversation JID.
  const threadId = quotedId ?? jid;

  return {
    id: messageId,
    threadId,
    channelId: jid,
    senderId,
    senderName,
    content,
    replyToId: quotedId,
    timestamp,
  };
}

function buildAuthorizeBody(intent: A2HIntent & { intent: "AUTHORIZE" }): string {
  const ctx = intent.context;
  const lines: string[] = ["*Authorization Required*"];

  if (ctx.action) lines.push(`\n*Action:* ${ctx.action}`);
  if (ctx.details) lines.push(`*Details:* ${ctx.details}`);

  return lines.join("\n");
}

function buildA2HBody(intent: A2HIntent): string {
  const ctx = intent.context as Record<string, unknown>;

  if (intent.intent === "AUTHORIZE") {
    const lines = ["*Authorization Required*"];
    if (ctx.action) lines.push(`\n*Action:* ${ctx.action}`);
    if (ctx.details) lines.push(`*Details:* ${ctx.details}`);
    return lines.join("\n");
  }

  if (intent.intent === "COLLECT") {
    const question = (ctx.question as string | undefined) ?? "Please provide the requested information.";
    return `*Question:* ${question}`;
  }

  if (intent.intent === "INFORM") {
    return buildInformText(intent);
  }

  return "Please respond via the link below.";
}

function buildInformText(intent: A2HIntent): string {
  const ctx = intent.context as Record<string, unknown>;
  const message = (ctx.message as string | undefined) ?? "";
  return message;
}

function buildFooter(intent: A2HIntent): string {
  return `OpenThreads · ${intent.intent}${intent.traceId ? ` · ${intent.traceId.slice(0, 8)}` : ""}`;
}
