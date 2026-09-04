import { EmbeddingError, l2Normalize, type EmbeddingProvider } from './provider.js';

export const VOYAGE_DEFAULT_MODEL = 'voyage-3-lite';
export const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/** Output dimensions per model; anything else is discovered from the first response. */
const KNOWN_DIMENSIONS: Record<string, number> = {
  'voyage-3-lite': 512,
  'voyage-3': 1024,
  'voyage-3.5': 1024,
  'voyage-3.5-lite': 1024,
};

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  /** Voyage accepts up to 128 inputs per request; smaller batches keep under the token cap. */
  batchSize?: number;
  fetch?: typeof fetch;
  /** Retries on 429/5xx with exponential backoff starting at `retryBaseMs`. */
  maxRetries?: number;
  retryBaseMs?: number;
}

interface VoyageResponse {
  data: { index: number; embedding: number[] }[];
  model: string;
  usage?: { total_tokens: number };
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'voyage' as const;
  readonly model: string;
  dimensions: number;

  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: VoyageOptions) {
    if (!opts.apiKey) throw new EmbeddingError('voyage', 'VOYAGE_API_KEY is not set');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? VOYAGE_DEFAULT_MODEL;
    this.dimensions = KNOWN_DIMENSIONS[this.model] ?? 0;
    this.batchSize = opts.batchSize ?? 64;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...(await this.request(texts.slice(i, i + this.batchSize), 'document')));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.request([text], 'query');
    return vec!;
  }

  private async request(
    input: string[],
    input_type: 'document' | 'query',
  ): Promise<Float32Array[]> {
    if (input.length === 0) return [];
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(VOYAGE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input, model: this.model, input_type }),
      });

      if (res.ok) {
        const body = (await res.json()) as VoyageResponse;
        const vectors = body.data
          .sort((a, b) => a.index - b.index)
          .map((d) => l2Normalize(Float32Array.from(d.embedding)));
        if (vectors.length !== input.length) {
          throw new EmbeddingError(
            'voyage',
            `expected ${input.length} vectors, got ${vectors.length}`,
          );
        }
        if (vectors[0] && this.dimensions === 0) this.dimensions = vectors[0].length;
        return vectors;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new EmbeddingError('voyage', `HTTP ${res.status} ${detail}`.trim(), res.status);
      }
      await sleep(this.retryBaseMs * 2 ** attempt);
      attempt++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
