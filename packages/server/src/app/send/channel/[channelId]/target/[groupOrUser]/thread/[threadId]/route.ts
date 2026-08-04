/**
 * POST /send/channel/:channelId/target/:groupOrUser/thread/:threadId
 *
 * Recipient inbound — existing thread variant.
 * Processes the message body in the context of an existing thread.
 *
 * Auth: `?token=ot_tk_...` (scoped to thread) OR `Authorization: Bearer ot_ch_sk_...`
 * Body: `{ message: object | object[] }`
 *
 * Returns 202 Accepted for fire-and-forget (INFORM / Chat SDK messages).
 * Returns 200 with pending status for blocking A2H intents.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getThread,
  createTurn,
  createEphemeralToken,
  consumeToken,
  generateTurnId,
} from '@/lib/db';
import { verifySendAuth } from '@/lib/auth';
import { sendRateLimit, getClientIp } from '@/lib/rate-limit';
import { isA2HMessage, hasA2HMessages, normaliseToArray } from '@openthreads/core';
import type { OpenThreadsMessage } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ channelId: string; groupOrUser: string; threadId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const ip = getClientIp(request);
  if (!sendRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { channelId, groupOrUser, threadId } = await context.params;

  // Validate auth (token scoped to this thread, or channel API key)
  const auth = await verifySendAuth(request, channelId, threadId);
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
    // Verify the thread exists and belongs to this channel/target
    const thread = await getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
    if (thread.channelId !== channelId) {
      return NextResponse.json({ error: 'Thread does not belong to this channel' }, { status: 403 });
    }

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

    // Determine if this requires a blocking response
    const isBlocking = hasA2HMessages(messages);

    // Generate a replyTo URL for subsequent replies
    const baseUrl = process.env.OPENTHREADS_BASE_URL ?? `https://${request.headers.get('host')}`;
    const replyToken = await createEphemeralToken({
      channelId,
      threadId: thread.threadId,
      turnId: turn.turnId,
    });
    const replyTo = `${baseUrl}/send/channel/${channelId}/target/${groupOrUser}/thread/${thread.threadId}?token=${replyToken.value}`;

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
    console.error('[send/thread] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
