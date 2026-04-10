/**
 * GET /api/audit — Query the A2H interaction audit log.
 *
 * Query parameters:
 *   turnId      — filter by turn ID
 *   threadId    — filter by thread ID
 *   channelId   — filter by channel ID
 *   eventType   — filter by event type
 *   fromDate    — ISO 8601 start timestamp
 *   toDate      — ISO 8601 end timestamp
 *   limit       — max results (default: 100, max: 500)
 *   offset      — pagination offset (default: 0)
 *
 * Returns 404 when the trust layer is not enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTrustService, getTrustEnabled } from '@/lib/trust-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!getTrustEnabled()) {
    return NextResponse.json(
      { error: 'Trust layer is not enabled. Set TRUST_LAYER_ENABLED=true to activate.' },
      { status: 404 },
    );
  }

  const sp = req.nextUrl.searchParams;

  const turnId = sp.get('turnId') ?? undefined;
  const threadId = sp.get('threadId') ?? undefined;
  const channelId = sp.get('channelId') ?? undefined;
  const eventType = sp.get('eventType') ?? undefined;

  const fromDateStr = sp.get('fromDate');
  const toDateStr = sp.get('toDate');
  const fromDate = fromDateStr ? new Date(fromDateStr) : undefined;
  const toDate = toDateStr ? new Date(toDateStr) : undefined;

  if (fromDate && isNaN(fromDate.getTime())) {
    return NextResponse.json({ error: 'Invalid fromDate' }, { status: 400 });
  }
  if (toDate && isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid toDate' }, { status: 400 });
  }

  const rawLimit = Number(sp.get('limit') ?? 100);
  const limit = Math.min(Math.max(1, rawLimit), 500);
  const offset = Math.max(0, Number(sp.get('offset') ?? 0));

  const trust = await getTrustService();

  const entries = await trust.queryAuditLog({
    turnId,
    threadId,
    channelId,
    eventType: eventType as Parameters<typeof trust.queryAuditLog>[0]['eventType'],
    fromDate,
    toDate,
    limit,
    offset,
  });

  return NextResponse.json({
    entries,
    pagination: {
      limit,
      offset,
      returned: entries.length,
    },
  });
}
