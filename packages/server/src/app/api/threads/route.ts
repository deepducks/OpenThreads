/**
 * GET /api/threads — List threads, optionally filtered by channelId, targetId, and search
 */

import { NextRequest, NextResponse } from 'next/server';
import { listThreads } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channelId = request.nextUrl.searchParams.get('channelId') ?? undefined;
  const targetId = request.nextUrl.searchParams.get('targetId') ?? undefined;
  const search = request.nextUrl.searchParams.get('search') ?? undefined;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 100;

  try {
    const threads = await listThreads({ channelId, targetId, search, limit });
    return NextResponse.json({ threads });
  } catch (err) {
    console.error('[threads] list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
