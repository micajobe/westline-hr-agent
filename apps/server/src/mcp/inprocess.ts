import { startMcpHostFromEnv, type McpHost } from '@westline/mcp-host';

/**
 * `MCP_MODE=inprocess` (PRD §2, ADR 0011): start both MCP servers on an ephemeral loopback port in
 * this process and hand back the base URL. The agent then talks to them over Streamable HTTP through
 * `McpToolClient` exactly as it would talk to the deployed `westline-mcp` service. This file imports
 * only the host bootstrap -- never a tool implementation.
 */
export async function startInprocessMcp(opts: { env?: NodeJS.ProcessEnv; log?: (m: string) => void; disableHr?: boolean } = {}): Promise<{ baseUrl: string; host: McpHost }> {
  const host = await startMcpHostFromEnv({
    env: opts.env,
    host: '127.0.0.1',
    port: 0,
    logger: false,
    log: opts.log,
    disabled: opts.disableHr ? { hr: true } : undefined,
  });
  return { baseUrl: host.url, host };
}
