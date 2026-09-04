import { describe, expect, it, vi } from 'vitest';
import {
  EmbeddingError,
  STUB_DIMENSIONS,
  StubEmbeddingProvider,
  VOYAGE_ENDPOINT,
  VoyageEmbeddingProvider,
  createEmbeddingProvider,
  dot,
  tokenize,
} from '@westline/rag';

describe('stub embedding provider', () => {
  const stub = new StubEmbeddingProvider();

  it('is deterministic, normalised and the declared size', async () => {
    const [a] = await stub.embedDocuments([
      'Requests of three to five days require 14 calendar days notice.',
    ]);
    const b = await stub.embedQuery(
      'Requests of three to five days require 14 calendar days notice.',
    );
    expect(a).toEqual(b);
    expect(a!.length).toBe(STUB_DIMENSIONS);
    expect(dot(a!, a!)).toBeCloseTo(1, 5);
  });

  it('ranks lexically similar text above unrelated text', async () => {
    const q = await stub.embedQuery('how much notice for a three day vacation request');
    const [pto, infosec] = await stub.embedDocuments([
      'Requests of three to five consecutive working days require 14 calendar days notice and newsroom lead approval.',
      'The virtual private network is mandatory on any untrusted network, including hotel and airport wifi.',
    ]);
    expect(dot(q, pto!)).toBeGreaterThan(dot(q, infosec!));
  });

  it('embeds a batch identically to one at a time', async () => {
    const texts = ['alpha beta', 'gamma delta epsilon', ''];
    const batch = await stub.embedDocuments(texts);
    for (let i = 0; i < texts.length; i++)
      expect(batch[i]).toEqual(await stub.embedQuery(texts[i]!));
    expect(batch[2]!.every((v) => v === 0)).toBe(true); // empty text stays the zero vector
  });

  it('tokenises case-insensitively, drops stopwords and punctuation, keeps numbers', () => {
    expect(tokenize('The PTO policy: 14 calendar-days, of notice!')).toEqual([
      'pto',
      'policy',
      '14',
      'calendar',
      'days',
      'notice',
    ]);
  });
});

describe('createEmbeddingProvider', () => {
  it('selects the stub for tests and refuses unknown names', () => {
    expect(createEmbeddingProvider({ EMBEDDING_PROVIDER: 'stub' }).id).toBe('stub');
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: 'openai' })).toThrow(/not one of/);
  });

  it('defaults to voyage and fails loudly without a key', () => {
    expect(() => createEmbeddingProvider({})).toThrow(EmbeddingError);
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: 'voyage' })).toThrow(
      /VOYAGE_API_KEY/,
    );
    const p = createEmbeddingProvider({
      EMBEDDING_PROVIDER: 'voyage',
      VOYAGE_API_KEY: 'k',
      VOYAGE_MODEL: 'voyage-3',
    });
    expect(p.model).toBe('voyage-3');
    expect(p.dimensions).toBe(1024);
  });

  it('names local as not yet implemented rather than falling back', () => {
    expect(() => createEmbeddingProvider({ EMBEDDING_PROVIDER: 'local' })).toThrow(
      /not implemented/,
    );
  });
});

describe('voyage embedding provider (mocked HTTP)', () => {
  function fakeVoyage(opts: { failFirst?: number; dims?: number } = {}) {
    const dims = opts.dims ?? 4;
    let failures = opts.failFirst ?? 0;
    const calls: { body: any; headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      calls.push({ body, headers: init!.headers as Record<string, string> });
      if (failures > 0) {
        failures--;
        return new Response('rate limited', { status: 429 });
      }
      // Return in reverse order to prove the client re-sorts by index.
      const data = body.input
        .map((_t: string, i: number) => ({
          index: i,
          embedding: Array.from({ length: dims }, (_, d) => (d === i % dims ? 2 : 0)),
        }))
        .reverse();
      return Response.json({ data, model: body.model, usage: { total_tokens: 1 } });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it('batches documents, sets input_type, sends the bearer token and normalises', async () => {
    const { fetchImpl, calls } = fakeVoyage();
    const p = new VoyageEmbeddingProvider({ apiKey: 'secret', fetch: fetchImpl, batchSize: 2 });
    const vecs = await p.embedDocuments(['a', 'b', 'c']);
    expect(calls.map((c) => c.body.input)).toEqual([['a', 'b'], ['c']]);
    expect(calls[0]!.body.input_type).toBe('document');
    expect(calls[0]!.body.model).toBe('voyage-3-lite');
    expect(calls[0]!.headers.authorization).toBe('Bearer secret');
    expect(vecs).toHaveLength(3);
    expect(Array.from(vecs[1]!)).toEqual([0, 1, 0, 0]); // index 1 → dim 1, normalised from 2 to 1
    expect(p.dimensions).toBe(512); // known model size, independent of the fake's 4 dims

    await p.embedQuery('q');
    expect(calls.at(-1)!.body.input_type).toBe('query');
    expect(fetchImpl).toHaveBeenCalledWith(VOYAGE_ENDPOINT, expect.anything());
  });

  it('retries 429s with backoff and then gives up with a structured error', async () => {
    const ok = fakeVoyage({ failFirst: 2 });
    const p = new VoyageEmbeddingProvider({ apiKey: 'k', fetch: ok.fetchImpl, retryBaseMs: 1 });
    expect((await p.embedQuery('q')).length).toBe(4);
    expect(ok.calls).toHaveLength(3);

    const bad = fakeVoyage({ failFirst: 10 });
    const q = new VoyageEmbeddingProvider({
      apiKey: 'k',
      fetch: bad.fetchImpl,
      retryBaseMs: 1,
      maxRetries: 1,
    });
    await expect(q.embedQuery('q')).rejects.toMatchObject({ provider: 'voyage', status: 429 });
    expect(bad.calls).toHaveLength(2);
  });
});
