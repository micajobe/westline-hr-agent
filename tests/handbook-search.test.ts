import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StubEmbeddingProvider,
  buildIndex,
  buildLibrary,
  loadCorpus,
  parseCategories,
  searchLibrary,
  type IndexStore,
  type LibrarySearch,
  type PolicyCategory,
  type Viewer,
} from '@westline/rag';
import { searchPolicyLibrary } from '@westline/policy-mcp';
import { MCP_SECRET_HEADER } from '@westline/mcp-host';
import { CORPUS_DIR } from './helpers/corpus.js';
import { P, startTestHost, TEST_SECRET, type TestHost } from './helpers/mcp.js';

const jordan: Viewer = { workforce_class: 'staff', scope: 'self' };
const marcus: Viewer = { workforce_class: 'contractor', scope: 'self' };
const dani: Viewer = { workforce_class: 'creator_partner', scope: 'self' };
const anon: Viewer = { workforce_class: null, scope: null };

const provider = new StubEmbeddingProvider();
let store: IndexStore;
let categories: PolicyCategory[];

beforeAll(async () => {
  const docs = await loadCorpus(CORPUS_DIR, process.cwd());
  store = (await buildIndex({ docs, provider, dbPath: ':memory:', allowStub: true })).store;
  categories = parseCategories(store.getDocument('HANDBOOK')!);
});
afterAll(() => store.close());

const find = (r: LibrarySearch, doc_id: string, section_path: string) =>
  r.hits.find((h) => h.doc_id === doc_id && h.section_path === section_path);
const paths = (r: LibrarySearch) => r.hits.map((h) => `${h.doc_id} ${h.section_path}`);

describe('section search', () => {
  it('finds the section that carries a phrase, and quotes it back', () => {
    const r = searchLibrary(store, jordan, 'compressed week');
    const hit = find(r, 'HOURS', '§1.4');
    expect(hit).toBeDefined();
    expect(hit!.section_title).toBe('Flexible and compressed weeks');
    expect(hit!.snippet.toLowerCase()).toContain('compressed week');
    // Rendered as text, not markdown: the emphasis around the phrase must not reach the snippet.
    expect(hit!.snippet).not.toContain('**');
    expect(hit!.snippet).not.toContain('\n');
    // The phrase bonus puts the section that says it above sections that merely share a word.
    expect(r.hits[0]!.section_path).toBe('§1.4');
  });

  it('requires every term, so more words narrow the result', () => {
    const broad = searchLibrary(store, jordan, 'meal');
    const narrow = searchLibrary(store, jordan, 'meal window shoot');
    expect(broad.hits.length).toBeGreaterThan(narrow.hits.length);
    expect(narrow.hits.length).toBeGreaterThan(0);
    expect(searchLibrary(store, jordan, 'meal window zzzznotaword').hits).toEqual([]);
  });

  it('ranks a section whose heading names the query above one that only mentions it', () => {
    const r = searchLibrary(store, jordan, 'rest breaks');
    expect(r.hits[0]!.doc_id).toBe('HOURS');
    expect(r.hits[0]!.section_path).toBe('§3.2');
  });

  it('is deterministic: the same query lists in the same order', () => {
    const once = searchLibrary(store, jordan, 'overtime');
    const twice = searchLibrary(store, jordan, 'overtime');
    expect(paths(once)).toEqual(paths(twice));
  });

  it('ignores a query with nothing searchable in it', () => {
    const r = searchLibrary(store, jordan, '   ?  ');
    expect(r.hits).toEqual([]);
    expect(r.terms).toEqual([]);
  });

  it('reduces a table to one readable line', () => {
    // HANDBOOK §2 is the applicability matrix — nothing but a table.
    const hit = find(searchLibrary(store, jordan, 'applicability matrix'), 'HANDBOOK', '§2');
    expect(hit).toBeDefined();
    expect(hit!.snippet).not.toMatch(/\|\s*[-:]+\s*\|/);
    expect(hit!.snippet).not.toContain('\n');
  });

  it('caps the result list and says it did', () => {
    const r = searchLibrary(store, jordan, 'the', { limit: 5 });
    expect(r.hits).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });
});

describe('search audience filtering', () => {
  it('never returns a section the viewer may not open', () => {
    for (const viewer of [jordan, marcus, dani, anon]) {
      const open = new Set(
        buildLibrary(store, viewer, categories)
          .categories.flatMap((c) => c.documents)
          .flatMap((d) => d.sections.filter((s) => s.readable).map((s) => `${d.doc_id} ${s.section_path}`)),
      );
      // Broad enough to touch most of the corpus; every hit must still be inside the viewer's audience.
      for (const q of ['work', 'policy', 'westline', 'pay']) {
        const r = searchLibrary(store, viewer, q);
        expect(r.hits.length).toBeGreaterThan(0);
        expect(paths(r).filter((p) => !open.has(p))).toEqual([]);
      }
    }
  });

  it('does not leak a closed section through a phrase unique to it', () => {
    // HOURS §1.4 is staff-only; §6 is the one part of the document a contractor may read.
    expect(find(searchLibrary(store, jordan, 'compressed week'), 'HOURS', '§1.4')).toBeDefined();
    expect(searchLibrary(store, marcus, 'compressed week').hits).toEqual([]);
    expect(searchLibrary(store, anon, 'compressed week').hits).toEqual([]);
    // …and the section that is open to a contractor is still found.
    expect(find(searchLibrary(store, marcus, 'call sheet'), 'HOURS', '§6.1')).toBeDefined();
  });

  it('counts what it did not search, without saying whether any of it matched', () => {
    const r = searchLibrary(store, marcus, 'call sheet');
    expect(r.sections_withheld).toBeGreaterThan(0);
    expect(r.sections_searched).toBeGreaterThan(0);
    // A staff reader sees more of the corpus, so searches more of it.
    expect(searchLibrary(store, jordan, 'call sheet').sections_searched).toBeGreaterThan(
      r.sections_searched,
    );
    expect(Object.keys(r)).not.toContain('withheld_hits');
  });
});

describe('the search route', () => {
  let ctx: TestHost;
  beforeAll(async () => {
    ctx = await startTestHost();
  });
  afterAll(async () => {
    await ctx.stop();
  });

  it('resolves the acting person to a viewer, the way the listing does', () => {
    expect(find(searchPolicyLibrary(ctx.policy, P.jordan, 'compressed week'), 'HOURS', '§1.4')).toBeDefined();
    expect(searchPolicyLibrary(ctx.policy, P.marcus, 'compressed week').hits).toEqual([]);
    expect(searchPolicyLibrary(ctx.policy, null, 'compressed week').hits).toEqual([]);
  });

  it('serves `/handbook?q=` behind the shared secret, and lists when q is absent', async () => {
    const get = (path: string, secret = TEST_SECRET) =>
      fetch(`${ctx.url}${path}`, { headers: { [MCP_SECRET_HEADER]: secret } });

    expect((await get('/handbook?q=meal', 'wrong-secret-wrong-secret-wrong!')).status).toBe(401);

    const staff = (await (await get(`/handbook?q=compressed+week&acting_person_id=${P.jordan}`)).json()) as LibrarySearch;
    expect(paths(staff)).toContain('HOURS §1.4');

    const contractor = (await (await get(`/handbook?q=compressed+week&acting_person_id=${P.marcus}`)).json()) as LibrarySearch;
    expect(contractor.hits).toEqual([]);

    // No `q` is still the listing, not an empty search.
    const listing = (await (await get(`/handbook?acting_person_id=${P.jordan}`)).json()) as { doc_count: number };
    expect(listing.doc_count).toBeGreaterThan(0);
  });
});
