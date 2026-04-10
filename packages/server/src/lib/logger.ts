/**
 * Minimal request logger for OpenThreads server.
 *
 * Logs method, path, status, and duration in a structured format.
 * In production, plug in your preferred logger (Pino, Winston, etc.).
 */

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
  error?: string;
}

export function logRequest(entry: RequestLogEntry): void {
  const { timestamp, method, path, status, durationMs, ip, error } = entry;
  const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
  const parts = [
    `[${timestamp}]`,
    `[${level}]`,
    method,
    path,
    status,
    `${durationMs}ms`,
  ];
  if (ip) parts.push(`ip=${ip}`);
  if (error) parts.push(`error=${error}`);

  if (level === 'ERROR') {
    console.error(parts.join(' '));
  } else if (level === 'WARN') {
    console.warn(parts.join(' '));
  } else {
    console.log(parts.join(' '));
  }
}

/**
 * Create a request log entry from a Next.js Request + Response.
 * Call this at the end of a route handler, passing the start time.
 */
export function createLogEntry(
  request: Request,
  status: number,
  startedAt: number,
  error?: unknown,
): RequestLogEntry {
  const url = new URL(request.url);
  return {
    timestamp: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    status,
    durationMs: Date.now() - startedAt,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? undefined,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  };
}
