import { z } from 'zod';
import { ESCALATION_TARGETS } from './domain.js';

/** PRD §7.3. The only shape the agent is allowed to return. */

export const CitationSchema = z.object({
  chunk_id: z.string(),
  doc_id: z.string(),
  title: z.string(),
  section_path: z.string(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const PolicyFactSchema = z.object({
  id: z.string(),
  statement: z.string(),
  citations: z.array(CitationSchema),
});
export type PolicyFact = z.infer<typeof PolicyFactSchema>;

export const RecommendationSchema = z.object({
  text: z.string(),
  basis_fact_ids: z.array(z.string()).default([]),
});

export const ApplicabilitySchema = z.object({
  workforce_class: z.string(),
  note: z.string(),
  citation: CitationSchema.nullable().optional(),
});

export const ActionProposedSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()),
  args_hash: z.string(),
});

export const ActionTakenSchema = z.object({
  tool: z.string(),
  result_summary: z.string(),
  ref_id: z.string(),
});

export const AnswerSchema = z.object({
  answer_markdown: z.string(),
  policy_facts: z.array(PolicyFactSchema).default([]),
  recommendations: z.array(RecommendationSchema).default([]),
  applicability: ApplicabilitySchema.nullable().default(null),
  actions_proposed: z.array(ActionProposedSchema).default([]),
  actions_taken: z.array(ActionTakenSchema).default([]),
  escalation: z
    .object({ target: z.enum(ESCALATION_TARGETS), reason: z.string() })
    .default({ target: 'none', reason: '' }),
  clarification: z.object({ question: z.string() }).nullable().default(null),
  withheld_by_audience: z
    .object({ doc_ids: z.array(z.string()), explanation: z.string() })
    .nullable()
    .default(null),
});
export type Answer = z.infer<typeof AnswerSchema>;

export function emptyAnswer(partial: Partial<Answer> = {}): Answer {
  return AnswerSchema.parse({ answer_markdown: '', ...partial });
}
