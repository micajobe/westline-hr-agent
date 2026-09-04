export type McpMode = 'http' | 'inprocess';

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
  anthropicApiKey: string | undefined;
  agentModel: string;
  judgeModel: string;
  mcpMode: McpMode;
  /** Base URL of the MCP host. Required in http mode; discovered in inprocess mode. */
  mcpBaseUrl: string | undefined;
  mcpSharedSecret: string;
  chaosDisableHrMcp: boolean;
  rerank: boolean;
  /** Where the built web app lives; served statically when present. */
  webDistDir: string;
  evalResultsPath: string;
  conversationTtlMs: number;
  maxIterations: number;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mcpMode = (env.MCP_MODE ?? 'inprocess') as McpMode;
  if (mcpMode !== 'http' && mcpMode !== 'inprocess') throw new Error(`MCP_MODE must be http or inprocess, got "${env.MCP_MODE}"`);
  if (mcpMode === 'http' && !env.MCP_BASE_URL) throw new Error('MCP_BASE_URL is required when MCP_MODE=http');
  const secret = env.MCP_SHARED_SECRET;
  if (!secret) throw new Error('MCP_SHARED_SECRET is required');
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    agentModel: env.AGENT_MODEL ?? 'claude-sonnet-5',
    judgeModel: env.JUDGE_MODEL ?? 'claude-opus-5',
    mcpMode,
    mcpBaseUrl: env.MCP_BASE_URL?.replace(/\/$/, ''),
    mcpSharedSecret: secret,
    chaosDisableHrMcp: env.CHAOS_DISABLE_HR_MCP === 'true',
    rerank: env.RERANK === 'true',
    webDistDir: env.WEB_DIST_DIR ?? 'apps/web/dist',
    evalResultsPath: env.EVAL_RESULTS_PATH ?? 'evaluation/results/latest.json',
    conversationTtlMs: Number(env.CONVERSATION_TTL_MS ?? 30 * 60_000),
    maxIterations: Number(env.AGENT_MAX_ITERATIONS ?? 8),
    version: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? env.GIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
