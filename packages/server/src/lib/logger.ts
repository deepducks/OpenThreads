/**
 * Structured JSON logger for OpenThreads server.
 *
 * Outputs newline-delimited JSON when LOG_FORMAT=json (default in production)
 * or human-readable text when LOG_FORMAT=text (default in development).
 *
 * Log level is controlled via the LOG_LEVEL environment variable:
 *   debug | info | warn | error  (default: info)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return env in LEVEL_RANK ? env : 'info';
}

function isJsonFormat(): boolean {
  const fmt = process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text');
  return fmt === 'json';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[getConfiguredLevel()];
}

// ─── Core log function ────────────────────────────────────────────────────────

function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  if (isJsonFormat()) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } else {
    const ts = new Date().toISOString();
    const lvl = level.toUpperCase().padEnd(5);
    const extras = fields ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join(' ') : '';
    const line = `[${ts}] [${lvl}] ${message}${extras}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log('debug', message, fields),
  info:  (message: string, fields?: Record<string, unknown>) => log('info',  message, fields),
  warn:  (message: string, fields?: Record<string, unknown>) => log('warn',  message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log('error', message, fields),
};

// ─── Request logging ──────────────────────────────────────────────────────────

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
  const { status, method, path, durationMs, ip, error } = entry;
  const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

  log(level, `${method} ${path} ${status}`, {
    method,
    path,
    status,
    durationMs,
    ...(ip ? { ip } : {}),
    ...(error ? { error } : {}),
  });
}

/**
 * Create a request log entry from a Next.js Request + Response.
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
