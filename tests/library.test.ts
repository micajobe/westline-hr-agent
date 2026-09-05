import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StubEmbeddingProvider,
  buildDocumentView,
  buildIndex,
  buildLibrary,
  loadCorpus,
  parseCategories,
  parseSections,
  type IndexStore,
  type PolicyCategory,
  type Viewer,
} from '@westline/rag';
import {
  listPolicyLibrary,
  readPolicyDocument,
  type DocumentReadView,
  type LibraryView,
} from '@westline/policy-mcp';
import { CORPUS_DIR, EXPECTED_DOC_IDS } from './helpers/corpus.js';
import { P, startTestHost, TEST_SECRET, type TestHost } from './helpers/mcp.js';
import { MCP_SECRET_HEADER } from '@westline/mcp-host';

const jordan: Viewer = { workforce_class: 'staff', scope: 'self' }; // W-1042, staff
const dani: Viewer = { workforce_class: 'creator_partner', scope: 'self' }; // W-3010, creator partner
const marcus: Viewer = { workforce_class: 'contractor', scope: 'self' }; // W-2010, contractor
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

const docsIn = (library: ReturnType<typeof buildLibrary>) =>
  library.categories.flatMap((c) => c.documents.map((d) => d.doc_id));

describe('HANDBOOK §4 category map', () => {
  it('parses the areas, owners and document lists out of the corpus', () => {
    expect(categories.map((c) => c.owner)).toEqual([
      'People & Culture',
      'Editorial Standards desk',
      'Field Safety desk',
      'Information Security',
      'Finance',
      'Creator Partnerships',
    ]);
    expect(categories.find((c) => c.owner === 'Editorial Standards desk')?.doc_ids).toEqual([
      'EDITORIAL',
      'SOCIAL',
    ]);
  });

  it('files every indexed document exactly once, HANDBOOK included', () => {
    // HANDBOOK does not appear in its own §4 table; it joins its front-matter owner's category.
    const listed = docsIn(buildLibrary(store, jordan, categories));
    expect(listed.length).toBe(EXPECTED_DOC_IDS.length);
    expect([...listed].sort()).toEqual([...EXPECTED_DOC_IDS].sort());
  });
});

describe('library audience filtering', () => {
  it('withholds CREATOR from staff and everything staff-only from a creator partner', () => {
    expect(buildLibrary(store, jordan, categories).withheld_doc_ids).toEqual(['CREATOR']);
    const forDani = buildLibrary(store, dani, categories);
    expect(forDani.withheld_doc_ids).toEqual(expect.arrayContaining(['PTO', 'LEAVE', 'PERF', 'REMOTE']));
    expect(docsIn(forDani)).toContain('CREATOR');
  });

  it('lists a document a section override opens: BENEFITS §6 for a contractor', () => {
    const benefits = docFor(marcus, 'BENEFITS');
    expect(benefits.readable).toBe(true);
    expect(benefits.readable_section_count).toBeLessThan(benefits.section_count);
    const open = benefits.sections.filter((s) => s.readable).map((s) => s.section_path);
    expect(open.every((p) => p === '§6' || p.startsWith('§6.'))).toBe(true);
  });

  it('opens HOURS §6 to a contractor, and withholds the rest of the hours policy', () => {
    const hours = docFor(marcus, 'HOURS');
    expect(hours.readable).toBe(true);
    const open = hours.sections.filter((s) => s.readable).map((s) => s.section_path);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((p) => p === '§6' || p.startsWith('§6.'))).toBe(true);
    expect(buildLibrary(store, dani, categories).withheld_doc_ids).toContain('HOURS');
  });

  it('opens EXPENSE §7 and only §7 to a creator partner', () => {
    const expense = docFor(dani, 'EXPENSE');
    expect(expense.readable).toBe(true);
    expect(
      expense.sections.filter((s) => s.readable).every((s) => s.section_path.startsWith('§7')),
    ).toBe(true);
  });

  it('gives an anonymous reader `all` documents only', () => {
    const library = buildLibrary(store, anon, categories);
    const open = library.categories.flatMap((c) => c.documents).filter((d) => d.readable);
    // The six `all` documents, plus the two that an `all` section override opens a door into:
    // BENEFITS §6 (the EFAP) and ONBOARD §4/§6 (account provisioning and return of gear).
    expect(open.map((d) => d.doc_id).sort()).toEqual(
      ['BENEFITS', 'CONDUCT', 'EDITORIAL', 'HANDBOOK', 'INFOSEC', 'ONBOARD', 'SAFETY', 'SOCIAL'].sort(),
    );
    const benefits = library.categories
      .flatMap((c) => c.documents)
      .find((d) => d.doc_id === 'BENEFITS');
    expect(benefits?.readable).toBe(true);
    expect(benefits?.readable_section_count).toBeGreaterThan(0);
  });

  function docFor(viewer: Viewer, doc_id: string) {
    const doc = buildLibrary(store, viewer, categories)
      .categories.flatMap((c) => c.documents)
      .find((d) => d.doc_id === doc_id);
    if (!doc) throw new Error(`${doc_id} not listed`);
    return doc;
  }
});

