/**
 * GET /api/health — Health check endpoint.
 *
 * Returns 200 with a JSON status object when the server and database are healthy.
 * Returns 503 when the database is unreachable.
 */

import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const start = Date.now();

  try {
    const dbAlive = await pingDb();

    if (!dbAlive) {
      return NextResponse.json(
        {
          status: 'degraded',
          database: 'unreachable',
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    });
  } catch (err) {
    console.error('[health] check failed:', err);
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
