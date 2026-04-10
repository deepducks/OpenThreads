/**
 * POST /webhook/:channelId — Generic inbound webhook receiver.
 *
 * Receives events from external platforms (Slack, Telegram, Discord, etc.),
 * verifies platform signatures, normalizes the event, runs it through the
 * Router, and fans out to matched recipients.
 *
 * Platform-specific signature verification is selected based on channel type.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getChannel,
  getThreadByNativeId,
  createThread,
  createTurn,
  findMatchingRoutes,
  getRecipient,
  generateThreadId,
  generateTurnId,
} from '@/lib/db';
import { webhookRateLimit, getClientIp } from '@/lib/rate-limit';
import { fanOut } from '@/lib/fanout';
import type { Recipient } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ channelId: string }> };

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { channelId } = await context.params;

  // Rate limit per channel
  if (!webhookRateLimit(channelId)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Read raw body (needed for signature verification)
  const rawBody = await request.text();

  // Look up channel config
  let channel;
  try {
    channel = await getChannel(channelId);
  } catch (err) {
    console.error(`[webhook/${channelId}] db error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  // Platform-specific signature verification
  const sigVerified = await verifyWebhookSignature(request, channel.platform, rawBody, channel);
  if (!sigVerified) {
    console.warn(`[webhook/${channelId}] signature verification failed`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse the event body
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Handle Slack URL verification challenge
  if (channel.platform === 'slack' && event.type === 'url_verification') {
    return NextResponse.json({ challenge: event.challenge });
  }

  // Normalize the inbound event to an OpenThreads message
  const normalized = normalizeInboundEvent(channel.platform, event);
  if (!normalized) {
    // Acknowledge unknown event types without processing
    return NextResponse.json({ ok: true });
  }

  try {
    // Find or create a thread for this event
    const thread = await resolveThread(channelId, normalized);

    // Record the inbound turn
    const turn = await createTurn({
      turnId: generateTurnId(),
      threadId: thread.threadId,
      direction: 'inbound',
      message: normalized.message,
    });

    // Find matching routes and fan out to recipients
    const matchingRoutes = await findMatchingRoutes({
      channelId,
      isDm: normalized.isDm,
      isMention: normalized.isMention,
      senderId: normalized.senderId,
    });

    if (matchingRoutes.length === 0) {
      return NextResponse.json({ ok: true, routed: 0 });
    }

    // Resolve recipient objects
    const recipientIds = [...new Set(matchingRoutes.map((r) => r.recipientId))];
    const recipients: Recipient[] = [];
    for (const rid of recipientIds) {
      const recipient = await getRecipient(rid);
      if (recipient) recipients.push(recipient);
    }

    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, routed: 0 });
    }

    // Build the outbound envelope
    const baseUrl = process.env.OPENTHREADS_BASE_URL ?? `https://${request.headers.get('host')}`;
    const replyTo = `${baseUrl}/send/channel/${channelId}/target/${normalized.targetId}/thread/${thread.threadId}`;

    const envelope = {
      threadId: thread.threadId,
      turnId: turn.turnId,
      replyTo,
      source: {
        channel: channel.platform,
        channelId,
        sender: {
          id: normalized.senderId,
          name: normalized.senderName,
        },
      },
      message: normalized.message,
    };

    // Fan out concurrently
    const results = await fanOut(recipients, envelope);

    const delivered = [...results.values()].filter((r) => r.success).length;
    const failed = [...results.values()].filter((r) => !r.success).length;

    return NextResponse.json({
      ok: true,
      routed: delivered,
      failed,
      threadId: thread.threadId,
      turnId: turn.turnId,
    });
  } catch (err) {
    console.error(`[webhook/${channelId}] processing error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Signature verification ───────────────────────────────────────────────────

async function verifyWebhookSignature(
  request: NextRequest,
  platform: string,
  rawBody: string,
  channel: { credentialsRef: string },
): Promise<boolean> {
  // In production, credentialsRef would be used to fetch secrets from a vault.
  // For now, we support Slack signing secrets and Telegram tokens via env vars.

  if (platform === 'slack') {
    return verifySlackSignature(request, rawBody);
  }

  if (platform === 'telegram') {
    return verifyTelegramSignature(request);
  }

  // For other platforms, accept if no specific verification is configured.
  // Extend this as new adapters are added.
  return true;
}

async function verifySlackSignature(request: NextRequest, rawBody: string): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    // No secret configured — accept in development, reject in production.
    return process.env.NODE_ENV !== 'production';
  }

  const timestamp = request.headers.get('x-slack-request-timestamp');
  const slackSig = request.headers.get('x-slack-signature');

  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes to prevent replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 5 * 60) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigBase));
  const hexSig = `v0=${Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;

  // Constant-time comparison
  if (hexSig.length !== slackSig.length) return false;
  let diff = 0;
  for (let i = 0; i < hexSig.length; i++) {
    diff |= hexSig.charCodeAt(i) ^ slackSig.charCodeAt(i);
  }
  return diff === 0;
}

function verifyTelegramSignature(request: NextRequest): boolean {
  const expectedToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedToken) {
    return process.env.NODE_ENV !== 'production';
  }
  const token = request.headers.get('x-telegram-bot-api-secret-token');
  return token === expectedToken;
}

// ─── Event normalization ──────────────────────────────────────────────────────

interface NormalizedEvent {
  message: unknown;
  senderId: string;
  senderName?: string;
  targetId: string;
  nativeThreadId?: string | null;
  isDm: boolean;
  isMention: boolean;
}

function normalizeInboundEvent(
  platform: string,
  event: Record<string, unknown>,
): NormalizedEvent | null {
  if (platform === 'slack') {
    return normalizeSlackEvent(event);
  }
  if (platform === 'telegram') {
    return normalizeTelegramEvent(event);
  }
  // Generic fallback for unknown platforms
  return normalizeGenericEvent(event);
}

function normalizeSlackEvent(event: Record<string, unknown>): NormalizedEvent | null {
  const payload = event.event as Record<string, unknown> | undefined;
  if (!payload) return null;

  const type = payload.type as string;
  if (!['message', 'app_mention'].includes(type)) return null;

  const text = (payload.text as string) ?? '';
  const userId = (payload.user as string) ?? 'unknown';
  const channel = (payload.channel as string) ?? '';
  const threadTs = (payload.thread_ts as string) ?? null;
  const isDm = channel.startsWith('D');
  const isMention = type === 'app_mention' || text.includes('<@');

  return {
    message: { text },
    senderId: userId,
    targetId: channel,
    nativeThreadId: threadTs,
    isDm,
    isMention,
  };
}

function normalizeTelegramEvent(event: Record<string, unknown>): NormalizedEvent | null {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const text = (message.text as string) ?? '';
  const from = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;
  if (!from || !chat) return null;

  const senderId = String(from.id ?? 'unknown');
  const senderName = (from.first_name as string) ?? undefined;
  const chatId = String(chat.id ?? '');
  const chatType = (chat.type as string) ?? '';
  const isDm = chatType === 'private';

  return {
    message: { text },
    senderId,
    senderName,
    targetId: chatId,
    nativeThreadId: null,
    isDm,
    isMention: false,
  };
}

function normalizeGenericEvent(event: Record<string, unknown>): NormalizedEvent | null {
  // Accept events with explicit OpenThreads fields
  if (!event.senderId || !event.targetId) return null;

  return {
    message: event.message ?? { text: String(event.text ?? '') },
    senderId: String(event.senderId),
    senderName: event.senderName ? String(event.senderName) : undefined,
    targetId: String(event.targetId),
    nativeThreadId: event.nativeThreadId ? String(event.nativeThreadId) : null,
    isDm: Boolean(event.isDm),
    isMention: Boolean(event.isMention),
  };
}

// ─── Thread resolution ────────────────────────────────────────────────────────

async function resolveThread(
  channelId: string,
  event: NormalizedEvent,
): Promise<{ threadId: string }> {
  // If the event has a native thread ID, look for an existing thread
  if (event.nativeThreadId) {
    const existing = await getThreadByNativeId(channelId, event.nativeThreadId);
    if (existing) return existing;
  }

  // Create a new thread for this event
  return createThread({
    threadId: generateThreadId(),
    channelId,
    targetId: event.targetId,
    nativeThreadId: event.nativeThreadId ?? null,
  });
}
