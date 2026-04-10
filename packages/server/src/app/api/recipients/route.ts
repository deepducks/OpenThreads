/**
 * GET  /api/recipients — List all recipients
 * POST /api/recipients — Create a new recipient
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRecipient, listRecipients } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { CreateRecipientInput } from '@openthreads/core';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const recipients = await listRecipients();
    return NextResponse.json({ recipients });
  } catch (err) {
    console.error('[recipients] list error:', err);
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

  const input = body as Partial<CreateRecipientInput>;
  if (!input.id || !input.webhookUrl) {
    return NextResponse.json(
      { error: 'Missing required fields: id, webhookUrl' },
      { status: 400 },
    );
  }

  try {
    const recipient = await createRecipient(input as CreateRecipientInput);
    return NextResponse.json({ recipient }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('duplicate key')) {
      return NextResponse.json({ error: 'Recipient ID already exists' }, { status: 409 });
    }
    console.error('[recipients] create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
