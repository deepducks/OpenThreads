/**
 * POST /api/routes/test — Test which routes match given criteria
 */

import { NextRequest, NextResponse } from 'next/server';
import { findMatchingRoutes } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { RouteCriteria } from '@openthreads/core';

export const runtime = 'nodejs';

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

  try {
    const criteria = body as Partial<RouteCriteria>;
    const routes = await findMatchingRoutes(criteria);
    return NextResponse.json({ matchingRouteIds: routes.map((r) => r.id), routes });
  } catch (err) {
    console.error('[routes/test] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
