import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import AjvModule from 'ajv';

// ajv is CJS with both default and module.exports forms; resolve whichever the loader hands us.
const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as new (opts: Record<string, unknown>) => AjvInstance;
interface AjvInstance { compile(schema: object): Validator }
type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: Record<string, unknown> }[] | null };

export type ServerName = 'policy' | 'hr';
/** Read-only host routes the app may proxy. */
export type HostPath = '/health' | '/desk' | `/handbook${string}`;
/** Thrown by `hostGet` on a non-2xx; `status` and `body` are the host's own. */
export interface HostGetError extends Error { status?: number; body?: unknown }
export const SERVER_NAMES: ServerName[] = ['policy', 'hr'];
export const MCP_SECRET_HEADER = 'x-westline-mcp-secret';
/** Namespace separator: `policy__search_policy_documents` (Anthropic tool names allow `_`). */
export const NAMESPACE_SEP = '__';

/** The two gated tools (PRD §6.2). The server injects the confirmation token; the model never sees the field. */
export const GATED_TOOLS = new Set(['hr__create_mock_hr_ticket', 'hr__draft_hr_email']);

/** Arguments the server owns. Stripped from the model-facing schema and injected on every call. */
const SERVER_OWNED_ARGS = ['acting_person_id', 'confirmation_token'];

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };
}

export interface DiscoveredTool {
  namespaced: string;
  server: ServerName;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  gated: boolean;
}

export type ToolCallResult =
  | { ok: true; result: unknown; duration_ms: number }
  | { ok: false; status: 'TOOL_UNAVAILABLE' | 'TOOL_ERROR'; server: ServerName; message: string; duration_ms: number };

export interface ServerHealth {
  status: 'connected' | 'down' | 'disabled';
  tools: number;
  latency_ms: number | null;
  error?: string;
}

export interface McpClientOptions {
  baseUrl: string;
  secret: string;
  disabled?: Partial<Record<ServerName, boolean>>;
  /** ms before a call is considered failed. */
  timeoutMs?: number;
}

/**
 * The only path from the agent to any tool (CLAUDE.md). One Streamable HTTP session per MCP server,
 * discovery at startup, Anthropic `tools[]` built from the discovered schemas with server-owned
 * arguments removed, and every call routed by namespace prefix with the trusted `acting_person_id`
 * injected here -- so identity in the tool call is never something the model chose.
 */
export class McpToolClient {
  private readonly clients = new Map<ServerName, Client>();
  private tools: DiscoveredTool[] = [];
  private readonly validators = new Map<string, Validator>();
  private readonly ajv = new AjvCtor({ allErrors: true, strict: false });
  private readonly timeoutMs: number;

  constructor(private readonly opts: McpClientOptions) {
    // Generous by default: a compliance call embeds several queries, and a rate-limited Voyage key
    // can space those 21 s apart. MCP_TOOL_TIMEOUT_MS overrides.
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.MCP_TOOL_TIMEOUT_MS ?? 120_000);
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  urlFor(server: ServerName): string {
    return `${this.opts.baseUrl}/mcp/${server}`;
  }

  isDisabled(server: ServerName): boolean {
    return Boolean(this.opts.disabled?.[server]);
  }

  /** Connect to every enabled server and run `list_tools`. A server that is down does not stop startup. */
  async discover(): Promise<DiscoveredTool[]> {
    const found: DiscoveredTool[] = [];
    for (const server of SERVER_NAMES) {
      if (this.isDisabled(server)) continue;
      try {
        const client = await this.connect(server);
        const { tools } = await client.listTools();
        for (const t of tools) found.push(toDiscovered(server, t));
      } catch {
        // Reported by health(); calls to this server return TOOL_UNAVAILABLE.
      }
    }
    this.tools = found;
    return found;
  }

  discovered(): DiscoveredTool[] {
    return [...this.tools];
  }

  /** Model-facing tool list. `acting_person_id` and `confirmation_token` are removed on purpose. */
  anthropicTools(): AnthropicTool[] {
    return this.tools.map((t) => {
      const schema = structuredClone(t.inputSchema) as AnthropicTool['input_schema'];
      const props = { ...(schema.properties ?? {}) } as Record<string, unknown>;
      for (const k of SERVER_OWNED_ARGS) delete props[k];
      const required = (schema.required ?? []).filter((r) => !SERVER_OWNED_ARGS.includes(r));
      return {
        name: t.namespaced,
        description: t.description,
        input_schema: { ...schema, type: 'object', properties: props, required },
      };
    });
  }

  resolve(namespaced: string): DiscoveredTool | undefined {
    return this.tools.find((t) => t.namespaced === namespaced);
  }

