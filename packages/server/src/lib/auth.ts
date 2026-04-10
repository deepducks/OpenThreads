/**
 * Authentication middleware helpers for OpenThreads server.
 *
 * Three auth mechanisms:
 * 1. Ephemeral token — `?token=ot_tk_...` for single-use reply tokens
 * 2. Channel API key — `Authorization: Bearer ot_ch_sk_...` for channel access
 * 3. Management API key — `Authorization: Bearer <key>` for admin CRUD
 */

import type { NextRequest } from 'next/server';
import { getChannelByApiKey, getValidToken } from './db';
import type { Channel } from '@openthreads/core';
import type { TokenDoc } from './db';

// ─── Ephemeral token auth ─────────────────────────────────────────────────────

export interface TokenAuthResult {
  valid: true;
  token: TokenDoc;
  channelId: string;
  threadId: string;
}

export interface TokenAuthFailure {
  valid: false;
  reason: 'missing_token' | 'invalid_or_expired' | 'channel_mismatch' | 'thread_mismatch';
}

export type EphemeralTokenResult = TokenAuthResult | TokenAuthFailure;

/**
 * Validate the `?token=` query parameter from an inbound send request.
 *
 * Optionally checks that the token is scoped to the given channelId / threadId.
 */
export async function verifyEphemeralToken(
  request: NextRequest,
  options: { channelId?: string; threadId?: string } = {},
): Promise<EphemeralTokenResult> {
  const value = request.nextUrl.searchParams.get('token');
  if (!value) {
    return { valid: false, reason: 'missing_token' };
  }

  const token = await getValidToken(value);
  if (!token) {
    return { valid: false, reason: 'invalid_or_expired' };
  }

  if (options.channelId && token.channelId !== options.channelId) {
    return { valid: false, reason: 'channel_mismatch' };
  }

  if (options.threadId && token.threadId !== options.threadId) {
    return { valid: false, reason: 'thread_mismatch' };
  }

  return { valid: true, token, channelId: token.channelId, threadId: token.threadId };
}

// ─── Channel API key auth ─────────────────────────────────────────────────────

export interface ApiKeyAuthResult {
  valid: true;
  channel: Channel;
}

export interface ApiKeyAuthFailure {
  valid: false;
  reason: 'missing_auth' | 'invalid_key' | 'channel_mismatch';
}

export type ChannelApiKeyResult = ApiKeyAuthResult | ApiKeyAuthFailure;

/**
 * Validate the `Authorization: Bearer` header as a channel API key.
 *
 * Optionally checks that the key belongs to the specified channelId.
 */
export async function verifyChannelApiKey(
  request: NextRequest,
  options: { channelId?: string } = {},
): Promise<ChannelApiKeyResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, reason: 'missing_auth' };
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    return { valid: false, reason: 'missing_auth' };
  }

  const channel = await getChannelByApiKey(apiKey);
  if (!channel) {
    return { valid: false, reason: 'invalid_key' };
  }

  if (options.channelId && channel.id !== options.channelId) {
    return { valid: false, reason: 'channel_mismatch' };
  }

  return { valid: true, channel };
}

// ─── Send endpoint combined auth ──────────────────────────────────────────────

export interface SendAuthResult {
  valid: true;
  channelId: string;
  targetId?: string;
  threadId?: string;
  /** 'token' if authenticated via ephemeral token, 'apikey' if via channel API key */
  method: 'token' | 'apikey';
}

export interface SendAuthFailure {
  valid: false;
  status: 401;
  error: string;
}

export type SendAuthCheck = SendAuthResult | SendAuthFailure;

/**
 * Check either ephemeral token OR channel API key auth for send endpoints.
 * Token is tried first (cheapest), then API key.
 */
export async function verifySendAuth(
  request: NextRequest,
  channelId: string,
  threadId?: string,
): Promise<SendAuthCheck> {
  // Try ephemeral token first
  const tokenResult = await verifyEphemeralToken(request, { channelId, threadId });
  if (tokenResult.valid) {
    return {
      valid: true,
      channelId: tokenResult.channelId,
      threadId: tokenResult.threadId,
      method: 'token',
    };
  }

  // Fall back to channel API key
  const apiKeyResult = await verifyChannelApiKey(request, { channelId });
  if (apiKeyResult.valid) {
    return {
      valid: true,
      channelId: apiKeyResult.channel.id,
      method: 'apikey',
    };
  }

  return {
    valid: false,
    status: 401,
    error: 'Unauthorized: provide a valid ?token= or Authorization: Bearer header',
  };
}

// ─── Management API auth ──────────────────────────────────────────────────────

export interface ManagementAuthResult {
  valid: true;
}

export interface ManagementAuthFailure {
  valid: false;
  reason: 'missing_auth' | 'invalid_key' | 'not_configured';
}

export type ManagementAuthCheck = ManagementAuthResult | ManagementAuthFailure;

/**
 * Validate management API key from `Authorization: Bearer` header.
 *
 * If `MANAGEMENT_API_KEY` env var is not set, all requests are rejected unless
 * running in development mode (where auth is bypassed for convenience).
 */
export function verifyManagementAuth(request: NextRequest): ManagementAuthCheck {
  const configuredKey = process.env.MANAGEMENT_API_KEY;

  // In development without a configured key, allow all management requests.
  if (!configuredKey) {
    if (process.env.NODE_ENV === 'development') {
      return { valid: true };
    }
    return { valid: false, reason: 'not_configured' };
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, reason: 'missing_auth' };
  }

  const key = authHeader.slice(7).trim();
  if (key !== configuredKey) {
    return { valid: false, reason: 'invalid_key' };
  }

  return { valid: true };
}
