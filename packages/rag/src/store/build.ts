import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EmbeddingProvider } from '../embed/provider.js';
import { CHUNKER_VERSION, chunkCorpus, corpusHash } from '../ingest/chunk.js';
import type { IndexMeta, LoadedDocument } from '../types.js';
import { Bm25Index } from './bm25.js';
import { IndexStore } from './sqlite.js';

export interface BuildIndexOptions {
  docs: LoadedDocument[];
  provider: EmbeddingProvider;
  /** `data/index.sqlite` in production; `:memory:` in tests. */
  dbPath: string;
  /** Rebuild even when the existing index matches. */
  force?: boolean;
  /**
   * The stub embedder has no semantics (see `StubEmbeddingProvider`). Building a real index with it
   * is refused unless the caller says so explicitly, which only the test suite should.
   */
  allowStub?: boolean;
  /** Embedding batch size; the provider may batch again internally. */
  batchSize?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface BuildIndexResult {
  built: boolean;
  reason:
    | 'fresh'
    | 'corpus_changed'
    | 'embedding_model_changed'
    | 'chunker_changed'
    | 'forced'
    | 'up_to_date';
  meta: IndexMeta;
  store: IndexStore;
}

/**
 * PRD §4.3 steps 6–8. Idempotent: a second run against an unchanged corpus, embedding model and
 * chunker opens the existing index and does nothing. When a rebuild is needed the new index is
 * written to a sibling temp file and renamed into place, so a crash mid-build (or a Voyage outage)
 * never leaves a half-written file that `IndexStore.open` would accept.
 */
export async function buildIndex(opts: BuildIndexOptions): Promise<BuildIndexResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const { docs, provider, dbPath } = opts;

  if (provider.id === 'stub' && !opts.allowStub) {
    throw new Error(
      'refusing to build an index with EMBEDDING_PROVIDER=stub: it has no semantics. ' +
        'Set ALLOW_STUB_INDEX=1 only for tests.',
    );
  }

  const hash = corpusHash(docs);
  const chunks = chunkCorpus(docs);

  let reason: BuildIndexResult['reason'] = 'fresh';
  if (dbPath !== ':memory:' && IndexStore.exists(dbPath)) {
    const existing = IndexStore.open(dbPath);
    const meta = existing.meta();
    if (opts.force) reason = 'forced';
    else if (meta.corpus_hash !== hash) reason = 'corpus_changed';
    else if (meta.embedding_model !== provider.model) reason = 'embedding_model_changed';
    else if (meta.chunker !== CHUNKER_VERSION) reason = 'chunker_changed';
    else {
      log(`index up to date (${meta.chunk_count} chunks, corpus ${hash.slice(0, 12)})`);
      return { built: false, reason: 'up_to_date', meta, store: existing };
    }
    existing.close();
  }

  log(
    `building index: ${docs.length} docs, ${chunks.length} chunks, ${provider.id}/${provider.model} (${reason})`,
  );
  const vectors: Float32Array[] = [];
  const batchSize = opts.batchSize ?? 64;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    vectors.push(...(await provider.embedDocuments(batch.map((c) => c.text))));
    log(`embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }
  const dimensions = vectors[0]?.length ?? provider.dimensions;
  if (!dimensions) throw new Error('cannot determine embedding dimensions from an empty corpus');

  const meta: IndexMeta = {
    corpus_hash: hash,
    doc_count: docs.length,
    chunk_count: chunks.length,
    embedding_model: provider.model,
    embedding_dimensions: dimensions,
    chunker: CHUNKER_VERSION,
    built_at: now().toISOString(),
  };
  const bm25 = Bm25Index.build(chunks);

  if (dbPath === ':memory:') {
    const store = IndexStore.create(dbPath, dimensions);
    store.write(docs, chunks, vectors, bm25, meta);
    return { built: true, reason, meta, store };
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.building`;
  rmSync(tmp, { force: true });
  const fresh = IndexStore.create(tmp, dimensions);
  try {
    fresh.write(docs, chunks, vectors, bm25, meta);
  } finally {
    fresh.close();
  }
  rmSync(dbPath, { force: true });
  renameSync(tmp, dbPath);
  writeFileSync(metaPath(dbPath), `${JSON.stringify(meta, null, 2)}\n`);
  log(`wrote ${dbPath} (${chunks.length} chunks, ${dimensions} dims)`);
  return { built: true, reason, meta, store: IndexStore.open(dbPath) };
}

/** `data/index.sqlite` → `data/index.meta.json` (PRD §4.3 step 7). */
export function metaPath(dbPath: string): string {
  return dbPath.replace(/\.sqlite$/, '') + '.meta.json';
}
