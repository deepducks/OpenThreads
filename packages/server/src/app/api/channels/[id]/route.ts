/**
 * GET    /api/channels/:id — Channel detail
 * PUT    /api/channels/:id — Update channel
 * DELETE /api/channels/:id — Delete channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { getChannel, updateChannel, deleteChannel } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { CreateChannelInput } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const channel = await getChannel(id);
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }
    return NextResponse.json({ channel });
  } catch (err) {
    console.error('[channels/:id] get error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const channel = await updateChannel(id, body as Partial<CreateChannelInput>);
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }
    return NextResponse.json({ channel });
  } catch (err) {
    console.error('[channels/:id] update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const deleted = await deleteChannel(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[channels/:id] delete error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
