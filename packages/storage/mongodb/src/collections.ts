/**
 * MongoDB document shapes and conversion helpers.
 *
 * MongoDB uses `_id` (ObjectId or string) as the primary key.
 * We store the domain IDs (channelId, threadId, etc.) as plain string fields
 * and use a separate `_id: ObjectId` so we can keep natural-language primary
 * keys without giving up the default ObjectId index.
 */

import { ObjectId } from 'mongodb';
import type {
  Channel,
  Recipient,
  Thread,
  Turn,
  Route,
  Token,
} from '@openthreads/core';

// ---------------------------------------------------------------------------
// Document types (what's stored in MongoDB)
// ---------------------------------------------------------------------------

export interface ChannelDoc {
  _id: ObjectId;
  channelId: string;
  platform: string;
  name: string;
  apiKey: string;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipientDoc {
  _id: ObjectId;
  recipientId: string;
  name: string;
  webhookUrl: string;
  webhookSecret?: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadDoc {
  _id: ObjectId;
  threadId: string;
  channelId: string;
  nativeThreadId?: string;
  targetId: string;
  isMain: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TurnDoc {
  _id: ObjectId;
  turnId: string;
  threadId: string;
  inboundMessage: unknown;
  source: {
    channelId: string;
    sender: { id: string; name: string };
    nativeMessageId?: string;
  };
  replyTo: string;
  outboundResponse?: unknown;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteDoc {
  _id: ObjectId;
  routeId: string;
  recipientId: string;
  criteria: {
    channelId?: string;
    targetId?: string;
    isDM?: boolean;
    mentionOnly?: boolean;
    senderId?: string;
    contentPattern?: string;
    threadId?: string;
  };
  active: boolean;
  priority: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenDoc {
  _id: ObjectId;
  tokenId: string;
  value: string;
  channelId: string;
  threadId: string;
  turnId?: string;
  expiresAt: Date;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Document → Domain type converters
// ---------------------------------------------------------------------------

export function channelFromDoc(doc: ChannelDoc): Channel {
  return {
    channelId: doc.channelId,
    platform: doc.platform,
    name: doc.name,
    apiKey: doc.apiKey,
    config: doc.config,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function recipientFromDoc(doc: RecipientDoc): Recipient {
  return {
    recipientId: doc.recipientId,
    name: doc.name,
    webhookUrl: doc.webhookUrl,
    webhookSecret: doc.webhookSecret,
    active: doc.active,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function threadFromDoc(doc: ThreadDoc): Thread {
  return {
    threadId: doc.threadId,
    channelId: doc.channelId,
    nativeThreadId: doc.nativeThreadId,
    targetId: doc.targetId,
    isMain: doc.isMain,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function turnFromDoc(doc: TurnDoc): Turn {
  return {
    turnId: doc.turnId,
    threadId: doc.threadId,
    inboundMessage: doc.inboundMessage,
    source: doc.source,
    replyTo: doc.replyTo,
    outboundResponse: doc.outboundResponse,
    timestamp: doc.timestamp,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function routeFromDoc(doc: RouteDoc): Route {
  return {
    routeId: doc.routeId,
    recipientId: doc.recipientId,
    criteria: doc.criteria,
    active: doc.active,
    priority: doc.priority,
    description: doc.description,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function tokenFromDoc(doc: TokenDoc): Token {
  return {
    tokenId: doc.tokenId,
    value: doc.value,
    channelId: doc.channelId,
    threadId: doc.threadId,
    turnId: doc.turnId,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}
