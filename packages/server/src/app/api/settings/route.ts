/**
 * GET /api/settings — Get global settings
 * PUT /api/settings — Update global settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/db';
import { verifyManagementAuth } from '@/lib/auth';
import type { AppSettings } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyManagementAuth(request);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings] get error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
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
    const settings = await updateSettings(body as Partial<AppSettings>);
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings] update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
