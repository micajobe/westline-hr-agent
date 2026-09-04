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
  /** Retries on 429/5xx with exponential backoff starting at `retryBaseMs`; a `Retry-After` header wins. */
  maxRetries?: number;
  retryBaseMs?: number;
  /**
   * Minimum gap between requests. Voyage keys without a payment method get 3 requests/min and
   * 10K tokens/min; `minIntervalMs: 21000` with `batchSize: 20` builds the corpus under that cap.
   */
  minIntervalMs?: number;
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
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(opts: VoyageOptions) {
    if (!opts.apiKey) throw new EmbeddingError('voyage', 'VOYAGE_API_KEY is not set');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? VOYAGE_DEFAULT_MODEL;
    this.dimensions = KNOWN_DIMENSIONS[this.model] ?? 0;
    this.batchSize = opts.batchSize ?? 64;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.minIntervalMs = opts.minIntervalMs ?? 0;
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
      if (this.minIntervalMs > 0) {
        const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      this.lastRequestAt = Date.now();
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
      const retryAfter = Number(res.headers.get('retry-after'));
      // In paced (free-tier) mode a 429 means "wait for the minute to roll over"; back off at least 20 s.
      const floor = res.status === 429 && this.minIntervalMs > 0 ? 20_000 : 0;
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.max(floor, this.retryBaseMs * 2 ** attempt);
      await sleep(wait);
      attempt++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
