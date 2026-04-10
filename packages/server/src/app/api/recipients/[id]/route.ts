/**
 * GET    /api/recipients/:id — Recipient detail
 * PUT    /api/recipients/:id — Update recipient
 * DELETE /api/recipients/:id — Delete recipient
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecipient, updateRecipient, deleteRecipient } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { Recipient } from '@openthreads/core';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const recipient = await getRecipient(id);
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }
    return NextResponse.json({ recipient });
  } catch (err) {
    console.error('[recipients/:id] get error:', err);
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
    const recipient = await updateRecipient(id, body as Partial<Recipient>);
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }
    return NextResponse.json({ recipient });
  } catch (err) {
    console.error('[recipients/:id] update error:', err);
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
    const deleted = await deleteRecipient(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[recipients/:id] delete error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
