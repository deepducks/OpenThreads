/**
 * POST /send/channel/:channelId/target/:groupOrUser
 *
 * Recipient inbound — new thread variant.
 * Creates a new thread for the given (channel, target) pair and processes
 * the message body via the Reply Engine.
 *
 * Auth: `?token=ot_tk_...` OR `Authorization: Bearer ot_ch_sk_...`
 * Body: `{ message: object | object[] }`
 *
 * Returns 202 Accepted for fire-and-forget messages (no blocking A2H intent).
 * Returns 200 with responses for blocking A2H intents.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createThread,
  createTurn,
  createEphemeralToken,
  consumeToken,
  generateTurnId,
  generateThreadId,
} from '@/lib/db';
import { verifySendAuth } from '@/lib/auth';
import { sendRateLimit, getClientIp } from '@/lib/rate-limit';
import { isA2HMessage, hasA2HMessages, normaliseToArray } from '@openthreads/core';
import type { OpenThreadsMessage } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ channelId: string; groupOrUser: string }> };

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const ip = getClientIp(request);
  if (!sendRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { channelId, groupOrUser } = await context.params;

  // Validate auth (token or API key)
  const auth = await verifySendAuth(request, channelId);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Parse body
  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message) {
    return NextResponse.json({ error: 'Missing required field: message' }, { status: 400 });
  }

  try {
    // Create new thread
    const thread = await createThread({
      threadId: generateThreadId(),
      channelId,
      targetId: groupOrUser,
      nativeThreadId: null,
    });

    // Record the inbound turn
    const messages = normaliseToArray(body.message as OpenThreadsMessage | OpenThreadsMessage[]);
    const turn = await createTurn({
      turnId: generateTurnId(),
      threadId: thread.threadId,
      direction: 'inbound',
      message: messages,
    });

    // Consume the token if auth was via token
    if (auth.method === 'token') {
      const tokenParam = request.nextUrl.searchParams.get('token');
      if (tokenParam) await consumeToken(tokenParam);
    }

    // Determine if this is blocking (contains A2H intents that need a response)
    const isBlocking = hasA2HMessages(messages);

    // Generate a replyTo URL for the next turn
    const baseUrl = process.env.OPENTHREADS_BASE_URL ?? `https://${request.headers.get('host')}`;
    const replyToken = await createEphemeralToken({
      channelId,
      threadId: thread.threadId,
      turnId: turn.turnId,
    });
    const replyTo = `${baseUrl}/send/channel/${channelId}/target/${groupOrUser}/thread/${thread.threadId}?token=${replyToken.value}`;

    // For fire-and-forget (no blocking A2H), return 202 Accepted.
    if (!isBlocking) {
      return NextResponse.json(
        {
          status: 'accepted',
          threadId: thread.threadId,
          turnId: turn.turnId,
          replyTo,
        },
        { status: 202 },
      );
    }

    // For blocking A2H intents, return 200 with a synchronous receipt.
    // The actual human response will come in via a subsequent POST to replyTo.
    // The Reply Engine integration (actual channel adapter call) happens when
    // the channel adapter is instantiated and attached to this server.
    return NextResponse.json({
      status: 'pending',
      threadId: thread.threadId,
      turnId: turn.turnId,
      replyTo,
      intents: messages.filter(isA2HMessage).map((m) => ({
        intent: m.intent,
        description: m.description,
        traceId: m.traceId,
      })),
    });
  } catch (err) {
    console.error('[send] create thread error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
