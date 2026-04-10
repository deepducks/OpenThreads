/**
 * @openthreads/channels-whatsapp
 *
 * WhatsApp channel adapter for OpenThreads using Baileys (WhatsApp Web protocol).
 *
 * @example
 * ```ts
 * import { WhatsAppAdapter } from '@openthreads/channels-whatsapp';
 *
 * const adapter = new WhatsAppAdapter({
 *   sessionDir: './whatsapp-session',
 *   baseUrl: 'https://openthreads.mycompany.com',
 *   qrCallback: (qr) => {
 *     // render the QR code however you like
 *     console.log('Scan this QR with WhatsApp:', qr);
 *   },
 * });
 *
 * // Register handler for inbound messages
 * adapter.onMessage(async (envelope) => {
 *   console.log('Received:', envelope.message);
 * });
 *
 * // Connect (will trigger QR flow on first run)
 * await adapter.initialize();
 *
 * // Send a message
 * await adapter.send({
 *   channelId: '1234567890@s.whatsapp.net',
 *   targetId: '1234567890@s.whatsapp.net',
 *   message: { text: 'Hello from OpenThreads!' },
 * });
 *
 * // A2H — request human approval
 * const response = await adapter.sendA2H(
 *   '1234567890@s.whatsapp.net',
 *   undefined,
 *   {
 *     intent: 'AUTHORIZE',
 *     id: 'deploy-001',
 *     context: { action: 'Deploy to production', details: 'Branch: main' },
 *   },
 * );
 * console.log('Approved:', response.approved);
 * ```
 */

export { WhatsAppAdapter } from './WhatsAppAdapter.js';
export type { WhatsAppAdapterConfig, WhatsAppAdapterDeps } from './types.js';
export { WHATSAPP_CAPABILITIES } from './types.js';
export type {
  ChannelCapabilities,
  MessageHandler,
  InboundEnvelope,
  OutboundEnvelope,
  SendResult,
  A2HInformIntent,
  A2HAuthorizeIntent,
  A2HCollectIntent,
  A2HIntent,
  A2HResponse,
  A2HSendOptions,
  MessageItem,
  MockableSocket,
} from './types.js';
export { SessionManager } from './SessionManager.js';
export type { SessionManagerOptions } from './SessionManager.js';
