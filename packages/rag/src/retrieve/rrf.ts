export interface Ranked {
  chunk_id: string;
  score: number;
}

/** Standard RRF constant; dampens the advantage of a single top rank. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion over ranked lists. Only ranks matter, so BM25's unbounded scores and the
 * vector search's cosine distances need no calibration against each other. Ties are broken by
 * chunk id so the fused order is deterministic.
 */
export function rrfFuse(lists: readonly (readonly Ranked[])[], k = RRF_K): Ranked[] {
  const fused = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      fused.set(item.chunk_id, (fused.get(item.chunk_id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...fused.entries()]
    .map(([chunk_id, score]) => ({ chunk_id, score }))
    .sort((a, b) => b.score - a.score || a.chunk_id.localeCompare(b.chunk_id));
}
