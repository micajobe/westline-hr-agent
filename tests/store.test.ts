import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Bm25Index,
  CHUNKER_VERSION,
  IndexStore,
  StubEmbeddingProvider,
  bm25Tokenize,
  buildIndex,
  chunkCorpus,
  corpusHash,
  loadCorpus,
  metaPath,
  type Chunk,
  type LoadedDocument,
} from '@westline/rag';
import { CORPUS_DIR } from './helpers/corpus.js';

let docs: LoadedDocument[];
let chunks: Chunk[];
let store: IndexStore;
const stub = new StubEmbeddingProvider();
const tmp = mkdtempSync(join(tmpdir(), 'westline-index-'));

beforeAll(async () => {
  docs = await loadCorpus(CORPUS_DIR, process.cwd());
  chunks = chunkCorpus(docs);
  store = (await buildIndex({ docs, provider: stub, dbPath: ':memory:', allowStub: true })).store;
});
afterAll(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('BM25 index', () => {
  it('keeps section references as single tokens', () => {
    expect(bm25Tokenize('See PTO §3.2 and section 3.2, please.')).toEqual([
      'see',
      'pto',
      '§3.2',
      'and',
      'section',
      '3.2',
      'please',
    ]);
  });

  it('finds the PTO notice rule for a plain-language question', () => {
    const hits = store.bm25.search('how much notice for a three day vacation', { k: 5 });
    expect(hits.length).toBe(5);
    expect(hits.slice(0, 3).some((h) => h.chunk_id.startsWith('PTO#§3'))).toBe(true);
  });

  it('filters before the top-k cut, so a filtered search still returns k results', () => {
    const creatorOnly = store.bm25.search('notice for time off', {
      k: 5,
      filter: (d) => d.audience === 'all' || d.audience === 'creator_partners',
    });
    expect(creatorOnly).toHaveLength(5);
    for (const h of creatorOnly) expect(h.chunk_id.startsWith('PTO#')).toBe(false);
  });

  it('survives a JSON round trip', () => {
    const copy = Bm25Index.fromJSON(store.bm25.toJSON());
    expect(copy.size).toBe(chunks.length);
    expect(copy.search('expense claim receipts', { k: 3 })).toEqual(
      store.bm25.search('expense claim receipts', { k: 3 }),
    );
  });
});

describe('SQLite + sqlite-vec store', () => {
  it('holds every chunk and reads them back unchanged', () => {
    expect(store.chunkCount()).toBe(chunks.length);
    expect(store.getChunk('PTO#§3.2#0')).toEqual(chunks.find((c) => c.chunk_id === 'PTO#§3.2#0'));
    expect(store.getChunks(['HANDBOOK#§1.1#0', 'nope', 'PTO#§3#0']).map((c) => c.chunk_id)).toEqual(
      ['HANDBOOK#§1.1#0', 'PTO#§3#0'],
    );
    expect(store.allChunks()).toHaveLength(chunks.length);
  });

  it('records build metadata', () => {
    const meta = store.meta();
    expect(meta.corpus_hash).toBe(corpusHash(docs));
    expect(meta.chunk_count).toBe(chunks.length);
    expect(meta.doc_count).toBe(15);
    expect(meta.embedding_model).toBe(stub.model);
    expect(meta.embedding_dimensions).toBe(stub.dimensions);
    expect(meta.chunker).toBe(CHUNKER_VERSION);
    expect(new Date(meta.built_at).getTime()).toBeGreaterThan(0);
  });

  it('ranks the exact chunk text first with a cosine score of ~1', async () => {
    const target = chunks.find((c) => c.chunk_id === 'PTO#§3.2#0')!;
    const hits = store.vectorSearch(await stub.embedQuery(target.text), { k: 3 });
    expect(hits[0]!.chunk_id).toBe('PTO#§3.2#0');
    expect(hits[0]!.score).toBeCloseTo(1, 4);
    expect(hits[1]!.score).toBeLessThan(hits[0]!.score);
  });

  it('applies audience and doc filters inside the KNN query', async () => {
    const q = await stub.embedQuery('paid time off notice period vacation request');
    const all = store.vectorSearch(q, { k: 10 });
    expect(all.some((h) => h.chunk_id.startsWith('PTO#'))).toBe(true);

    const creator = store.vectorSearch(q, { k: 10, audiences: ['all', 'creator_partners'] });
    expect(creator).toHaveLength(10); // still k results, drawn from permitted chunks only
    for (const h of creator)
      expect(store.getChunk(h.chunk_id)!.audience).toMatch(/^(all|creator_partners)$/);

    const handbookOnly = store.vectorSearch(q, { k: 3, doc_ids: ['HANDBOOK'] });
    for (const h of handbookOnly) expect(h.chunk_id.startsWith('HANDBOOK#')).toBe(true);
    expect(store.vectorSearch(q, { k: 3, audiences: [] })).toEqual([]);
  });
});

describe('buildIndex on disk', () => {
  const dbPath = join(tmp, 'data', 'index.sqlite');

  it('refuses the stub embedder unless explicitly allowed', async () => {
    await expect(buildIndex({ docs, provider: stub, dbPath })).rejects.toThrow(/stub/);
    expect(existsSync(dbPath)).toBe(false);
  });

  it('writes the index and meta json, then no-ops on an unchanged corpus', async () => {
    const first = await buildIndex({ docs, provider: stub, dbPath, allowStub: true });
    expect(first.built).toBe(true);
    expect(first.reason).toBe('fresh');
    first.store.close();
    expect(existsSync(`${dbPath}.building`)).toBe(false);
    expect(JSON.parse(readFileSync(metaPath(dbPath), 'utf8'))).toEqual(first.meta);
    const mtime = statSync(dbPath).mtimeMs;

    const second = await buildIndex({ docs, provider: stub, dbPath, allowStub: true });
    expect(second.built).toBe(false);
    expect(second.reason).toBe('up_to_date');
    expect(second.meta).toEqual(first.meta);
    expect(statSync(dbPath).mtimeMs).toBe(mtime);
    second.store.close();
  });

  it('rebuilds when the corpus changes and reopens with identical search results', async () => {
    const edited = docs.map((d) =>
      d.doc_id === 'SOCIAL'
        ? { ...d, markdown: `${d.markdown}\n## 99. Addendum\n\nNew text.\n` }
        : d,
    );
    const rebuilt = await buildIndex({ docs: edited, provider: stub, dbPath, allowStub: true });
    expect(rebuilt.reason).toBe('corpus_changed');
    expect(rebuilt.meta.chunk_count).toBe(chunks.length + 1);
    const q = await stub.embedQuery('drone flight approval');
    const before = rebuilt.store.vectorSearch(q, { k: 5 });
    rebuilt.store.close();

    const reopened = IndexStore.open(dbPath);
    expect(reopened.vectorSearch(q, { k: 5 })).toEqual(before);
    expect(reopened.bm25.size).toBe(chunks.length + 1);
    reopened.close();

    const forced = await buildIndex({
      docs: edited,
      provider: stub,
      dbPath,
      allowStub: true,
      force: true,
    });
    expect(forced.reason).toBe('forced');
    forced.store.close();
  });

  it('rejects a file that is not an index', () => {
    expect(() => IndexStore.open(join(tmp, 'missing-dir', 'x.sqlite'))).toThrow();
  });
});
