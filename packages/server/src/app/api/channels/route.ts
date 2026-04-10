/**
 * GET  /api/channels — List all channels
 * POST /api/channels — Create a new channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { createChannel, listChannels } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { CreateChannelInput } from '@openthreads/core';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const channels = await listChannels();
    return NextResponse.json({ channels });
  } catch (err) {
    console.error('[channels] list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = body as Partial<CreateChannelInput>;
  if (!input.id || !input.platform || !input.credentialsRef) {
    return NextResponse.json(
      { error: 'Missing required fields: id, platform, credentialsRef' },
      { status: 400 },
    );
  }

  try {
    const channel = await createChannel(input as CreateChannelInput);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err: unknown) {
    // Duplicate key error
    if (err instanceof Error && err.message.includes('duplicate key')) {
      return NextResponse.json({ error: 'Channel ID already exists' }, { status: 409 });
    }
    console.error('[channels] create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
