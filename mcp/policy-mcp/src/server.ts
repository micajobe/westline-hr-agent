import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WORKFORCE_CLASSES } from '@westline/shared';
import type { PolicyContext } from './context.js';
import { getPolicyApplicability } from './tools/applicability.js';
import { checkPolicyCompliance } from './tools/compliance.js';
import { searchPolicyDocuments } from './tools/search.js';
import { getPolicySectionTool } from './tools/section.js';

export const POLICY_TOOL_NAMES = [
  'search_policy_documents',
  'get_policy_section',
  'get_policy_applicability',
  'check_policy_compliance',
] as const;

const actingPersonId = z.string().nullable().describe('Who is asking. null means anonymous (audience `all` only).');

/** Structured JSON result, never prose (CLAUDE.md). */
function json(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

export function createPolicyServer(ctx: PolicyContext): McpServer {
  const server = new McpServer({ name: 'westline-policy', version: '0.1.0' });

  server.registerTool(
    'search_policy_documents',
    {
      title: 'Search policy documents',
      description:
        'Hybrid (BM25 + vector) search over the Westline policy corpus, filtered to the documents the acting person is allowed to read before ranking. Returns cited chunks; withheld_by_audience is true when a restricted document would otherwise have ranked.',
      inputSchema: {
        acting_person_id: actingPersonId,
        query: z.string().min(1).max(500),
        k: z.number().int().min(1).max(20).optional().describe('Results to return; default 6.'),
        doc_ids: z.array(z.string()).max(14).optional().describe('Restrict to these doc_ids, e.g. ["PTO"].'),
        section_prefix: z.string().optional().describe('Restrict to a section subtree, e.g. "§3".'),
        prior_queries: z.array(z.string()).max(5).optional().describe('Earlier queries in this conversation, for follow-up rewriting.'),
      },
    },
    async (args) => json(await searchPolicyDocuments(ctx, args)),
  );

  server.registerTool(
    'get_policy_section',
    {
      title: 'Get a policy section',
      description:
        'Full text of one numbered section, e.g. doc_id "EXPENSE", section_path "§7". Returns NOT_FOUND or FORBIDDEN_AUDIENCE as structured errors.',
      inputSchema: {
        acting_person_id: actingPersonId,
        doc_id: z.string().min(2).max(20),
        section_path: z.string().regex(/^§?\d+(\.\d+)*$/, 'like §3.2 or 3.2'),
      },
    },
    async (args) => json(getPolicySectionTool(ctx, args)),
  );

  server.registerTool(
    'get_policy_applicability',
    {
      title: 'Which policies apply to a workforce class',
      description:
        'The HANDBOOK §2 applicability matrix for a workforce class (defaults to the acting person\'s class): each document marked full, partial (with sections) or none. Call this before answering a person-specific question.',
      inputSchema: {
        acting_person_id: actingPersonId,
        workforce_class: z.enum(WORKFORCE_CLASSES).optional(),
      },
    },
    async (args) => json(getPolicyApplicability(ctx, args)),
  );

  server.registerTool(
    'check_policy_compliance',
    {
      title: 'Gather compliance evidence for a scenario',
      description:
        'Evidence only, no judgment: for each policy area, the most relevant rule statements with citations and whether each binds the workforce class per HANDBOOK §2. `gaps` lists areas with no evidence.',
      inputSchema: {
        acting_person_id: actingPersonId,
        scenario: z.string().min(1).max(1000),
        policy_areas: z.array(z.string().min(1)).min(1).max(6),
        workforce_class: z.enum(WORKFORCE_CLASSES).optional(),
      },
    },
    async (args) => json(await checkPolicyCompliance(ctx, args)),
  );

  return server;
}
