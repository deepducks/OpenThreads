/**
 * Next.js instrumentation file.
 *
 * Called once when the server starts. Responsibilities:
 *  1. Graceful shutdown — close MongoDB connections cleanly on SIGTERM/SIGINT.
 *  2. OpenTelemetry — initialise tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * OpenTelemetry configuration (via environment variables):
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT  OTLP gRPC/HTTP endpoint, e.g. http://otel-collector:4318
 *   OTEL_SERVICE_NAME            Service name tag (default: "openthreads")
 *   OTEL_SDK_DISABLED            Set to "true" to disable tracing entirely
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * @see https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  const { disconnectDb } = await import('./lib/db');

  async function shutdown(signal: string): Promise<void> {
    console.log(JSON.stringify({ level: 'info', message: `received ${signal}, shutting down…`, signal }));
    try {
      await disconnectDb();
      console.log(JSON.stringify({ level: 'info', message: 'MongoDB connection closed' }));
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'error closing MongoDB connection',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // ── OpenTelemetry tracing ───────────────────────────────────────────────────
  if (
    process.env.OTEL_SDK_DISABLED !== 'true' &&
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    await setupOpenTelemetry();
  }
}

async function setupOpenTelemetry(): Promise<void> {
  try {
    const {
      NodeSDK,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = await import('@opentelemetry/sdk-node' as string).catch(() => ({ NodeSDK: null })) as { NodeSDK: (new (...args: unknown[]) => { start(): void }) | null };

    if (!NodeSDK) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'OpenTelemetry SDK not installed. Install @opentelemetry/sdk-node to enable tracing.',
      }));
      return;
    }

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'openthreads';

    // NodeSDK auto-instruments HTTP, DNS, MongoDB, etc. via OTEL_NODE_RESOURCE_DETECTORS.
    // The exporter endpoint and protocol are read from OTEL_EXPORTER_OTLP_ENDPOINT /
    // OTEL_EXPORTER_OTLP_PROTOCOL (defaults to http/protobuf).
    const sdk = new NodeSDK({ resource: { attributes: { 'service.name': serviceName } } } as unknown as Parameters<typeof NodeSDK>[0]);
    sdk.start();

    console.log(JSON.stringify({
      level: 'info',
      message: 'OpenTelemetry tracing started',
      serviceName,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }));

    // Flush spans on shutdown
    process.on('SIGTERM', () => { void (sdk as unknown as { shutdown(): Promise<void> }).shutdown(); });
    process.on('SIGINT', () => { void (sdk as unknown as { shutdown(): Promise<void> }).shutdown(); });
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to start OpenTelemetry SDK',
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}
