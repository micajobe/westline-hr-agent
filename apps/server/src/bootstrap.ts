import { resolve } from 'node:path';
import { createSemanticVerifier } from '@westline/semantic-verify';
import { PeopleDirectory } from '@westline/shared';
import type { FastifyInstance } from 'fastify';
import { ConversationStore } from './agent/conversation.js';
import { AnthropicModel, type ModelClient } from './agent/model.js';
import { Orchestrator } from './agent/orchestrator.js';
import { buildApp } from './app.js';
import { loadConfig, type ServerConfig } from './config.js';
import { McpToolClient } from './mcp/client.js';
import { startInprocessMcp } from './mcp/inprocess.js';

export interface WestlineServer {
  app: FastifyInstance;
  config: ServerConfig;
  mcp: McpToolClient;
  url: string;
  close(): Promise<void>;
}

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  /** Tests inject a fake; production builds an AnthropicModel from the key. */
  model?: ModelClient;
  port?: number;
  host?: string;
  log?: (msg: string) => void;
}

/**
 * Wire everything: MCP (in-process or remote), discovery, the orchestrator, the Fastify app. Used
 * by `main.ts` and by `server.start.test.ts`, so the test boots the same object the deploy does.
 */
export async function startServer(opts: StartOptions = {}): Promise<WestlineServer> {
  const env = opts.env ?? process.env;
  const repoRoot = opts.repoRoot ?? process.cwd();
  const log = opts.log ?? ((m: string) => console.error(`[westline-app] ${m}`));
  const config = loadConfig(env);

  let inprocess: Awaited<ReturnType<typeof startInprocessMcp>> | undefined;
  let baseUrl = config.mcpBaseUrl;
  if (config.mcpMode === 'inprocess') {
    log('MCP_MODE=inprocess: starting both MCP servers on a loopback port…');
    inprocess = await startInprocessMcp({ env, log, disableHr: false });
    baseUrl = inprocess.baseUrl;
  }
  if (!baseUrl) throw new Error('no MCP base URL');

  const mcp = new McpToolClient({ baseUrl, secret: config.mcpSharedSecret, disabled: config.chaosDisableHrMcp ? { hr: true } : undefined });
  const tools = await mcp.discover();
  log(`discovered ${tools.length} tools: ${tools.map((t) => t.namespaced).join(', ')}`);

  const people = PeopleDirectory.load(resolve(repoRoot, env.MOCK_DATA_DIR ?? 'mock_data', 'people.json'));
  const model = opts.model ?? (config.anthropicApiKey ? new AnthropicModel(config.anthropicApiKey, config.agentModel) : undefined);
  if (!model) log('ANTHROPIC_API_KEY not set: /chat will return 503 until it is');
  const semantic = createSemanticVerifier({ provider: config.semanticVerifyProvider, apiKey: config.typesafeApiKey, model: config.typesafeModel });
  log(`semantic citation verification: ${config.semanticVerifyProvider}${semantic ? ` (${semantic.model}, threshold ${config.semanticVerifyThreshold})` : ''}`);

  const orchestrator = new Orchestrator({
    model: model ?? unavailableModel(),
    mcp,
    people,
    store: new ConversationStore(config.conversationTtlMs),
    secret: config.mcpSharedSecret,
    maxIterations: config.maxIterations,
    semantic,
    semanticThreshold: config.semanticVerifyThreshold,
  });

  const app = await buildApp({ config, mcp, people, orchestrator, modelAvailable: Boolean(model), repoRoot });
  const url = await app.listen({ port: opts.port ?? config.port, host: opts.host ?? config.host });
  return {
    app, config, mcp, url,
    close: async () => {
      await app.close();
      await mcp.close();
      await inprocess?.host.close();
    },
  };
}

function unavailableModel(): ModelClient {
  return { model: 'none', create: async () => { throw new Error('no model configured'); } };
}
