/**
 * Semantic citation verification (PRD §7.1 VERIFY, ADR 0019).
 *
 * Structural verification asks "was this chunk retrieved this turn?". This package asks the second
 * question -- "does the cited passage support the fact?" -- as one calibrated Choice per (fact,
 * citation) pair. The verifier is a dependency of `apps/server`, like the Anthropic client; it is
 * not an MCP tool. Code owns the threshold and the decision rules; the model only reports a relation.
 */

export const SEMANTIC_VERIFY_PROVIDERS = ['typesafe', 'stub', 'off'] as const;
export type SemanticVerifyProviderId = (typeof SEMANTIC_VERIFY_PROVIDERS)[number];

export const RELATIONS = ['supports', 'contradicts', 'says_nothing'] as const;
export type Relation = (typeof RELATIONS)[number];

/**
 * The question, mirroring TypeSafe's citation-check cookbook. Question ids are not sent to the
 * model, so the instructions name the state paths in full. Wording is recorded in ADR 0019.
 */
export const RELATION_CRITERIA: Record<Relation, string> = {
  supports: 'The passage states the claim or directly implies that it is true.',
  contradicts: 'The passage states the opposite of the claim or implies it is false.',
  says_nothing: 'The passage does not address what the claim asserts, either way.',
};

export const relationInstructions = (passageKey: string): string =>
  `How does the passage at \`passages.${passageKey}\` relate to the claim at \`claim\`?`;

/** One cited passage: the full chunk text, never the 240-character snippet when text is available. */
export interface Passage {
  /** Caller's identifier (the chunk id); echoed back on the verdict. */
  id: string;
  /** Human-readable origin, e.g. `PTO §3.2 · Paid Time Off & Statutory Holidays`. */
  source: string;
  text: string;
}

export interface Verdict {
  passage_id: string;
  relation: Relation;
  probabilities: Record<Relation, number>;
  confidence: number;
}

export interface RelateResult {
  verdicts: Verdict[];
  /** The model that answered (e.g. `jev-1.13.0`), or null when no model ran. */
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

export interface SemanticVerifier {
  readonly id: Exclude<SemanticVerifyProviderId, 'off'>;
  /** Configured model alias, for the trace. */
  readonly model: string | null;
  /** Judge every passage against the claim in one request. Throws `SemanticVerifyError` on failure. */
  relate(claim: string, passages: Passage[]): Promise<RelateResult>;
}

export class SemanticVerifyError extends Error {
  readonly status: number | undefined;
  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'SemanticVerifyError';
    this.status = opts.status;
  }
}

const isRelation = (v: unknown): v is Relation => typeof v === 'string' && (RELATIONS as readonly string[]).includes(v);

/** Validate one Choice answer from the API into a `Verdict`; malformed answers are errors, never guesses. */
export function parseChoiceAnswer(passage_id: string, answer: unknown): Verdict {
  if (!answer || typeof answer !== 'object') throw new SemanticVerifyError(`malformed answer for ${passage_id}: not an object`);
  const a = answer as Record<string, unknown>;
  if (a.type !== 'choice') throw new SemanticVerifyError(`malformed answer for ${passage_id}: type ${String(a.type)}`);
  if (!isRelation(a.choice)) throw new SemanticVerifyError(`malformed answer for ${passage_id}: choice ${String(a.choice)}`);
  const probs = a.probabilities;
  if (!probs || typeof probs !== 'object') throw new SemanticVerifyError(`malformed answer for ${passage_id}: no probabilities`);
  const p = probs as Record<string, unknown>;
  const probabilities = {} as Record<Relation, number>;
  for (const r of RELATIONS) {
    const v = p[r];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SemanticVerifyError(`malformed answer for ${passage_id}: probability ${r}`);
    probabilities[r] = v;
  }
  const confidence = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : probabilities[a.choice];
  return { passage_id, relation: a.choice, probabilities, confidence };
}
