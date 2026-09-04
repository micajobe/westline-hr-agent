import type { Audience } from '@westline/shared';
import type { EmbeddingProvider } from '../embed/provider.js';
import type { IndexStore } from '../store/sqlite.js';
import type {
  Chunk,
  RetrievalMode,
  RetrievalOptions,
  RetrievalResponse,
  RetrievedChunk,
  Viewer,
} from '../types.js';
import { permittedAudiences } from './audience.js';
import { rewriteFollowUp } from './rewrite.js';
import { rrfFuse, type Ranked } from './rrf.js';

export const DEFAULT_K = 6;
/** Candidates pulled from each ranker before fusion, as a multiple of k. */
export const CANDIDATE_MULTIPLIER = 4;
export const MIN_CANDIDATES = 20;

export interface SearchRequest extends RetrievalOptions {
  viewer: Viewer;
}

interface Constraints {
  audiences?: readonly Audience[];
  doc_ids?: readonly string[];
  section_prefix?: string;
}

/**
 * Hybrid retrieval per PRD §6.1. Both rankers run under the viewer's audience constraint so the
 * top-k is computed over permitted chunks only; an unconstrained run happens alongside and the
 * difference is what `withheld_by_audience` reports. The retriever knows nothing about people --
 * `policy-mcp` resolves `acting_person_id` to a `Viewer` and passes it in.
 */
export class Retriever {
  constructor(
    private readonly store: IndexStore,
    private readonly provider: EmbeddingProvider,
  ) {}

  async search(req: SearchRequest): Promise<RetrievalResponse> {
    const k = Math.max(1, Math.min(50, Math.floor(req.k ?? DEFAULT_K)));
    const mode: RetrievalMode = req.mode ?? 'hybrid';
    const { query, rewritten } = rewriteFollowUp(req.query, req.prior_queries);
    const audiences = permittedAudiences(req.viewer);
    const scope: Constraints = { doc_ids: req.doc_ids, section_prefix: req.section_prefix };

    const queryVec = mode === 'bm25' ? undefined : await this.provider.embedQuery(query);
    const candidateK = Math.max(MIN_CANDIDATES, k * CANDIDATE_MULTIPLIER);

    const permitted = this.rank(query, queryVec, mode, candidateK, { ...scope, audiences });
    const unfiltered = this.rank(query, queryVec, mode, candidateK, scope);

    const top = permitted.fused.slice(0, k);
    const chunks = this.store.getChunks(top.map((r) => r.chunk_id));
    const scoreById = new Map(top.map((r) => [r.chunk_id, r.score]));
    const results: RetrievedChunk[] = chunks.map((c) =>
      toResult(c, scoreById.get(c.chunk_id) ?? 0),
    );

    const allowed = new Set<Audience>(audiences);
    const withheld = new Set<string>();
    for (const c of this.store.getChunks(unfiltered.fused.slice(0, k).map((r) => r.chunk_id))) {
      if (!allowed.has(c.audience)) withheld.add(c.doc_id);
    }

    return {
      results,
      withheld_by_audience: withheld.size > 0,
      withheld_doc_ids: [...withheld].sort(),
      retrieval: {
        mode,
        k,
        rerank: false,
        ...(rewritten ? { rewritten_query: query } : {}),
        candidates_considered: unfiltered.considered,
        candidates_after_audience_filter: permitted.considered,
      },
    };
  }

  private rank(
    query: string,
    queryVec: Float32Array | undefined,
    mode: RetrievalMode,
    candidateK: number,
    c: Constraints,
  ): { fused: Ranked[]; considered: number } {
    const lists: Ranked[][] = [];
    const seen = new Set<string>();

    if (mode !== 'bm25' && queryVec) {
      // section_prefix is not a vec0 metadata column; over-fetch and trim in that one case.
      const fetchK = c.section_prefix ? Math.max(candidateK * 4, 100) : candidateK;
      let hits = this.store.vectorSearch(queryVec, {
        k: fetchK,
        audiences: c.audiences,
        doc_ids: c.doc_ids,
      });
      if (c.section_prefix) {
        const prefix = c.section_prefix;
        const ok = new Set(
          this.store
            .getChunks(hits.map((h) => h.chunk_id))
            .filter((ch) => matchesSection(ch.section_path, prefix))
            .map((ch) => ch.chunk_id),
        );
        hits = hits.filter((h) => ok.has(h.chunk_id)).slice(0, candidateK);
      }
      lists.push(hits.map((h) => ({ chunk_id: h.chunk_id, score: h.score })));
    }

    if (mode !== 'vector') {
      const allowed = c.audiences ? new Set<string>(c.audiences) : undefined;
      const docs = c.doc_ids ? new Set(c.doc_ids) : undefined;
      const hits = this.store.bm25.search(query, {
        k: candidateK,
        filter: (d) =>
          (!allowed || allowed.has(d.audience)) &&
          (!docs || docs.has(d.doc_id)) &&
          (!c.section_prefix || matchesSection(d.section_path, c.section_prefix)),
      });
      lists.push(hits.map((h) => ({ chunk_id: h.chunk_id, score: h.score })));
    }

    for (const l of lists) for (const r of l) seen.add(r.chunk_id);
    // A single list still goes through RRF so scores are comparable across modes in the eval.
    return { fused: rrfFuse(lists), considered: seen.size };
  }
}

export function matchesSection(sectionPath: string, prefix: string): boolean {
  const p = prefix.startsWith('§') ? prefix : `§${prefix}`;
  return sectionPath === p || sectionPath.startsWith(`${p}.`);
}

function toResult(c: Chunk, score: number): RetrievedChunk {
  return {
    chunk_id: c.chunk_id,
    doc_id: c.doc_id,
    title: c.title,
    section_path: c.section_path,
    section_title: c.section_title,
    snippet: c.snippet,
    text: c.text,
    score,
    source_format: c.source_format,
  };
}
