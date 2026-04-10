/**
 * GET    /api/routes/:id — Route detail
 * PUT    /api/routes/:id — Update route
 * DELETE /api/routes/:id — Delete route
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRoute, updateRoute, deleteRoute } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { Route } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const route = await getRoute(id);
    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (err) {
    console.error('[routes/:id] get error:', err);
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
    const route = await updateRoute(id, body as Partial<Route>);
    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (err) {
    console.error('[routes/:id] update error:', err);
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
    const deleted = await deleteRoute(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[routes/:id] delete error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
