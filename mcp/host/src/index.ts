import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HR_TOOL_NAMES, createHrDataServer, type HrContext } from '@westline/hr-data-mcp';
import {
  POLICY_TOOL_NAMES,
  createPolicyServer,
  listPolicyLibrary,
  readPolicyDocument,
  type PolicyContext,
} from '@westline/policy-mcp';

export const MCP_SECRET_HEADER = 'x-westline-mcp-secret';
export const MCP_PATHS = { policy: '/mcp/policy', hr: '/mcp/hr' } as const;
export type McpServerName = keyof typeof MCP_PATHS;

export interface McpHostOptions {
  policy: PolicyContext;
  hr: HrContext;
  /** Value of `MCP_SHARED_SECRET`. Requests without a matching header are refused with 401. */
  secret: string;
  port?: number;
  host?: string;
  logger?: boolean;
  /** Optional per-server kill switch used by the chaos flag and by tests. */
  disabled?: Partial<Record<McpServerName, boolean>>;
}

export interface McpHost {
  app: FastifyInstance;
  url: string;
  port: number;
  urls: Record<McpServerName, string>;
  close(): Promise<void>;
}

/**
 * One Fastify process exposing both MCP servers over Streamable HTTP (PRD §6, §10). Each request
 * gets its own `McpServer` + stateless transport bound to the shared, long-lived context: no
 * session table to lose on a Render restart, nothing for a client to re-negotiate, and the tool
 * implementations themselves stay singletons around the index and the desk store.
 *
 * This is the same code path in both deployment modes: `westline-mcp` runs `main.ts`; the app in
 * `MCP_MODE=inprocess` calls `startMcpHost` on a loopback port and connects over HTTP anyway.
 */
export async function startMcpHost(opts: McpHostOptions): Promise<McpHost> {
  const app = Fastify({ logger: opts.logger ?? false });
  const started = Date.now();

  // The transport reads the body itself; keep JSON parsing but accept anything for the mcp routes.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const factories: Record<McpServerName, () => McpServer> = {
    policy: () => createPolicyServer(opts.policy),
    hr: () => createHrDataServer(opts.hr),
  };

  for (const name of Object.keys(MCP_PATHS) as McpServerName[]) {
    app.route({
      method: ['GET', 'POST', 'DELETE'],
      url: MCP_PATHS[name],
      handler: async (request, reply) => {
        if (!secretMatches(request, opts.secret)) {
          return reply.code(401).send({ error: 'UNAUTHORIZED', reason: `missing or wrong ${MCP_SECRET_HEADER}` });
        }
        if (opts.disabled?.[name]) {
          return reply.code(503).send({ error: 'SERVER_DISABLED', server: name });
        }
        await serveMcp(factories[name](), request, reply);
      },
    });
  }

  // Read-only view of the desk for the app's /desk page. Secret-protected like the MCP routes,
  // and served from here because desk.sqlite lives with hr-data-mcp, not with the app.
  app.get('/desk', async (request, reply) => {
    if (!secretMatches(request, opts.secret)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return { tickets: opts.hr.desk.listTickets(), drafts: opts.hr.desk.listDrafts(), resets_on_redeploy: true };
  });

  // Read-only browse for the app's Handbook tab. Secret-protected like the MCP routes, and served
  // from here for the same reason /desk is: the index lives with policy-mcp, not with the app. The
  // acting person is a query parameter and audience filtering happens inside policy-mcp.
  app.get<{ Querystring: { acting_person_id?: string } }>('/handbook', async (request, reply) => {
    if (!secretMatches(request, opts.secret)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return listPolicyLibrary(opts.policy, actingPersonId(request.query.acting_person_id));
  });

  app.get<{ Params: { doc_id: string }; Querystring: { acting_person_id?: string } }>(
    '/handbook/:doc_id',
    async (request, reply) => {
      if (!secretMatches(request, opts.secret)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
      const result = readPolicyDocument(
        opts.policy,
        actingPersonId(request.query.acting_person_id),
        request.params.doc_id,
      );
      if (!result.ok) return reply.code(result.error === 'NOT_FOUND' ? 404 : 403).send(result);
      return result.document;
    },
  );

  app.get('/health', async () => ({
    status: 'ok',
    service: 'westline-mcp',
    uptime_s: Math.round((Date.now() - started) / 1000),
    servers: {
      policy: { path: MCP_PATHS.policy, tools: POLICY_TOOL_NAMES, disabled: Boolean(opts.disabled?.policy) },
      hr: { path: MCP_PATHS.hr, tools: HR_TOOL_NAMES, disabled: Boolean(opts.disabled?.hr) },
    },
    index: opts.policy.store.meta(),
    embedding_provider: opts.policy.provider.id,
  }));

  const host = opts.host ?? '127.0.0.1';
  const url = await app.listen({ port: opts.port ?? 0, host });
  const port = Number(new URL(url).port);
  return {
    app,
    url,
    port,
    urls: { policy: `${url}${MCP_PATHS.policy}`, hr: `${url}${MCP_PATHS.hr}` },
    close: () => app.close(),
  };
}

/** An absent, empty or malformed id is anonymous: `all`-audience material only, per PRD §6.1. */
function actingPersonId(raw: string | undefined): string | null {
  return raw && /^W-\d{4}$/.test(raw) ? raw : null;
}

function secretMatches(request: FastifyRequest, secret: string): boolean {
  const given = request.headers[MCP_SECRET_HEADER];
  const value = Array.isArray(given) ? given[0] : given;
  if (typeof value !== 'string' || value.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}

async function serveMcp(server: McpServer, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  reply.hijack();
  const res = reply.raw as ServerResponse;
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  const body = typeof request.body === 'string' && request.body ? JSON.parse(request.body) : request.body;
  await transport.handleRequest(request.raw as IncomingMessage, res, body);
}

// ---------- bootstrap from env ----------

export interface McpHostEnvOptions {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  port?: number;
  host?: string;
  logger?: boolean;
  log?: (msg: string) => void;
  disabled?: Partial<Record<McpServerName, boolean>>;
}

/**
 * Build both contexts from the environment and start the host. This is the only entry point the
 * app server uses for `MCP_MODE=inprocess` (CLAUDE.md: apps/server never imports a tool
 * implementation -- only this bootstrap), and it is what `main.ts` calls for the deployed service.
 */
export async function startMcpHostFromEnv(opts: McpHostEnvOptions = {}): Promise<McpHost> {
  const env = opts.env ?? process.env;
  const repoRoot = opts.repoRoot ?? process.cwd();
  const secret = env.MCP_SHARED_SECRET;
  if (!secret) throw new Error('MCP_SHARED_SECRET is required');
  const { createPolicyContextFromEnv } = await import('@westline/policy-mcp');
  const { createHrContextFromEnv } = await import('@westline/hr-data-mcp');
  const policy = await createPolicyContextFromEnv(env, repoRoot, opts.log);
  const hr = createHrContextFromEnv(env, repoRoot);
  return startMcpHost({
    policy,
    hr,
    secret,
    port: opts.port,
    host: opts.host,
    logger: opts.logger,
    disabled: opts.disabled,
  });
}
