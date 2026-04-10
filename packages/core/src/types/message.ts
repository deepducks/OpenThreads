import type { A2HMessage } from './a2h.js';

/**
 * A Chat SDK message (Vercel Chat SDK compatible format).
 * Used for conventional text/media messages — does NOT contain an `intent` field.
 *
 * Compatible with the Vercel Chat SDK `Message` shape and the envelope examples
 * in VISION.md: `{ "text": "...", "attachments": [] }`.
 */
export interface ChatSDKMessage {
  /** Plain text or markdown content */
  text?: string;
  /** File or media attachments */
  attachments?: Attachment[];
  /** Arbitrary additional properties for platform-specific extensions */
  [key: string]: unknown;
}

export interface Attachment {
  /** MIME type of the attachment */
  contentType?: string;
  /** Public URL to the attachment */
  url?: string;
  /** Filename for display */
  name?: string;
  /** Inline content (base64 or raw bytes) */
  content?: string;
}

/**
 * Union of all message types that can appear in an OpenThreads envelope.
 *
 * Duck-typing discriminator:
 * - Presence of `intent` field → A2H message
 * - Absence of `intent` field → Chat SDK message
 */
export type OpenThreadsMessage = ChatSDKMessage | A2HMessage;

/**
 * The `message` field in an envelope accepts a single message or an array.
 * When an array, items are processed sequentially by the Reply Engine.
 */
export type EnvelopeMessage = OpenThreadsMessage | OpenThreadsMessage[];