describe('document reading view', () => {
  it('reproduces the document exactly once: parent sections carry no child text', () => {
    const view = buildDocumentView(store, jordan, 'PTO')!;
    const parent = view.sections.find((s) => s.section_path === '§1')!;
    const child = view.sections.find((s) => s.section_path === '§1.1')!;
    expect(child.text).toBeTruthy();
    expect(parent.text).not.toContain(child.text!.slice(0, 60));
  });

  it('covers every numbered section of the document', () => {
    const markdown = store.getDocument('LEAVE')!.markdown;
    const view = buildDocumentView(store, jordan, 'LEAVE')!;
    expect(view.sections.map((s) => s.section_path)).toEqual(
      parseSections(markdown).map((s) => s.section_path),
    );
    expect(view.preamble).toContain('This policy applies to Westline staff');
  });

  it('nulls the text of a closed section and says why, in get_policy_section wording', () => {
    const view = buildDocumentView(store, marcus, 'BENEFITS')!;
    const closed = view.sections.find((s) => s.section_path === '§1')!;
    expect(closed.text).toBeNull();
    expect(closed.withheld_reason).toBe(
      'BENEFITS §1 is tagged staff; not available to this reader',
    );
    expect(view.preamble).toBeNull(); // the document lede is staff-only too
    expect(view.withheld_section_count).toBeGreaterThan(0);
  });
});

describe('policy-mcp browse surface', () => {
  let ctx: TestHost;
  beforeAll(async () => { ctx = await startTestHost(); });
  afterAll(async () => { await ctx.stop(); });

  it('annotates the listing with the HANDBOOK §2 row for the viewer class', () => {
    const view = listPolicyLibrary(ctx.policy, P.jordan);
    expect(view.workforce_class).toBe('staff');
    expect(view.applicability.PTO?.scope).toBe('full');
    expect(listPolicyLibrary(ctx.policy, P.dani).applicability.EXPENSE).toMatchObject({
      scope: 'partial',
      sections: ['§7'],
    });
    expect(listPolicyLibrary(ctx.policy, P.marcus).applicability.HOURS).toMatchObject({
      scope: 'partial',
      sections: ['§6'],
    });
    expect(listPolicyLibrary(ctx.policy, null).applicability).toEqual({});
  });

  it('refuses a document whose every section is closed, and 404s an unknown one', () => {
    expect(readPolicyDocument(ctx.policy, P.jordan, 'CREATOR')).toMatchObject({
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
    });
    expect(readPolicyDocument(ctx.policy, P.jordan, 'NOPE')).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(readPolicyDocument(ctx.policy, P.dani, 'creator')).toMatchObject({ ok: true });
  });

  it('serves both routes over the host, behind the shared secret', async () => {
    const get = (path: string, secret = TEST_SECRET) =>
      fetch(`${ctx.url}${path}`, { headers: { [MCP_SECRET_HEADER]: secret } });

    expect((await get('/handbook', 'wrong-secret-wrong-secret-wrong!')).status).toBe(401);

    const listing = (await (await get(`/handbook?acting_person_id=${P.dani}`)).json()) as LibraryView;
    expect(listing.withheld_doc_ids).toContain('PTO');

    const doc = (await (await get(`/handbook/PTO?acting_person_id=${P.jordan}`)).json()) as DocumentReadView;
    expect(doc.doc_id).toBe('PTO');
    expect(doc.sections.some((s) => s.section_path === '§3.2')).toBe(true);

    // No acting person is anonymous, not "trusted": PTO is staff-only.
    expect((await get('/handbook/PTO')).status).toBe(403);
    expect((await get(`/handbook/NOPE?acting_person_id=${P.jordan}`)).status).toBe(404);
  });
});
