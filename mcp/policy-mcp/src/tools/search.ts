import type { RetrievalMode, RetrievedChunk } from '@westline/rag';
import type { PolicyContext } from '../context.js';

export interface SearchArgs {
  acting_person_id: string | null;
  query: string;
  k?: number;
  doc_ids?: string[];
  section_prefix?: string;
  prior_queries?: string[];
  mode?: RetrievalMode;
}

export interface SearchResult {
  results: RetrievedChunk[];
  withheld_by_audience: boolean;
  withheld_doc_ids: string[];
  retrieval: {
    mode: RetrievalMode;
    k: number;
    rerank: boolean;
    rewritten_query?: string;
    candidates_considered: number;
    candidates_after_audience_filter: number;
  };
  viewer: { workforce_class: string | null; scope: string | null };
}

/**
 * `search_policy_documents`. The acting person is resolved to a viewer *here*, inside the server,
 * and the retriever filters by audience before ranking. An unknown or missing id is anonymous and
 * sees `all`-audience material only.
 */
export async function searchPolicyDocuments(
  ctx: PolicyContext,
  args: SearchArgs,
): Promise<SearchResult> {
  const viewer = ctx.people.viewer(args.acting_person_id);
  const response = await ctx.retriever.search({
    viewer,
    query: args.query,
    k: ctx.overrides.k ?? args.k,
    mode: ctx.overrides.mode ?? args.mode,
    doc_ids: args.doc_ids,
    section_prefix: args.section_prefix,
    prior_queries: args.prior_queries,
    rerank: ctx.rerank,
  });
  return {
    ...response,
    retrieval: { ...response.retrieval, rerank: ctx.rerank, ...(Object.keys(ctx.overrides).length ? { overrides: ctx.overrides } : {}) },
    viewer,
  };
}
