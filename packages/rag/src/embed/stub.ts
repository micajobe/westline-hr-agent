import { createHash } from 'node:crypto';
import { bm25ProcessTerm, bm25Tokenize } from '../store/bm25.js';
import { l2Normalize, type EmbeddingProvider } from './provider.js';

export const STUB_DIMENSIONS = 256;
export const STUB_MODEL = 'stub-feature-hash-v1';

/**
 * Deterministic, offline embedder for the test suite and CI (`EMBEDDING_PROVIDER=stub`).
 *
 * It is feature hashing, not a language model: each word unigram and adjacent-word bigram is
 * hashed to a dimension and a sign, weighted by log term frequency, then the vector is
 * L2-normalised. Two texts that share vocabulary land near each other, which is enough for the
 * retrieval tests to exercise ranking, RRF and audience filtering with stable, reproducible scores.
 * It has no notion of meaning -- "vacation" and "PTO" are unrelated to it -- so `CLAUDE.md` forbids
 * building a real index with it. `index:build` refuses unless explicitly allowed.
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'stub' as const;
  readonly model = STUB_MODEL;
  readonly dimensions: number;

  constructor(dimensions = STUB_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedSync(t));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.embedSync(text);
  }

  embedSync(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const counts = new Map<string, number>();
    const tokens = tokenize(text);
    for (let i = 0; i < tokens.length; i++) {
      bump(counts, tokens[i]!);
      if (i + 1 < tokens.length) bump(counts, `${tokens[i]}_${tokens[i + 1]}`);
    }
    for (const [feature, count] of counts) {
      const { index, sign } = hashFeature(feature, this.dimensions);
      vec[index] = vec[index]! + sign * (1 + Math.log(count));
    }
    return l2Normalize(vec);
  }
}

/**
 * Shares the BM25 term normaliser (lower-case, stopwords, plural folding) so the two rankers agree
 * on what a word is; a stub that disagreed with BM25 about "days" vs "day" would make hybrid tests
 * flaky for reasons that have nothing to do with the code under test.
 */
export function tokenize(text: string): string[] {
  return bm25Tokenize(text)
    .map((t) => bm25ProcessTerm(t))
    .filter((t): t is string => t !== null && t.length > 1);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function hashFeature(feature: string, dimensions: number): { index: number; sign: 1 | -1 } {
  const digest = createHash('sha256').update(feature, 'utf8').digest();
  const index = digest.readUInt32BE(0) % dimensions;
  const sign = digest[4]! & 1 ? 1 : -1;
  return { index, sign };
}
