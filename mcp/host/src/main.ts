import { startMcpHostFromEnv } from './index.js';

/** `npm run start:mcp` -- the `westline-mcp` Render service. */
async function main(): Promise<void> {
  const log = (msg: string) => console.error(`[westline-mcp] ${msg}`);
  log('preparing policy index…');
  const host = await startMcpHostFromEnv({
    port: Number(process.env.PORT ?? 3100),
    host: '0.0.0.0',
    logger: (process.env.LOG_LEVEL ?? 'info') !== 'silent',
    log,
  });
  log(`listening on ${host.url}  (${host.urls.policy}, ${host.urls.hr})`);

  const shutdown = async () => {
    log('shutting down');
    await host.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(`[westline-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
