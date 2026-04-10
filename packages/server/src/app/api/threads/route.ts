/**
 * GET /api/threads — List threads, filterable by channelId and targetId
 */

import { NextRequest, NextResponse } from 'next/server';
import { listThreadsByChannel } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channelId = request.nextUrl.searchParams.get('channelId');
  const targetId = request.nextUrl.searchParams.get('targetId') ?? undefined;

  if (!channelId) {
    return NextResponse.json(
      { error: 'Missing required query param: channelId' },
      { status: 400 },
    );
  }

  try {
    const threads = await listThreadsByChannel(channelId, targetId);
    return NextResponse.json({ threads });
  } catch (err) {
    console.error('[threads] list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
