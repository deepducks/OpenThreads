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
export type { A2HMessage, A2HIntent, A2HContext } from './types/a2h.js';

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
