import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RECIPIENT_ROLES, TICKET_CATEGORIES } from '@westline/shared';
import type { HrContext } from './context.js';
import { createMockHrTicket, draftHrEmail } from './tools/actions.js';
import { lookupBenefitsStatus } from './tools/benefits.js';
import { checkPtoBalance } from './tools/pto.js';
import { lookupPersonProfile } from './tools/profile.js';

export const HR_TOOL_NAMES = [
  'lookup_person_profile',
  'check_pto_balance',
  'lookup_benefits_status',
  'create_mock_hr_ticket',
  'draft_hr_email',
] as const;

const actingPersonId = z.string().nullable().describe('Who is asking. null means anonymous.');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Structured JSON result, never prose (CLAUDE.md). */
function json(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

export function createHrDataServer(ctx: HrContext): McpServer {
  const server = new McpServer({ name: 'westline-hr-data', version: '0.1.0' });

  server.registerTool(
    'lookup_person_profile',
    {
      title: 'Look up a person',
      description:
        'Profile of a Westline person by id or name; with neither, the acting person. Scope: self sees self, managers see direct reports, HR partners see anyone.',
      inputSchema: {
        acting_person_id: actingPersonId,
        person_id: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async (args) => json(lookupPersonProfile(ctx, args)),
  );

  server.registerTool(
    'check_pto_balance',
    {
      title: 'Check PTO balance',
      description:
        'PTO balance and, given a request, whether it fits, the notice required under PTO §3, and any blackout collision. Staff only; NOT_APPLICABLE for contractors and creator partners.',
      inputSchema: {
        acting_person_id: actingPersonId,
        person_id: z.string(),
        requested_days: z.number().positive().optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.optional(),
      },
    },
    async (args) => json(checkPtoBalance(ctx, args)),
  );

  server.registerTool(
    'lookup_benefits_status',
    {
      title: 'Look up benefits status',
      description:
        'Benefits eligibility and enrolment. Visible to the person themselves and HR partners only.',
      inputSchema: { acting_person_id: actingPersonId, person_id: z.string() },
    },
    async (args) => json(lookupBenefitsStatus(ctx, args)),
  );

  server.registerTool(
    'create_mock_hr_ticket',
    {
      title: 'Create a mock HR ticket (gated)',
      description:
        'Opens a mock ticket on the HR desk. Requires a confirmation_token; without one it returns CONFIRMATION_REQUIRED and does nothing.',
      inputSchema: {
        acting_person_id: actingPersonId,
        about_person_id: z.string(),
        category: z.enum(TICKET_CATEGORIES),
        summary: z.string().min(1).max(200),
        details: z.string().max(2000).optional(),
        confirmation_token: z.string().optional(),
      },
    },
    async (args) => json(createMockHrTicket(ctx, args)),
  );

  server.registerTool(
    'draft_hr_email',
    {
      title: 'Draft an email (gated, never sent)',
      description:
        'Drafts an email to a role from key points using a fixed template. Requires a confirmation_token; without one it returns CONFIRMATION_REQUIRED and does nothing. Never sends.',
      inputSchema: {
        acting_person_id: actingPersonId,
        about_person_id: z.string(),
        recipient_role: z.enum(RECIPIENT_ROLES),
        purpose: z.string().min(1).max(200),
        key_points: z.array(z.string().min(1)).min(1).max(10),
        confirmation_token: z.string().optional(),
      },
    },
    async (args) => json(draftHrEmail(ctx, args)),
  );

  return server;
}
