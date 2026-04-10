/**
 * GET /api/threads/:threadId — Thread detail
 */

import { NextRequest, NextResponse } from 'next/server';
import { getThread } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { threadId } = await context.params;

  try {
    const thread = await getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
    return NextResponse.json({ thread });
  } catch (err) {
    console.error('[threads/:threadId] get error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
