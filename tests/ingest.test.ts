import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CHUNKER_VERSION,
  FrontMatterError,
  MAX_CHUNK_CHARS,
  SNIPPET_CHARS,
  chunkCorpus,
  chunkDocument,
  corpusHash,
  loadCorpus,
  makeSnippet,
  parseFrontMatter,
  parseSections,
  type Chunk,
  type LoadedDocument,
} from '@westline/rag';
import { CORPUS_DIR, EXPECTED_DOC_IDS, PDF_SRC_DIR } from './helpers/corpus.js';

let docs: LoadedDocument[];
let chunks: Chunk[];
const byId = (id: string) => docs.find((d) => d.doc_id === id)!;

beforeAll(async () => {
  docs = await loadCorpus(CORPUS_DIR, process.cwd());
  chunks = chunkCorpus(docs);
});

/** Count the numbered headings in a document's authored source, independently of the ingester. */
function sourceHeadingCount(doc: LoadedDocument): number {
  if (doc.source_format === 'html') {
    const html = readFileSync(join(CORPUS_DIR, `${doc.doc_id}.html`), 'utf8');
    return (html.match(/<h[23]>\s*\d+(\.\d+)*\.?\s/g) ?? []).length;
  }
  const dir = doc.source_format === 'pdf' ? PDF_SRC_DIR : CORPUS_DIR;
  const md = readFileSync(join(dir, `${doc.doc_id}.md`), 'utf8');
  return (md.match(/^#{2,3}\s+\d+(\.\d+)*\.?\s/gm) ?? []).length;
}

describe('loading and normalising', () => {
  it('loads all 14 documents across md, html and pdf', () => {
    expect(docs.map((d) => d.doc_id)).toEqual([...EXPECTED_DOC_IDS]);
    expect(new Set(docs.map((d) => d.source_format))).toEqual(new Set(['md', 'html', 'pdf']));
  });

  it('recovers every numbered heading from every source format', () => {
    // A heading the parser misses silently drops that section from the index. This caught
    // turndown escaping `3.` as `3\.` in the HTML documents' <h2> headings.
    for (const doc of docs) {
      const parsed = parseSections(doc.markdown).length;
      expect(parsed, `${doc.doc_id} (${doc.source_format}) sections`).toBe(sourceHeadingCount(doc));
    }
  });

  it('preserves HTML tables as markdown tables', () => {
    expect(byId('PTO').markdown).toMatch(/\| Length of request \| Minimum notice \| Approver \|/);
  });

  it('reconstructs headings and paragraphs from the PDF text layer', () => {
    const md = byId('EXPENSE').markdown;
    expect(md).toMatch(/^## 7\. /m);
    expect(md).toMatch(/^### 7\.1 /m);
    expect(md.split('\n\n').length).toBeGreaterThan(40);
  });
});

describe('front matter validation', () => {
  it('fails the build on a missing audience', () => {
    expect(() =>
      parseFrontMatter(
        'X.md',
        'doc_id: X\ntitle: T\nversion: "1"\neffective_date: "2026-01-01"\nowner: O',
      ),
    ).toThrow(FrontMatterError);
  });

  it('rejects unknown audiences and malformed override keys', () => {
    const base = 'doc_id: X\ntitle: T\nversion: "1"\neffective_date: "2026-01-01"\nowner: O\n';
    expect(() => parseFrontMatter('X.md', `${base}audience: everyone`)).toThrow(/audience/);
    expect(() =>
      parseFrontMatter('X.md', `${base}audience: staff\nsection_audience_overrides:\n  "7": all`),
    ).toThrow(/§7/);
  });
});

describe('chunking', () => {
  it('produces one chunk per leaf section, with unique PRD-shaped ids', () => {
    const ids = chunks.map((c) => c.chunk_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]+#§\d+(\.\d+)*#\d+$/);
    for (const doc of docs) {
      expect(chunks.filter((c) => c.doc_id === doc.doc_id).length).toBeGreaterThan(15);
    }
  });

  it('every chunk is an exact slice of its normalised document', () => {
    for (const c of chunks) {
      expect(byId(c.doc_id).markdown.slice(c.char_start, c.char_end)).toBe(c.text);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it('respects the ~450-token budget and overlaps continuation chunks', () => {
    const continuations = chunks.filter((c) => c.chunk_index > 0);
    expect(continuations.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    for (const c of continuations) {
      const prev = chunks.find(
        (p) =>
          p.doc_id === c.doc_id &&
          p.section_path === c.section_path &&
          p.chunk_index === c.chunk_index - 1,
      )!;
      expect(c.char_start).toBeGreaterThan(prev.char_start);
      expect(c.char_start, `${c.chunk_id} overlaps its predecessor`).toBeLessThan(prev.char_end);
      // Never starts mid-word: the overlap start is snapped to a whitespace boundary.
      expect(byId(c.doc_id).markdown[c.char_start - 1]).toMatch(/\s/);
    }
  });

  it('keeps a parent section preamble when it carries the rule (PTO §3 notice table)', () => {
    const preamble = chunks.find((c) => c.chunk_id === 'PTO#§3#0');
    expect(preamble?.text).toContain(
      '| 3–5 consecutive working days | 14 calendar days (2 weeks) |',
    );
    const s32 = chunks.find((c) => c.chunk_id === 'PTO#§3.2#0');
    expect(s32?.section_title).toBe('Requests of three to five days');
    expect(s32?.text).toMatch(/14 calendar days/);
  });

  it('snippets are single-line and capped', () => {
    for (const c of chunks) {
      expect(c.snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS);
      expect(c.snippet).not.toMatch(/\n/);
    }
    expect(makeSnippet('a\n\nb   c')).toBe('a b c');
    expect(makeSnippet('x'.repeat(300))).toHaveLength(SNIPPET_CHARS);
  });
});

describe('effective audience', () => {
  const audienceOf = (id: string) => (c: Chunk) => c.doc_id === id;

  it('inherits the document audience by default', () => {
    expect(new Set(chunks.filter(audienceOf('PTO')).map((c) => c.audience))).toEqual(
      new Set(['staff']),
    );
    expect(new Set(chunks.filter(audienceOf('HANDBOOK')).map((c) => c.audience))).toEqual(
      new Set(['all']),
    );
  });

  it('applies section overrides to the section and its children only', () => {
    const expense = chunks.filter(audienceOf('EXPENSE'));
    for (const c of expense) {
      expect(c.audience).toBe(
        c.section_path.startsWith('§7') ? 'creator_partners' : 'staff_and_contractors',
      );
    }
    const benefits = chunks.filter(audienceOf('BENEFITS'));
    expect(benefits.some((c) => c.section_path.startsWith('§6'))).toBe(true);
    for (const c of benefits)
      expect(c.audience).toBe(c.section_path.startsWith('§6') ? 'all' : 'staff');
    for (const c of chunks.filter(audienceOf('ONBOARD'))) {
      const open = c.section_path.startsWith('§4') || c.section_path.startsWith('§6');
      expect(c.audience).toBe(open ? 'all' : 'staff_and_contractors');
    }
  });
});

describe('determinism', () => {
  it('chunks identically on repeated runs', () => {
    expect(chunkCorpus(docs)).toEqual(chunks);
    expect(chunkDocument(byId('PTO'))).toEqual(chunks.filter((c) => c.doc_id === 'PTO'));
  });

  it('corpus hash is stable and sensitive to content', () => {
    expect(corpusHash(docs)).toBe(corpusHash([...docs].reverse()));
    const edited = docs.map((d) => (d.doc_id === 'PTO' ? { ...d, markdown: `${d.markdown} ` } : d));
    expect(corpusHash(edited)).not.toBe(corpusHash(docs));
  });

  it('matches the committed chunk-hash snapshot', () => {
    // If this fails on purpose (corpus or chunker changed), bump CHUNKER_VERSION when boundaries
    // moved, then `vitest -u` and review the diff: every changed line is a citation that moved.
    const hashes = Object.fromEntries(chunks.map((c) => [c.chunk_id, c.content_hash]));
    expect({
      chunker: CHUNKER_VERSION,
      corpus_hash: corpusHash(docs),
      chunk_count: chunks.length,
      hashes,
    }).toMatchSnapshot();
  });
});
