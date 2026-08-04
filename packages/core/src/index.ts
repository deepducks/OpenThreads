/**
 * @openthreads/core
 *
 * Core abstractions for OpenThreads.
 */

// ---- Data Model Types ----
export type { Channel, CreateChannelInput, Platform } from './types/channel.js';
export type { Recipient, CreateRecipientInput } from './types/recipient.js';
export type { Thread, CreateThreadInput } from './types/thread.js';
export type { Turn, CreateTurnInput, TurnDirection } from './types/turn.js';
export type { Route, CreateRouteInput, RouteCriteria } from './types/route.js';
export type {
  Envelope,
  EnvelopeSource,
  Token,
} from './types/envelope.js';

// ---- A2H Protocol Types ----
export type {
  A2HMessage,
  A2HIntent,
  A2HContext,
  // Layer 1 (implemented)
  A2HLayer1Intent,
  // Layer 2 stubs — pending twilio-labs/a2h-spec stabilisation
  A2HLayer2Intent,
  A2HPolicyIntent,
  A2HRevokeIntent,
  A2HDelegateIntent,
  A2HScopeIntent,
} from './types/a2h.js';
export { isLayer1Intent, isLayer2Intent } from './types/a2h.js';

// ---- Message Union Types ----
export type {
  ChatSDKMessage,
  Attachment,
  OpenThreadsMessage,
  EnvelopeMessage,
} from './types/message.js';

// ---- Storage Interface ----
export type {
  StorageAdapter,
  StorageAdapterFactory,
  CrudOperations,
  ThreadOperations,
  TurnOperations,
  RouteOperations,
  TokenOperations,
  CreateTokenInput,
} from './interfaces/storage-adapter.js';

// ---- Channel Adapter Interface ----
export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelConfig,
  RenderedMessage,
} from './interfaces/channel-adapter.js';

// ---- ID Generation Utilities ----
export {
  generateThreadId,
  generateTurnId,
  generateTokenId,
  generateChannelSecretKey,
  isThreadId,
  isTurnId,
  isTokenId,
  isChannelSecretKey,
  ID_PREFIXES,
} from './utils/id-generator.js';

// ---- Message Classification Utilities ----
export {
  isA2HMessage,
  isChatSDKMessage,
  classifyMessages,
  normaliseToArray,
  hasA2HMessages,
  hasChatSDKMessages,
} from './utils/message-classifier.js';

// ---- Token Management (Issue #5) ----
export type {
  TokenRecord,
  ChannelApiKeyRecord,
  TokenValidationResult,
  ChannelApiKeyValidationResult,
  ThreadRecord,
  ThreadKind,
  CreateThreadOptions,
  CreateVirtualThreadOptions,
  TurnRecord,
  CreateTurnOptions,
} from './types/index.js';

export {
  generateTokenId as generateEphemeralTokenId,
  generateChannelApiKeyId,
} from './utils/id.js';

export { InMemoryStorageAdapter } from './storage/in-memory.js';

export { TokenManager, DEFAULT_TOKEN_TTL_MS } from './token/index.js';
export type { TokenManagerOptions, GenerateEphemeralTokenOptions } from './token/index.js';

export { ThreadManager } from './thread/index.js';
export type { ThreadManagerOptions } from './thread/index.js';

export { TurnManager } from './turn/index.js';
export type { TurnManagerOptions } from './turn/index.js';

// ---- Reply Engine Extension Point ----
export {
  intentHandlerRegistry,
  IntentHandlerRegistry,
} from './reply-engine/intent-handler.js';
export type {
  IntentHandlerFn,
  IntentHandlerContext,
  IntentHandlerResponse,
} from './reply-engine/intent-handler.js';
