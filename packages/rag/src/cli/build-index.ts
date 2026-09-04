import { resolve } from 'node:path';
import { createEmbeddingProvider } from '../embed/index.js';
import { loadCorpus } from '../ingest/load.js';
import { buildIndex } from '../store/build.js';

/**
 * `npm run index:build [-- --force]`
 *
 * Env: `EMBEDDING_PROVIDER` (voyage|local|stub), `VOYAGE_API_KEY`, `CORPUS_DIR` (default `corpus`),
 * `INDEX_PATH` (default `data/index.sqlite`), `ALLOW_STUB_INDEX=1` to permit the stub embedder.
 * Idempotent: an unchanged corpus, embedding model and chunker is a no-op (PRD §4.3 step 7).
 */
async function main(): Promise<number> {
  const force = process.argv.includes('--force');
  const repoRoot = process.cwd();
  const corpusDir = resolve(repoRoot, process.env.CORPUS_DIR ?? 'corpus');
  const dbPath = resolve(repoRoot, process.env.INDEX_PATH ?? 'data/index.sqlite');
  const log = (msg: string) => console.error(`[index:build] ${msg}`);

  const provider = createEmbeddingProvider(process.env);
  const docs = await loadCorpus(corpusDir, repoRoot);
  const started = Date.now();
  const result = await buildIndex({
    docs,
    provider,
    dbPath,
    force,
    allowStub: process.env.ALLOW_STUB_INDEX === '1',
    log,
  });
  result.store.close();

  console.log(
    JSON.stringify(
      {
        built: result.built,
        reason: result.reason,
        index_path: dbPath,
        elapsed_ms: Date.now() - started,
        ...result.meta,
      },
      null,
      2,
    ),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[index:build] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
