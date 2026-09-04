import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PeopleDirectory } from '@westline/shared';
import { StubEmbeddingProvider, buildIndex, loadCorpus } from '@westline/rag';
import { createPolicyContext, type PolicyContext } from '@westline/policy-mcp';
import { DeskStore, createHrContext, loadHrData, type HrContext } from '@westline/hr-data-mcp';
import { MCP_SECRET_HEADER, startMcpHost, type McpHost, type McpServerName } from '@westline/mcp-host';
import { CORPUS_DIR, MOCK_DIR } from './corpus.js';

export const TEST_SECRET = 'test-shared-secret-0123456789abcdef';

export interface TestHost extends McpHost {
  policy: PolicyContext;
  hr: HrContext;
  /** Open an MCP client session against one of the two servers. */
  connect(server: McpServerName, secret?: string): Promise<Client>;
  /** Call a tool and return its structured JSON result. */
  call<T = Record<string, unknown>>(server: McpServerName, tool: string, args: Record<string, unknown>): Promise<T>;
  stop(): Promise<void>;
}

/**
 * Both MCP servers on a loopback port with an in-memory stub index and an in-memory desk -- the
 * full HTTP transport, the shared-secret check and the real tool code, with no API keys and no
 * files on disk.
 */
export async function startTestHost(opts: { disabled?: Partial<Record<McpServerName, boolean>>; now?: () => Date } = {}): Promise<TestHost> {
  const provider = new StubEmbeddingProvider();
  const docs = await loadCorpus(CORPUS_DIR, process.cwd());
  const { store } = await buildIndex({ docs, provider, dbPath: ':memory:', allowStub: true });
  const people = PeopleDirectory.load(`${MOCK_DIR}/people.json`);
  const policy = createPolicyContext({ store, provider, people });

  const desk = DeskStore.open(':memory:');
  desk.seed(`${MOCK_DIR}/tickets.seed.json`);
  const hr = createHrContext({ data: loadHrData(MOCK_DIR), desk, secret: TEST_SECRET, now: opts.now });

  const host = await startMcpHost({ policy, hr, secret: TEST_SECRET, disabled: opts.disabled });
  const clients: Client[] = [];

  const connect = async (server: McpServerName, secret = TEST_SECRET) => {
    const transport = new StreamableHTTPClientTransport(new URL(host.urls[server]), {
      requestInit: { headers: { [MCP_SECRET_HEADER]: secret } },
    });
    const client = new Client({ name: 'westline-test', version: '0.0.0' });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  const cache = new Map<McpServerName, Client>();
  const call = async <T,>(server: McpServerName, tool: string, args: Record<string, unknown>): Promise<T> => {
    let client = cache.get(server);
    if (!client) {
      client = await connect(server);
      cache.set(server, client);
    }
    const res = await client.callTool({ name: tool, arguments: args });
    if (res.structuredContent) return res.structuredContent as T;
    const content = res.content as { type: string; text?: string }[];
    return JSON.parse(content[0]?.text ?? 'null') as T;
  };

  return {
    ...host,
    policy,
    hr,
    connect,
    call,
    stop: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
      await host.close();
      store.close();
      desk.close();
    },
  };
}

export const P = {
  jordan: 'W-1042',
  priya: 'W-1020',
  samOkafor: 'W-1001',
  dani: 'W-3010',
  marcus: 'W-2010',
  avery: 'W-1043',
  taylor: 'W-1044',
  riley: 'W-1045',
  noor: 'W-1003',
} as const;
