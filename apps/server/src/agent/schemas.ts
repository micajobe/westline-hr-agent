import { z } from 'zod';
import { ESCALATION_TARGETS } from '@westline/shared';

/** PRD §7.1 PLAN output. */
export const PlanSchema = z.object({
  intent: z.enum(['policy_question', 'workflow', 'out_of_scope', 'sensitive', 'smalltalk']),
  entities: z.object({
    person_refs: z.array(z.string()).default([]),
    dates: z.array(z.string()).default([]),
    locations: z.array(z.string()).default([]),
    amounts: z.array(z.string()).default([]),
    policy_areas: z.array(z.string()).default([]),
  }).default({}),
  needs_clarification: z.boolean().default(false),
  clarifying_question: z.string().optional(),
  rag_only: z.boolean().default(false),
  expected_tools: z.array(z.string()).default([]),
  escalation_hint: z.enum(ESCALATION_TARGETS).optional(),
  summary: z.string().default(''),
});
export type Plan = z.infer<typeof PlanSchema>;

/** JSON Schema for the `emit_plan` tool the plan step is forced to call. */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'entities', 'needs_clarification', 'rag_only', 'expected_tools', 'summary'],
  properties: {
    intent: { type: 'string', enum: ['policy_question', 'workflow', 'out_of_scope', 'sensitive', 'smalltalk'], description: 'workflow = needs HR data or a mutating action; sensitive = harassment, safety incident, discrimination; out_of_scope = not answerable from Westline policy (e.g. individual compensation outcomes).' },
    entities: {
      type: 'object', additionalProperties: false,
      properties: {
        person_refs: { type: 'array', items: { type: 'string' }, description: 'Names or references to people other than the acting person.' },
        dates: { type: 'array', items: { type: 'string' } },
        locations: { type: 'array', items: { type: 'string' } },
        amounts: { type: 'array', items: { type: 'string' } },
        policy_areas: { type: 'array', items: { type: 'string' }, description: 'Short policy-area phrases, e.g. "PTO notice periods", "drone approval".' },
      },
      required: ['person_refs', 'dates', 'locations', 'amounts', 'policy_areas'],
    },
    needs_clarification: { type: 'boolean', description: 'true when the question cannot be answered without information only the user can give (who they are, duration, place, which of several people).' },
    clarifying_question: { type: 'string', description: 'The single question to ask, when needs_clarification is true.' },
    rag_only: { type: 'boolean', description: 'true when policy search alone answers it and no HR data tool is needed.' },
    expected_tools: { type: 'array', items: { type: 'string' }, description: 'Namespaced tool names you expect to call, in order.' },
    escalation_hint: { type: 'string', enum: [...ESCALATION_TARGETS] },
    summary: { type: 'string', description: 'One operational sentence: what will be done. No reasoning.' },
  },
} as const;

const citation = {
  type: 'object', additionalProperties: false,
  required: ['chunk_id', 'doc_id', 'title', 'section_path', 'snippet'],
  properties: {
    chunk_id: { type: 'string', description: 'Exactly as returned by a policy tool this turn.' },
    doc_id: { type: 'string' }, title: { type: 'string' }, section_path: { type: 'string' }, snippet: { type: 'string' },
  },
} as const;

/** JSON Schema for the `emit_answer` tool (PRD §7.3). */
export const ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer_markdown', 'policy_facts', 'recommendations', 'applicability', 'actions_proposed', 'actions_taken', 'escalation', 'clarification', 'withheld_by_audience'],
  properties: {
    answer_markdown: { type: 'string', description: 'Short conversational answer in markdown. State what the policy says (cited below) separately from what you recommend. Never invent policy.' },
    policy_facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'statement', 'citations'], properties: {
      id: { type: 'string', description: 'f1, f2, …' },
      statement: { type: 'string', description: 'One factual statement of what a policy says, with the figure or rule.' },
      citations: { type: 'array', minItems: 1, items: citation },
    } } },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'basis_fact_ids'], properties: {
      text: { type: 'string' },
      basis_fact_ids: { type: 'array', items: { type: 'string' }, description: 'ids of the policy_facts this rests on. A recommendation with no basis is dropped.' },
    } } },
    applicability: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['workforce_class', 'note'], properties: {
      workforce_class: { type: 'string' }, note: { type: 'string' }, citation: { anyOf: [{ type: 'null' }, citation] },
    } }] },
    actions_proposed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tool', 'args', 'args_hash'], properties: {
      tool: { type: 'string' }, args: { type: 'object' }, args_hash: { type: 'string' },
    } } },
    actions_taken: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tool', 'result_summary', 'ref_id'], properties: {
      tool: { type: 'string' }, result_summary: { type: 'string' }, ref_id: { type: 'string' },
    } } },
    escalation: { type: 'object', additionalProperties: false, required: ['target', 'reason'], properties: {
      target: { type: 'string', enum: [...ESCALATION_TARGETS] }, reason: { type: 'string' },
    } },
    clarification: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string' } } }] },
    withheld_by_audience: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['doc_ids', 'explanation'], properties: {
      doc_ids: { type: 'array', items: { type: 'string' } }, explanation: { type: 'string' },
    } }] },
  },
} as const;
