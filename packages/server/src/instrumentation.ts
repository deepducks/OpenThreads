/**
 * Next.js instrumentation file.
 *
 * Called once when the server starts. Used to set up graceful shutdown
 * handling so that active MongoDB connections are closed cleanly when
 * the process receives SIGTERM or SIGINT.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { disconnectDb } = await import('./lib/db');

    async function shutdown(signal: string): Promise<void> {
      console.log(`[shutdown] received ${signal}, closing connections…`);
      try {
        await disconnectDb();
        console.log('[shutdown] MongoDB connection closed');
      } catch (err) {
        console.error('[shutdown] error closing MongoDB connection:', err);
      }
      process.exit(0);
    }

    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
  }
}
