/**
 * GET /api/metrics — Prometheus-compatible metrics endpoint.
 *
 * Returns metrics in the Prometheus text exposition format (Content-Type:
 * text/plain; version=0.0.4). Scrape this endpoint from your Prometheus
 * configuration:
 *
 *   scrape_configs:
 *     - job_name: openthreads
 *       static_configs:
 *         - targets: ['openthreads:3000']
 *       metrics_path: /api/metrics
 *
 * Access can be restricted by setting MANAGEMENT_API_KEY in the environment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { registry } from '@/lib/metrics';

export const runtime = 'nodejs';
// Prevent Next.js from caching this route — metrics must always be fresh.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // If a management API key is configured, require it on the metrics endpoint too.
  const apiKey = process.env.MANAGEMENT_API_KEY;
  if (apiKey) {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== apiKey) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const body = registry.render();

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
