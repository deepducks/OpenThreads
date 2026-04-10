/**
 * GET  /api/routes — List all routes
 * POST /api/routes — Create a new route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRoute, listRoutes } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { CreateRouteInput } from '@openthreads/core';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const routes = await listRoutes();
    return NextResponse.json({ routes });
  } catch (err) {
    console.error('[routes] list error:', err);
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

  const input = body as Partial<CreateRouteInput>;
  if (!input.id || !input.recipientId || input.priority === undefined) {
    return NextResponse.json(
      { error: 'Missing required fields: id, recipientId, priority' },
      { status: 400 },
    );
  }

  const route: CreateRouteInput = {
    id: input.id,
    criteria: input.criteria ?? {},
    recipientId: input.recipientId,
    priority: input.priority,
    enabled: input.enabled ?? true,
  };

  try {
    const created = await createRoute(route);
    return NextResponse.json({ route: created }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('duplicate key')) {
      return NextResponse.json({ error: 'Route ID already exists' }, { status: 409 });
    }
    console.error('[routes] create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
