import { resolve } from 'node:path';
import { StubEmbeddingProvider, buildIndex, loadCorpus, type IndexStore } from '@westline/rag';

/**
 * Resolve a cited chunk_id to the text the model actually saw. Chunk ids and text depend only on
 * the corpus and the chunker, never on the embedder, so a stub-embedded in-memory index built from
 * the same committed corpus is an exact lookup table -- no API key, no network, no trust in the
 * server under test.
 */
export class ChunkResolver {
  private stores = new Map<'heading' | 'fixed', IndexStore>();
  constructor(private readonly repoRoot = process.cwd()) {}

  private async store(strategy: 'heading' | 'fixed'): Promise<IndexStore> {
    let s = this.stores.get(strategy);
    if (!s) {
      const docs = await loadCorpus(resolve(this.repoRoot, 'corpus'), this.repoRoot);
      s = (await buildIndex({ docs, provider: new StubEmbeddingProvider(), dbPath: ':memory:', allowStub: true, strategy })).store;
      this.stores.set(strategy, s);
    }
    return s;
  }

  async textFor(chunk_id: string): Promise<string | undefined> {
    const [doc_id, section, tail] = chunk_id.split('#');
    if (!doc_id || !section) return undefined;
    if (section === 'fixed') return (await this.store('fixed')).getChunk(chunk_id)?.text;
    const s = await this.store('heading');
    if (tail === 's') return s.getSection(doc_id, section)?.text;
    return s.getChunk(chunk_id)?.text;
  }

  close(): void {
    for (const s of this.stores.values()) s.close();
    this.stores.clear();
  }
}
