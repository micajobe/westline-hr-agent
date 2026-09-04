import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Retriever,
  StubEmbeddingProvider,
  buildIndex,
  getPolicySection,
  loadCorpus,
  matchesSection,
  permittedAudiences,
  rewriteFollowUp,
  rrfFuse,
  type IndexStore,
  type Viewer,
} from '@westline/rag';
import { CORPUS_DIR } from './helpers/corpus.js';

/** PRD §5 personas, reduced to what retrieval needs. */
const jordan: Viewer = { workforce_class: 'staff', scope: 'self' }; // W-1042, staff
const dani: Viewer = { workforce_class: 'creator_partner', scope: 'self' }; // W-3010, creator partner
const sam: Viewer = { workforce_class: 'staff', scope: 'hr_partner' }; // W-1001, HR partner
const anon: Viewer = { workforce_class: null, scope: null };

const provider = new StubEmbeddingProvider();
let store: IndexStore;
let retriever: Retriever;

beforeAll(async () => {
  const docs = await loadCorpus(CORPUS_DIR, process.cwd());
  store = (await buildIndex({ docs, provider, dbPath: ':memory:', allowStub: true })).store;
  retriever = new Retriever(store, provider);
});
afterAll(() => store.close());

describe('permitted audiences', () => {
  it('maps class and scope to audience tags, anonymous to `all` only', () => {
    expect(permittedAudiences(anon)).toEqual(['all']);
    expect(permittedAudiences(jordan)).toEqual(['all', 'staff', 'staff_and_contractors']);
    expect(permittedAudiences(dani)).toEqual(['all', 'creator_partners']);
    expect(permittedAudiences({ workforce_class: 'contractor', scope: 'self' })).toEqual([
      'all',
      'contractor',
      'staff_and_contractors',
    ]);
    expect(permittedAudiences(sam)).toContain('hr_only');
    expect(permittedAudiences(jordan)).not.toContain('hr_only');
  });
});

describe('M2 acceptance spot checks', () => {
  const query = 'notice for a three day vacation';

  it('as Jordan returns the PTO notice rule on top with nothing withheld', async () => {
    // The PRD's manual spot check (§3.2 itself in the top 3) is run against the Voyage index. The
    // stub embedder is lexical, so here the top 3 must all be PTO notice material -- §3 (the table),
    // its subsections, or §8.1 (the worked three-day example that cites §3.2) -- with §3.2 in the
    // top 5.
    const res = await retriever.search({ viewer: jordan, query, k: 6 });
    const top3 = res.results.slice(0, 3);
    for (const r of top3) expect(r.doc_id).toBe('PTO');
    for (const r of top3) expect(['§3', '§3.1', '§3.2', '§3.3', '§8.1']).toContain(r.section_path);
    expect(res.results.slice(0, 5).map((r) => `${r.doc_id} ${r.section_path}`)).toContain(
      'PTO §3.2',
    );
    expect(res.withheld_by_audience).toBe(false);
    expect(res.withheld_doc_ids).toEqual([]);
    expect(res.retrieval).toMatchObject({ mode: 'hybrid', k: 6, rerank: false });
    expect(res.retrieval.rewritten_query).toBeUndefined();
  });

  it('as Dani returns no PTO chunk and reports PTO as withheld', async () => {
    const res = await retriever.search({ viewer: dani, query, k: 6 });
    expect(res.results).toHaveLength(6);
    for (const r of res.results) expect(r.doc_id).not.toBe('PTO');
    expect(res.withheld_by_audience).toBe(true);
    expect(res.withheld_doc_ids).toContain('PTO');
    expect(res.retrieval.candidates_after_audience_filter).toBeLessThan(
      res.retrieval.candidates_considered,
    );
  });

  it('as an anonymous reader only `all` material comes back', async () => {
    const res = await retriever.search({ viewer: anon, query });
    for (const r of res.results) expect(store.getChunk(r.chunk_id)!.audience).toBe('all');
    expect(res.withheld_by_audience).toBe(true);
  });
});

