import { type Passage, type RelateResult, type Relation, type SemanticVerifier, type Verdict } from './provider.js';

/**
 * A deterministic, key-free test double -- the semantic counterpart of `EMBEDDING_PROVIDER=stub`.
 * It is for tests and CI only and must never be used to verify a real answer: it knows nothing
 * about meaning, only about which of the claim's content words appear in the passage.
 *
 * Rules (fixed so tests can rely on them):
 *   - `contradicts` (0.90) when the passage contains the claim's content words *and* a negation
 *     marker (`not`, `never`, `cannot`, `no`) within two tokens before one of those words;
 *   - `supports` (0.95) when at least SUPPORT_FRACTION of the claim's content words appear;
 *   - `says_nothing` (0.90) otherwise.
 */
export class StubVerifier implements SemanticVerifier {
  readonly id = 'stub' as const;
  readonly model = 'stub';

  async relate(claim: string, passages: Passage[]): Promise<RelateResult> {
    return { verdicts: passages.map((p) => ({ passage_id: p.id, ...stubRelation(claim, p.text) })), model: this.model, usage: null };
  }
}

export const SUPPORT_FRACTION = 0.6;
const NEGATION_MARKERS = new Set(['not', 'never', 'cannot', 'no']);
const STOPWORDS = new Set(['the', 'and', 'for', 'are', 'but', 'with', 'this', 'that', 'from', 'they', 'their', 'than', 'then', 'all', 'any', 'per', 'when', 'who', 'which', 'has', 'have', 'had', 'into', 'also', 'was', 'were', 'will', 'may', 'can', 'must', 'should', 'its', 'you', 'your', 'our', 'out', 'about', 'after', 'before', 'over', 'under', 'each', 'every', 'both', 'been', 'being', 'does', 'did', 'not', 'never', 'cannot']);

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/** Content words: alphabetic tokens of three or more letters outside the stoplist, plus numbers of two or more digits. */
const contentWords = (s: string): Set<string> => new Set(tokens(s).filter((t) => (/^\d+$/.test(t) ? t.length >= 2 : t.length >= 3 && !STOPWORDS.has(t))));

export function stubRelation(claim: string, passage: string): Omit<Verdict, 'passage_id'> {
  const words = contentWords(claim);
  const passageTokens = tokens(passage);
  const present = new Set(passageTokens.filter((t) => words.has(t)));
  const fraction = words.size === 0 ? 0 : present.size / words.size;
  let relation: Relation = 'says_nothing';
  if (fraction >= SUPPORT_FRACTION) {
    relation = 'supports';
    for (let i = 0; i < passageTokens.length; i++) {
      if (!NEGATION_MARKERS.has(passageTokens[i]!)) continue;
      if (words.has(passageTokens[i + 1] ?? '') || words.has(passageTokens[i + 2] ?? '')) { relation = 'contradicts'; break; }
    }
  }
  const probabilities: Record<Relation, number> =
    relation === 'supports' ? { supports: 0.95, contradicts: 0, says_nothing: 0.05 }
    : relation === 'contradicts' ? { supports: 0.05, contradicts: 0.9, says_nothing: 0.05 }
    : { supports: 0.1, contradicts: 0, says_nothing: 0.9 };
  return { relation, probabilities, confidence: probabilities[relation] };
}
