/**
 * One interface in front of every embedding backend so the index builder, `policy-mcp` and the
 * eval ablations never care which one is live. Vectors are L2-normalised `Float32Array`s of
 * exactly `dimensions` entries, so cosine similarity is a dot product and sqlite-vec can use
 * either distance metric.
 */

export const EMBEDDING_PROVIDER_IDS = ['voyage', 'local', 'stub'] as const;
export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDER_IDS)[number];

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  /** Recorded in `index.meta.json` as `embedding_model`; a change forces a rebuild. */
  readonly model: string;
  readonly dimensions: number;
  /** Embed passages for indexing. Order and length of the result match `texts`. */
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  /** Embed a search query. Asymmetric models (Voyage) treat this differently from documents. */
  embedQuery(text: string): Promise<Float32Array>;
}

export class EmbeddingError extends Error {
  constructor(
    readonly provider: EmbeddingProviderId,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

export function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  return vec;
}

/** Cosine similarity of two normalised vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
