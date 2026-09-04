import { startServer } from './bootstrap.js';

startServer().then(
  (s) => {
    console.error(`[westline-app] listening on ${s.url} (MCP_MODE=${s.config.mcpMode}, mcp at ${s.mcp.baseUrl})`);
    const shutdown = async () => {
      await s.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },
  (err: unknown) => {
    console.error(`[westline-app] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  },
);
