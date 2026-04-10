/**
 * @openthreads/core
 *
 * Core abstractions for token management, thread lifecycle, and turn tracking.
 */

// Types and interfaces
export type {
  StorageAdapter,
  TokenRecord,
  ChannelApiKeyRecord,
  TokenValidationResult,
  ChannelApiKeyValidationResult,
  ThreadRecord,
  ThreadKind,
  CreateThreadOptions,
  CreateVirtualThreadOptions,
  TurnRecord,
  TurnDirection,
  CreateTurnOptions,
} from './types/index.js';

// ID utilities
export {
  generateTokenId,
  generateChannelApiKeyId,
  generateThreadId,
  generateTurnId,
} from './utils/id.js';

// Storage
export { InMemoryStorageAdapter } from './storage/in-memory.js';

// Token management
export { TokenManager, DEFAULT_TOKEN_TTL_MS } from './token/index.js';
export type { TokenManagerOptions, GenerateEphemeralTokenOptions } from './token/index.js';

// Thread management
export { ThreadManager } from './thread/index.js';
export type { ThreadManagerOptions } from './thread/index.js';

// Turn management
export { TurnManager } from './turn/index.js';
export type { TurnManagerOptions } from './turn/index.js';
