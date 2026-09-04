import Anthropic from '@anthropic-ai/sdk';
import type { ChunkResolver } from './chunks.js';
import type { Envelope, EvalItem } from './types.js';

export interface GroundednessResult { per_fact: number[]; mean: number | null; fully_supported_pct: number | null; rationales: string[] }

/**
 * The LLM judge (PRD §12.2): Opus, temperature 0, tool-forced JSON. Groundedness is scored per
 * policy_fact against the *text of the chunks it cites*, 0/1/2 (unsupported / partial / fully
 * supported); answer match is 0 / 0.5 / 1 against the gold answer. Human calibration uses the same
 * 0–2 scale (evaluation/human_scores.json).
 */
export class Judge {
  private readonly client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  async groundedness(env: Envelope, chunks: ChunkResolver): Promise<GroundednessResult> {
    const facts = env.answer.policy_facts;
    if (facts.length === 0) return { per_fact: [], mean: null, fully_supported_pct: null, rationales: [] };
    const blocks: string[] = [];
    for (const f of facts) {
      const evidence: string[] = [];
      for (const c of f.citations) {
        const text = await chunks.textFor(c.chunk_id);
        evidence.push(`[${c.chunk_id}]\n${text ?? '(chunk text not found — treat as no evidence)'}`);
      }
      blocks.push(`FACT ${f.id}: ${f.statement}\nEVIDENCE:\n${evidence.join('\n---\n')}`);
    }
    const res = await this.client.messages.create({
      model: this.model, max_tokens: 2048,
      system: 'You are a strict fact-checker for an HR policy assistant. For each FACT, decide whether it is supported by its EVIDENCE alone. 2 = every claim in the fact (including every number, threshold and condition) is stated in the evidence; 1 = the gist is supported but some detail is missing, softened or slightly off; 0 = the evidence does not support the fact or contradicts it. Do not use outside knowledge. Judge only what is written.',
      messages: [{ role: 'user', content: blocks.join('\n\n=====\n\n') }],
      tools: [{ name: 'score_facts', description: 'Record one score per fact, in order.', input_schema: { type: 'object', additionalProperties: false, required: ['scores'], properties: { scores: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fact_id', 'score', 'rationale'], properties: { fact_id: { type: 'string' }, score: { type: 'integer', enum: [0, 1, 2] }, rationale: { type: 'string' } } } } } } }],
      tool_choice: { type: 'tool', name: 'score_facts' },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    const scores = (block && block.type === 'tool_use' ? (block.input as { scores: { fact_id: string; score: number; rationale: string }[] }).scores : []) ?? [];
    const per_fact = facts.map((f) => scores.find((s) => s.fact_id === f.id)?.score ?? 0);
    const rationales = facts.map((f) => scores.find((s) => s.fact_id === f.id)?.rationale ?? 'no score returned');
    return { per_fact, mean: per_fact.reduce((a, b) => a + b, 0) / per_fact.length, fully_supported_pct: per_fact.filter((s) => s === 2).length / per_fact.length, rationales };
  }

  async answerMatch(item: EvalItem, env: Envelope): Promise<{ score: number; rationale: string }> {
    const res = await this.client.messages.create({
      model: this.model, max_tokens: 512,
      system: 'You compare an assistant answer to a gold answer for an HR policy question. Score 1 if the assistant answer conveys the gold answer\'s substantive conclusion and key figures (extra correct detail is fine); 0.5 if it gets the conclusion right but misses or muddles key figures/conditions, or is right on part of a multi-part question; 0 if it contradicts the gold answer, answers a different question, or invents figures. For gold answers describing a behaviour (asking for clarification, refusing, denying, escalating, pausing for confirmation), score on whether the assistant did that behaviour.',
      messages: [{ role: 'user', content: `QUESTION (asked as ${item.acting_person_id ?? 'anonymous'}): ${item.message}\n\nGOLD ANSWER: ${item.gold_answer}\n\nASSISTANT ANSWER: ${env.answer.answer_markdown}\n\nASSISTANT FACTS: ${env.answer.policy_facts.map((f) => `- ${f.statement}`).join('\n') || '(none)'}\nESCALATION: ${env.answer.escalation?.target ?? 'none'}${env.answer.clarification ? `\nCLARIFICATION ASKED: ${env.answer.clarification.question}` : ''}${env.confirmation_required ? `\nPAUSED FOR CONFIRMATION: ${env.confirmation_required.summary}` : ''}${env.answer.withheld_by_audience ? `\nWITHHELD: ${env.answer.withheld_by_audience.explanation}` : ''}` }],
      tools: [{ name: 'score_answer', description: 'Record the match score.', input_schema: { type: 'object', additionalProperties: false, required: ['score', 'rationale'], properties: { score: { type: 'number', enum: [0, 0.5, 1] }, rationale: { type: 'string' } } } }],
      tool_choice: { type: 'tool', name: 'score_answer' },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    const out = block && block.type === 'tool_use' ? (block.input as { score: number; rationale: string }) : { score: 0, rationale: 'no score returned' };
    return out;
  }
}
