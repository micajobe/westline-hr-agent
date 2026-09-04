import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_SECRET_HEADER } from '@westline/mcp-host';
import { startTestHost, type TestHost } from './helpers/mcp.js';

let host: TestHost;
beforeAll(async () => {
  host = await startTestHost();
});
afterAll(() => host.stop());

const EXPECTED = {
  policy: ['search_policy_documents', 'get_policy_section', 'get_policy_applicability', 'check_policy_compliance'],
  hr: ['lookup_person_profile', 'check_pto_balance', 'lookup_benefits_status', 'create_mock_hr_ticket', 'draft_hr_email'],
};

describe('MCP discovery over Streamable HTTP', () => {
  it('exposes exactly nine tools across the two servers, each with a JSON schema', async () => {
    const all: { server: string; name: string; schema: Record<string, unknown> }[] = [];
    for (const server of ['policy', 'hr'] as const) {
      const client = await host.connect(server);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED[server]].sort());
      for (const t of tools) all.push({ server, name: t.name, schema: t.inputSchema as Record<string, unknown> });
    }
    expect(all).toHaveLength(9);

    for (const t of all) {
      expect(t.schema.type, `${t.name} schema type`).toBe('object');
      const props = t.schema.properties as Record<string, unknown>;
      expect(props, `${t.name} has properties`).toBeDefined();
      // PRD §6: every tool takes acting_person_id first; the server resolves scope from it.
      expect(Object.keys(props)[0], `${t.name} first arg`).toBe('acting_person_id');
      expect(t.schema.additionalProperties, `${t.name} additionalProperties`).toBe(false);
    }
  });

  it('describes every tool so the model can select without guessing', async () => {
    const client = await host.connect('hr');
    const { tools } = await client.listTools();
    for (const t of tools) expect((t.description ?? '').length, t.name).toBeGreaterThan(40);
    const gated = tools.filter((t) => ['create_mock_hr_ticket', 'draft_hr_email'].includes(t.name));
    for (const t of gated) expect(t.description).toMatch(/CONFIRMATION_REQUIRED/);
  });

  it('refuses requests without the shared secret', async () => {
    const res = await fetch(host.urls.hr, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    const wrong = await fetch(host.urls.hr, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [MCP_SECRET_HEADER]: 'nope' },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
    await expect(host.connect('policy', 'wrong-secret')).rejects.toThrow();
  });

  it('reports both servers and the index on /health', async () => {
    const health = (await (await fetch(`${host.url}/health`)).json()) as Record<string, any>;
    expect(health.status).toBe('ok');
    expect(health.servers.policy.tools).toHaveLength(4);
    expect(health.servers.hr.tools).toHaveLength(5);
    expect(health.index.chunk_count).toBeGreaterThan(300);
    expect(health.index.corpus_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serves 503 for a disabled server so the client sees TOOL_UNAVAILABLE, not a hang', async () => {
    const chaos = await startTestHost({ disabled: { hr: true } });
    try {
      await expect(chaos.connect('hr')).rejects.toThrow();
      const client = await chaos.connect('policy');
      expect((await client.listTools()).tools).toHaveLength(4);
    } finally {
      await chaos.stop();
    }
  });
});
