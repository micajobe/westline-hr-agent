import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { PeopleDirectory } from '@westline/shared';
import { ConfirmError, type Orchestrator } from './agent/orchestrator.js';
import type { ServerConfig } from './config.js';
import { DEMO_TASKS } from './demo.js';
import type { HostGetError, McpToolClient } from './mcp/client.js';
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

const query = (acting_person_id: string | undefined) =>
  acting_person_id ? `?acting_person_id=${encodeURIComponent(acting_person_id)}` : '';

/** PRD §8. Every body is JSON-schema validated by Fastify; the React app is served from apps/web/dist. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, mcp, people, orchestrator } = deps;
  const repoRoot = deps.repoRoot ?? process.cwd();
  const startedAt = Date.now();
  const app = Fastify({ logger: config.logLevel !== 'silent' && { level: config.logLevel } });

  const webDist = resolve(repoRoot, config.webDistDir);
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

  // PRD §8 GET /desk is JSON for API clients; a browser navigating to /desk wants the page.
  app.get('/desk', async (req, reply) => {
    if ((req.headers.accept ?? '').includes('text/html') && existsSync(resolve(webDist, 'index.html'))) {
      return reply.type('text/html').send(readFileSync(resolve(webDist, 'index.html')));
    }
    try {
      return await mcp.hostGet('/desk');
    } catch (err) {
      return reply.code(503).send({ error: 'DESK_UNAVAILABLE', message: err instanceof Error ? err.message : String(err), tickets: [], drafts: [] });
    }
  });

  // PRD §9.1 Handbook: the categorised corpus listing, and one document opened for reading. Both
  // proxy policy-mcp, which is where audience filtering lives (CLAUDE.md); the app only forwards
  // the acting person and never reads the index. Same accept-header split as /desk.
  // Only `acting_person_id` is meaningful to the API, but the SPA is served from these same paths
  // and carries its own `?section=` state, so unknown params are ignored rather than rejected.
  const handbookQuery = {
    type: 'object',
    properties: { acting_person_id: { type: 'string', pattern: '^W-\\d{4}$' } },
  } as const;

  const spaOr = async (req: FastifyRequest, reply: FastifyReply, load: () => Promise<unknown>) => {
    if ((req.headers.accept ?? '').includes('text/html') && existsSync(resolve(webDist, 'index.html'))) {
      return reply.type('text/html').send(readFileSync(resolve(webDist, 'index.html')));
    }
    try {
      return await load();
    } catch (err) {
      const e = err as HostGetError;
      // 403/404 from policy-mcp are answers, not outages: pass the structured body straight through.
      if (e.status === 403 || e.status === 404) return reply.code(e.status).send(e.body);
      return reply.code(503).send({ error: 'HANDBOOK_UNAVAILABLE', message: err instanceof Error ? err.message : String(err) });
    }
  };

  app.get<{ Querystring: { acting_person_id?: string } }>('/handbook', { schema: { querystring: handbookQuery } }, async (req, reply) =>
    spaOr(req, reply, () => mcp.hostGet(`/handbook${query(req.query.acting_person_id)}`)),
  );

  app.get<{ Params: { doc_id: string }; Querystring: { acting_person_id?: string } }>(
    '/handbook/:doc_id',
    { schema: { querystring: handbookQuery, params: { type: 'object', properties: { doc_id: { type: 'string', pattern: '^[A-Za-z]{2,20}$' } } } } },
    async (req, reply) =>
      spaOr(req, reply, () => mcp.hostGet(`/handbook/${req.params.doc_id}${query(req.query.acting_person_id)}`)),
  );

  app.get('/eval/latest', async (_req, reply) => {
    const path = resolve(repoRoot, config.evalResultsPath);
    if (!existsSync(path)) return reply.code(404).send({ status: 'no_results', message: 'no evaluation results yet; run `npm run eval`' });
    reply.type('application/json');
    return readFileSync(path, 'utf8');
  });

  if (existsSync(resolve(webDist, 'index.html'))) {
    // wildcard: true so assets built after startup are served (wildcard: false snapshots the directory).
    await app.register(fastifyStatic, { root: webDist, wildcard: true, index: ['index.html'] });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && (req.headers.accept ?? '').includes('text/html')) {
        return reply.type('text/html').send(readFileSync(resolve(webDist, 'index.html')));
      }
      return reply.code(404).send({ error: 'NOT_FOUND', path: req.url });
    });
  }

  return app;
}
