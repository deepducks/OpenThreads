/**
 * Simple in-memory rate limiter for public endpoints.
 *
 * Uses a sliding-window counter per key (IP address or channel ID).
 * NOT suitable for multi-process deployments — use Redis for production.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Clean up expired buckets every 5 minutes to prevent unbounded memory growth.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Don't block process exit.
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Attempt to consume one request from the rate limit bucket for `key`.
 *
 * @param key       Identifier for this rate-limit bucket (e.g. IP, channelId)
 * @param limit     Maximum number of requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 * @returns `true` if the request is allowed, `false` if the limit is exceeded
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  startCleanup();

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/**
 * Extract the client IP address from a Next.js request.
 * Falls back to 'unknown' if no address can be determined.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// ─── Preconfigured limiters ───────────────────────────────────────────────────

/** 60 webhook requests per minute per channel */
export function webhookRateLimit(channelId: string): boolean {
  return rateLimit(`webhook:${channelId}`, 60, 60 * 1000);
}

/** 30 send requests per minute per IP */
export function sendRateLimit(ip: string): boolean {
  return rateLimit(`send:${ip}`, 30, 60 * 1000);
}