describe('result shape and constraints', () => {
  it('returns the PRD result fields with descending scores and no duplicates', async () => {
    const res = await retriever.search({
      viewer: jordan,
      query: 'expense claim receipts mileage',
      k: 8,
    });
    expect(res.results).toHaveLength(8);
    expect(new Set(res.results.map((r) => r.chunk_id)).size).toBe(8);
    for (let i = 1; i < res.results.length; i++)
      expect(res.results[i]!.score).toBeLessThanOrEqual(res.results[i - 1]!.score);
    expect(Object.keys(res.results[0]!).sort()).toEqual(
      [
        'chunk_id',
        'doc_id',
        'title',
        'section_path',
        'section_title',
        'snippet',
        'text',
        'score',
        'source_format',
      ].sort(),
    );
  });

  it('honours doc_ids and section_prefix', async () => {
    const byDoc = await retriever.search({
      viewer: jordan,
      query: 'approval',
      doc_ids: ['SAFETY', 'INFOSEC'],
    });
    for (const r of byDoc.results) expect(['SAFETY', 'INFOSEC']).toContain(r.doc_id);

    const bySection = await retriever.search({
      viewer: jordan,
      query: 'notice',
      doc_ids: ['PTO'],
      section_prefix: '§3',
    });
    expect(bySection.results.length).toBeGreaterThan(0);
    for (const r of bySection.results) expect(r.section_path).toMatch(/^§3(\.|$)/);
    expect(matchesSection('§3.2', '3')).toBe(true);
    expect(matchesSection('§30', '§3')).toBe(false);
  });

  it('supports vector-only and bm25-only modes for the ablation', async () => {
    const q = 'drone flight liability insurance';
    const hybrid = await retriever.search({ viewer: jordan, query: q, mode: 'hybrid', k: 5 });
    const vec = await retriever.search({ viewer: jordan, query: q, mode: 'vector', k: 5 });
    const bm = await retriever.search({ viewer: jordan, query: q, mode: 'bm25', k: 5 });
    expect(vec.retrieval.mode).toBe('vector');
    expect(bm.retrieval.mode).toBe('bm25');
    expect(bm.results[0]!.doc_id).toBe('SAFETY');
    expect(hybrid.results.slice(0, 3).some((r) => r.doc_id === 'SAFETY')).toBe(true);
    const union = new Set([...vec.results, ...bm.results].map((r) => r.chunk_id));
    expect(union.has(hybrid.results[0]!.chunk_id)).toBe(true);
  });
});

describe('reciprocal rank fusion', () => {
  it('rewards agreement between rankers and breaks ties deterministically', () => {
    const fused = rrfFuse([
      [
        { chunk_id: 'a', score: 9 },
        { chunk_id: 'b', score: 8 },
        { chunk_id: 'c', score: 7 },
      ],
      [
        { chunk_id: 'b', score: 0.9 },
        { chunk_id: 'a', score: 0.8 },
        { chunk_id: 'd', score: 0.7 },
      ],
    ]);
    // a and b both score 1/61 + 1/62 and c and d both 1/63; agreement between rankers lifts a
    // and b above the singletons, and each tie falls back to id order so the result is stable.
    expect(fused.map((r) => r.chunk_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 12);
    expect(fused[2]!.score).toBeCloseTo(fused[3]!.score, 12);
    expect(fused[1]!.score).toBeGreaterThan(fused[2]!.score);
  });
});

describe('follow-up rewriting', () => {
  it('carries content terms from the prior query into an anaphoric follow-up', async () => {
    const prior = ['how much notice for a three day vacation'];
    const rw = rewriteFollowUp('what about five days?', prior);
    expect(rw.rewritten).toBe(true);
    expect(rw.query).toMatch(/^what about five days\? .*notice.*vacation/);

    const res = await retriever.search({
      viewer: jordan,
      query: 'what about five days?',
      prior_queries: prior,
      k: 5,
    });
    expect(res.retrieval.rewritten_query).toBe(rw.query);
    expect(
      res.results.slice(0, 3).some((r) => r.doc_id === 'PTO' && /^§3\.(2|3)$/.test(r.section_path)),
    ).toBe(true);
  });

  it('leaves self-contained questions alone', () => {
    expect(
      rewriteFollowUp('what is the mileage rate for expense claims', ['notice for vacation']),
    ).toEqual({
      query: 'what is the mileage rate for expense claims',
      rewritten: false,
    });
    expect(rewriteFollowUp('and the rate?', [])).toEqual({
      query: 'and the rate?',
      rewritten: false,
    });
  });
});

describe('get_policy_section semantics', () => {
  it('returns the full section text to a permitted reader', () => {
    const r = getPolicySection(store, jordan, 'PTO', '§3.2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.section.section_title).toBe('Requests of three to five days');
    expect(r.section.text).toMatch(/14 calendar days/);
    expect(r.section.audience).toBe('staff');
    expect(r.section.effective_date).toBe('2026-01-01');
    // A parent section includes its children.
    const parent = getPolicySection(store, jordan, 'PTO', '3');
    expect(parent.ok && parent.section.text).toMatch(/### 3\.2 Requests of three to five days/);
  });

  it('refuses a creator partner with FORBIDDEN_AUDIENCE, but lets them read overridden sections', () => {
    expect(getPolicySection(store, dani, 'PTO', '§3.2')).toMatchObject({
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
    });
    expect(getPolicySection(store, dani, 'EXPENSE', '§7.1')).toMatchObject({ ok: true });
    expect(getPolicySection(store, dani, 'EXPENSE', '§2')).toMatchObject({
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
    });
    expect(getPolicySection(store, jordan, 'EXPENSE', '§7.1')).toMatchObject({
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
    });
  });

  it('reports NOT_FOUND for unknown documents and sections', () => {
    expect(getPolicySection(store, jordan, 'TAX', '§2')).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(getPolicySection(store, jordan, 'PTO', '§99')).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    });
  });
});
