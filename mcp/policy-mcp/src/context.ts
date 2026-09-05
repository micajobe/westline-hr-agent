import { resolve } from 'node:path';
import {
  IndexStore,
  Retriever,
  buildIndex,
  chunkStrategyFromEnv,
  createEmbeddingProvider,
  loadCorpus,
  parseApplicabilityMatrix,
  parseCategories,
  type ApplicabilityMatrix,
  type PolicyCategory,
  type EmbeddingProvider,
} from '@westline/rag';
import { PeopleDirectory } from '@westline/shared';

/** Everything the policy tools need. Built once per process; tests build one per suite. */
export interface PolicyContext {
  store: IndexStore;
  retriever: Retriever;
  provider: EmbeddingProvider;
  /** Resolves `acting_person_id` to a viewer (class + scope). The only identity source. */
  people: PeopleDirectory;
  applicability: ApplicabilityMatrix;
  /** HANDBOOK §4 "Who owns what" -- the browse taxonomy behind the Handbook tab. */
  categories: PolicyCategory[];
  /** `RERANK=true` -- the LLM reranker ablation. Reported in every search result. */
  rerank: boolean;
  /** Eval ablations (PRD §12.3): force `k` and/or retrieval mode for every search, whatever the model asked for. */
  overrides: { k?: number; mode?: 'hybrid' | 'vector' | 'bm25' };
}

export interface PolicyContextInit {
  store: IndexStore;
  provider: EmbeddingProvider;
  people: PeopleDirectory;
  rerank?: boolean;
  overrides?: PolicyContext['overrides'];
}

/** From already-open pieces (tests pass an in-memory index). */
export function createPolicyContext(init: PolicyContextInit): PolicyContext {
  const handbook = init.store.getDocument('HANDBOOK');
  if (!handbook) throw new Error('index has no HANDBOOK document; cannot build the applicability matrix');
  return {
    store: init.store,
    provider: init.provider,
    people: init.people,
    retriever: new Retriever(init.store, init.provider),
    applicability: parseApplicabilityMatrix(handbook),
    categories: parseCategories(handbook),
    rerank: init.rerank ?? false,
    overrides: init.overrides ?? {},
  };
}

export interface PolicyContextEnv {
  EMBEDDING_PROVIDER?: string;
  VOYAGE_API_KEY?: string;
  VOYAGE_MODEL?: string;
  INDEX_PATH?: string;
  CORPUS_DIR?: string;
  MOCK_DATA_DIR?: string;
  RERANK?: string;
  ALLOW_STUB_INDEX?: string;
  CHUNK_STRATEGY?: string;
  RETRIEVAL_K_OVERRIDE?: string;
  RETRIEVAL_MODE_OVERRIDE?: string;
}

/**
 * Production path: open `data/index.sqlite`, building it first if absent or stale (PRD §10 --
 * `policy-mcp` owns the index). Same hash gate as `npm run index:build`, so a warm redeploy with an
 * unchanged corpus opens in milliseconds and a corpus change rebuilds automatically.
 */
export async function createPolicyContextFromEnv(
  env: PolicyContextEnv = process.env,
  repoRoot = process.cwd(),
  log: (msg: string) => void = () => {},
): Promise<PolicyContext> {
  const provider = createEmbeddingProvider(env);
  const docs = await loadCorpus(resolve(repoRoot, env.CORPUS_DIR ?? 'corpus'), repoRoot);
  const result = await buildIndex({
    docs,
    provider,
    dbPath: resolve(repoRoot, env.INDEX_PATH ?? 'data/index.sqlite'),
    allowStub: env.ALLOW_STUB_INDEX === '1',
    strategy: chunkStrategyFromEnv(env),
    log,
  });
  const people = PeopleDirectory.load(
    resolve(repoRoot, env.MOCK_DATA_DIR ?? 'mock_data', 'people.json'),
  );
  return createPolicyContext({
    store: result.store,
    provider,
    people,
    rerank: env.RERANK === 'true',
    overrides: {
      ...(env.RETRIEVAL_K_OVERRIDE ? { k: Number(env.RETRIEVAL_K_OVERRIDE) } : {}),
      ...(env.RETRIEVAL_MODE_OVERRIDE ? { mode: parseMode(env.RETRIEVAL_MODE_OVERRIDE) } : {}),
    },
  });
}

function parseMode(v: string): 'hybrid' | 'vector' | 'bm25' {
  if (v === 'hybrid' || v === 'vector' || v === 'bm25') return v;
  throw new Error(`RETRIEVAL_MODE_OVERRIDE must be hybrid, vector or bm25, got "${v}"`);
}
