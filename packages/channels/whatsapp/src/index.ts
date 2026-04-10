/**
 * @openthreads/channel-whatsapp
 *
 * WhatsApp channel adapter for OpenThreads, built on the Baileys library
 * (WhatsApp Web protocol).
 *
 * ## Quick start
 *
 * ```ts
 * import { WhatsAppAdapter } from "@openthreads/channel-whatsapp";
 *
 * const adapter = new WhatsAppAdapter({
 *   config: {
 *     sessionDir: "./whatsapp-session",
 *     serverBaseUrl: "https://openthreads.example.com",
 *   },
 *   onQRCode: (qr) => {
 *     // Render QR code in terminal, save as image, or surface in the UI.
 *     console.log("Scan QR:", qr);
 *   },
 *   onConnected: (phone) => console.log("WhatsApp connected:", phone),
 *   onDisconnected: (reason) => console.warn("WhatsApp disconnected:", reason),
 * });
 *
 * await adapter.initialize();
 *
 * adapter.onInboundMessage(async (msg) => {
 *   console.log("Received:", msg);
 * });
 *
 * // Send a text message
 * await adapter.sendMessage({
 *   targetId: "15551234567",
 *   content: { type: "text", text: "Hello from OpenThreads!" },
 * });
 *
 * // Render an A2H AUTHORIZE intent as WhatsApp buttons (≤3 options)
 * await adapter.renderA2H(
 *   {
 *     intent: "AUTHORIZE",
 *     context: { action: "deploy-to-production", options: ["Approve", "Reject"] },
 *     traceId: "ot_trace_abc123",
 *   },
 *   { targetId: "15551234567" },
 * );
 * ```
 */

export { WhatsAppAdapter } from "./WhatsAppAdapter.js";
export { SessionManager } from "./SessionManager.js";
export {
  WHATSAPP_CAPABILITIES,
  WHATSAPP_MAX_BUTTONS,
} from "./types.js";
export type {
  WhatsAppConfig,
  WhatsAppAdapterOptions,
  PendingCapture,
} from "./types.js";
