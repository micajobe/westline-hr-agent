import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { PeopleDirectory } from '@westline/shared';
import { ConfirmError, type Orchestrator } from './agent/orchestrator.js';
import type { ServerConfig } from './config.js';
import { DEMO_TASKS } from './demo.js';
import type { McpToolClient } from './mcp/client.js';
import { SseWriter } from './routes/sse.js';

export interface AppDeps {
  config: ServerConfig;
  mcp: McpToolClient;
  people: PeopleDirectory;
  orchestrator: Orchestrator;
  /** Present when the agent has a model; absent means /chat returns 503 with a clear reason. */
  modelAvailable: boolean;
  repoRoot?: string;
}

const chatBody = {
  type: 'object',
  required: ['message'],
  additionalProperties: false,
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 4000 },
    acting_person_id: { type: ['string', 'null'], pattern: '^W-\\d{4}$' },
    conversation_id: { type: 'string', minLength: 3, maxLength: 64 },
  },
} as const;

const confirmBody = {
  type: 'object',
  required: ['conversation_id', 'turn_id', 'args_hash', 'decision'],
  additionalProperties: false,
  properties: {
    conversation_id: { type: 'string' },
    turn_id: { type: 'string' },
    args_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    decision: { type: 'string', enum: ['confirm', 'cancel'] },
  },
} as const;

type ChatBody = { message: string; acting_person_id?: string | null; conversation_id?: string };
type ConfirmBody = { conversation_id: string; turn_id: string; args_hash: string; decision: 'confirm' | 'cancel' };

/** PRD §8. Every body is JSON-schema validated by Fastify; the React app is served from apps/web/dist. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, mcp, people, orchestrator } = deps;
  const repoRoot = deps.repoRoot ?? process.cwd();
  const startedAt = Date.now();
  const app = Fastify({ logger: config.logLevel !== 'silent' && { level: config.logLevel } });

  const modelGuard = () => {
    if (!deps.modelAvailable) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set; the agent cannot run. Health, personas and desk still work.'), { statusCode: 503, code: 'MODEL_UNAVAILABLE' });
  };

  app.post<{ Body: ChatBody }>('/chat', { schema: { body: chatBody } }, async (req) => {
    modelGuard();
    return orchestrator.runTurn({ message: req.body.message, acting_person_id: req.body.acting_person_id ?? null, conversation_id: req.body.conversation_id });
  });

  app.post<{ Body: ChatBody }>('/chat/stream', { schema: { body: chatBody } }, async (req, reply) => {
    modelGuard();
    const sse = new SseWriter(reply);
    try {
      const envelope = await orchestrator.runTurn({ message: req.body.message, acting_person_id: req.body.acting_person_id ?? null, conversation_id: req.body.conversation_id, onEvent: (e) => sse.send('trace', e) });
      sse.send(envelope.confirmation_required ? 'confirmation_required' : 'final', envelope);
    } catch (err) {
      sse.send('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      sse.end();
    }
  });

  app.post<{ Body: ConfirmBody }>('/confirm', { schema: { body: confirmBody } }, async (req, reply) => {
    modelGuard();
    try {
      return await orchestrator.confirm(req.body);
    } catch (err) {
      if (err instanceof ConfirmError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  app.post<{ Body: ConfirmBody }>('/confirm/stream', { schema: { body: confirmBody } }, async (req, reply) => {
    modelGuard();
    const sse = new SseWriter(reply);
    try {
      const envelope = await orchestrator.confirm({ ...req.body, onEvent: (e) => sse.send('trace', e) });
      sse.send(envelope.confirmation_required ? 'confirmation_required' : 'final', envelope);
    } catch (err) {
      sse.send('error', err instanceof ConfirmError ? { error: err.code, message: err.message } : { message: err instanceof Error ? err.message : String(err) });
    } finally {
      sse.end();
    }
  });

  app.get('/health', async () => {
    const servers = await mcp.health();
    let index: unknown = null;
    try {
      const h = await mcp.hostGet<{ index?: unknown }>('/health');
      index = h.index ?? null;
    } catch {
      index = null;
    }
    const allUp = Object.values(servers).every((s) => s.status === 'connected' || s.status === 'disabled');
    return {
      status: allUp ? 'ok' : 'degraded',
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      version: config.version,
      mcp: servers,
      index,
      models: { agent: config.agentModel, judge: config.judgeModel, available: deps.modelAvailable },
      mode: { mcp: config.mcpMode, chaos: config.chaosDisableHrMcp, rerank: config.rerank, mcp_base_url: mcp.baseUrl },
    };
  });

  app.get('/personas', async () =>
    people.all().map((p) => ({ person_id: p.person_id, name: p.name, title: p.title, workforce_class: p.workforce_class, role: p.role, scope: p.scope, market: p.market })),
  );

  app.get('/demo/tasks', async () => DEMO_TASKS);

  app.get('/desk', async (_req, reply) => {
    try {
      return await mcp.hostGet('/desk');
    } catch (err) {
      return reply.code(503).send({ error: 'DESK_UNAVAILABLE', message: err instanceof Error ? err.message : String(err), tickets: [], drafts: [] });
    }
  });

  app.get('/eval/latest', async (_req, reply) => {
    const path = resolve(repoRoot, config.evalResultsPath);
    if (!existsSync(path)) return reply.code(404).send({ status: 'no_results', message: 'no evaluation results yet; run `npm run eval`' });
    reply.type('application/json');
    return readFileSync(path, 'utf8');
  });

  const webDist = resolve(repoRoot, config.webDistDir);
  if (existsSync(resolve(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && (req.headers.accept ?? '').includes('text/html')) {
        return reply.type('text/html').send(readFileSync(resolve(webDist, 'index.html')));
      }
      return reply.code(404).send({ error: 'NOT_FOUND', path: req.url });
    });
  }

  return app;
}