  /**
   * Validate model-supplied arguments against the tool's discovered schema (minus the server-owned
   * fields). Lets the orchestrator bounce a malformed call back to the model *before* it reaches a
   * confirmation card -- a user should never confirm arguments the tool would reject.
   */
  validateArgs(namespaced: string, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
    const tool = this.resolve(namespaced);
    if (!tool) return { ok: false, message: `unknown tool ${namespaced}` };
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, message: 'arguments must be a JSON object with the tool\'s named fields' };
    let validate: Validator | undefined = this.validators.get(namespaced);
    if (!validate) {
      const schema = structuredClone(tool.inputSchema) as Record<string, any>;
      const props = { ...(schema.properties ?? {}) };
      for (const k of SERVER_OWNED_ARGS) delete props[k];
      schema.properties = props;
      schema.required = ((schema.required as string[] | undefined) ?? []).filter((r) => !SERVER_OWNED_ARGS.includes(r));
      delete schema.$schema;
      validate = this.ajv.compile(schema);
      this.validators.set(namespaced, validate);
    }
    const v: Validator = validate;
    const clean = { ...(args as Record<string, unknown>) };
    for (const k of SERVER_OWNED_ARGS) delete clean[k];
    if (v(clean)) return { ok: true, args: clean };
    const message = (v.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}`).join('; ');
    return { ok: false, message: `invalid arguments for ${namespaced}: ${message}` };
  }

  static split(namespaced: string): { server: ServerName; name: string } | undefined {
    const i = namespaced.indexOf(NAMESPACE_SEP);
    if (i < 0) return undefined;
    const server = namespaced.slice(0, i);
    if (server !== 'policy' && server !== 'hr') return undefined;
    return { server, name: namespaced.slice(i + NAMESPACE_SEP.length) };
  }

  /**
   * Call a tool by its namespaced name. `acting_person_id` always comes from the caller (the
   * request's persona), overriding anything in `args`; the token is supplied only by the confirm
   * route. Transport failures become a structured `TOOL_UNAVAILABLE`, never an exception.
   */
  async call(namespaced: string, args: Record<string, unknown>, ctx: { acting_person_id: string | null; confirmation_token?: string }): Promise<ToolCallResult> {
    const started = Date.now();
    const split = McpToolClient.split(namespaced);
    if (!split) return { ok: false, status: 'TOOL_ERROR', server: 'policy', message: `unknown tool ${namespaced}`, duration_ms: 0 };
    const { server, name } = split;
    if (this.isDisabled(server)) {
      return { ok: false, status: 'TOOL_UNAVAILABLE', server, message: `${server} MCP server is disabled (CHAOS_DISABLE_HR_MCP)`, duration_ms: Date.now() - started };
    }
    const finalArgs: Record<string, unknown> = { ...args, acting_person_id: ctx.acting_person_id };
    delete finalArgs.confirmation_token;
    if (ctx.confirmation_token) finalArgs.confirmation_token = ctx.confirmation_token;

    try {
      const client = await this.connect(server);
      const res = await client.callTool({ name, arguments: finalArgs }, undefined, { timeout: this.timeoutMs });
      const duration_ms = Date.now() - started;
      if (res.isError) {
        const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
        return { ok: false, status: 'TOOL_ERROR', server, message: text || 'tool returned an error', duration_ms };
      }
      if (res.structuredContent) return { ok: true, result: res.structuredContent, duration_ms };
      const first = (res.content as { type: string; text?: string }[])[0];
      return { ok: true, result: first?.text ? safeJson(first.text) : null, duration_ms };
    } catch (err) {
      this.clients.delete(server);
      return { ok: false, status: 'TOOL_UNAVAILABLE', server, message: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - started };
    }
  }

  /** PRD §6.3: re-run `list_tools` on each server with a 3s timeout. */
  async health(): Promise<Record<ServerName, ServerHealth>> {
    const out = {} as Record<ServerName, ServerHealth>;
    await Promise.all(
      SERVER_NAMES.map(async (server) => {
        if (this.isDisabled(server)) {
          out[server] = { status: 'disabled', tools: 0, latency_ms: null };
          return;
        }
        const started = Date.now();
        try {
          const client = await this.connect(server);
          const { tools } = await client.listTools(undefined, { timeout: 3_000 });
          out[server] = { status: 'connected', tools: tools.length, latency_ms: Date.now() - started };
        } catch (err) {
          this.clients.delete(server);
          out[server] = { status: 'down', tools: 0, latency_ms: null, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    return out;
  }

  /**
   * The host's read-only HTTP surface -- /health, /desk and the Handbook browse routes -- proxied so
   * the app never opens the index or the desk file itself. Not the MCP request path.
   *
   * A non-2xx carries the host's status and parsed body on the thrown error, so a caller can pass a
   * structured NOT_FOUND / FORBIDDEN_AUDIENCE through instead of flattening it to a 503.
   */
  async hostGet<T = unknown>(path: HostPath): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, { headers: { [MCP_SECRET_HEADER]: this.opts.secret }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      throw Object.assign(new Error(`${path} -> ${res.status}`), { status: res.status, body });
    }
    return (await res.json()) as T;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }

  private async connect(server: ServerName): Promise<Client> {
    const existing = this.clients.get(server);
    if (existing) return existing;
    const transport = new StreamableHTTPClientTransport(new URL(this.urlFor(server)), {
      requestInit: { headers: { [MCP_SECRET_HEADER]: this.opts.secret } },
    });
    const client = new Client({ name: 'westline-app', version: '0.1.0' });
    await client.connect(transport);
    this.clients.set(server, client);
    return client;
  }
}

function toDiscovered(server: ServerName, t: McpTool): DiscoveredTool {
  const namespaced = `${server}${NAMESPACE_SEP}${t.name}`;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespaced)) throw new Error(`tool name ${namespaced} is not Anthropic-safe`);
  return {
    namespaced,
    server,
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema as Record<string, unknown>,
    gated: GATED_TOOLS.has(namespaced),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
