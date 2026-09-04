import { bm25ProcessTerm, bm25Tokenize } from '../store/bm25.js';

export interface RewriteResult {
  query: string;
  rewritten: boolean;
}

/** Openers that mark a question as leaning on the previous turn for its subject. */
const ANAPHORIC =
  /^(and|also|what about|how about|same (for|with)|(and )?(what|how) (if|for|about)|(does|is|do) (it|that|this)|(it|that|this) )/i;

/**
 * Follow-up rewriting without a model, so the tool stays deterministic and offline. A query is
 * treated as a follow-up when it opens anaphorically or carries too few content terms to stand on
 * its own; the content terms of the most recent prior query are then appended, minus any it already
 * has. "what about five days" after "how much notice for a three day vacation" becomes
 * "what about five days notice three day vacation", which BM25 and the embedder can both use.
 */
export function rewriteFollowUp(
  query: string,
  priorQueries: readonly string[] | undefined,
): RewriteResult {
  const prior = priorQueries?.filter((q) => q.trim().length > 0).at(-1);
  if (!prior) return { query, rewritten: false };

  const own = contentTerms(query);
  const isFollowUp = ANAPHORIC.test(query.trim()) || own.length < 3;
  if (!isFollowUp) return { query, rewritten: false };

  const seen = new Set(own.map((t) => bm25ProcessTerm(t) ?? t));
  const carried = contentTerms(prior).filter((t) => {
    const key = bm25ProcessTerm(t) ?? t;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (carried.length === 0) return { query, rewritten: false };
  return { query: `${query.trim()} ${carried.join(' ')}`, rewritten: true };
}

function contentTerms(text: string): string[] {
  return bm25Tokenize(text).filter((t) => bm25ProcessTerm(t) !== null);
}
