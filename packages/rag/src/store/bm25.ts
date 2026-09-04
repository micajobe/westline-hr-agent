import MiniSearch, { type SearchResult } from 'minisearch';
import type { Chunk } from '../types.js';

/** The subset of chunk fields the lexical index needs. Kept small: the SQLite table is the record. */
export interface Bm25Doc {
  chunk_id: string;
  doc_id: string;
  title: string;
  section_path: string;
  section_title: string;
  audience: string;
  text: string;
}

export interface Bm25Hit {
  chunk_id: string;
  score: number;
}

export interface Bm25SearchOptions {
  k: number;
  /** Return only chunks this predicate accepts. Evaluated before the top-k cut, not after. */
  filter?: (doc: Bm25Doc) => boolean;
}

const FIELDS: (keyof Bm25Doc)[] = ['text', 'section_title', 'title'];
const STORE_FIELDS: (keyof Bm25Doc)[] = ['doc_id', 'section_path', 'audience'];

/**
 * BM25 side of hybrid retrieval, on MiniSearch. Section and document titles are indexed with a
 * boost so a query that names a policy ("expense policy for creators") lands in that document even
 * when the body never repeats the title's words. Serialised into the same SQLite file as the
 * vectors so the index is one artifact with one hash.
 */
export class Bm25Index {
  private constructor(private readonly ms: MiniSearch<Bm25Doc>) {}

  static build(chunks: Chunk[]): Bm25Index {
    const ms = Bm25Index.newMiniSearch();
    ms.addAll(
      chunks.map((c) => ({
        chunk_id: c.chunk_id,
        doc_id: c.doc_id,
        title: c.title,
        section_path: c.section_path,
        section_title: c.section_title,
        audience: c.audience,
        text: c.text,
      })),
    );
    return new Bm25Index(ms);
  }

  static fromJSON(json: string): Bm25Index {
    return new Bm25Index(MiniSearch.loadJSON<Bm25Doc>(json, Bm25Index.options()));
  }

  toJSON(): string {
    return JSON.stringify(this.ms.toJSON());
  }

  get size(): number {
    return this.ms.documentCount;
  }

  search(query: string, opts: Bm25SearchOptions): Bm25Hit[] {
    const results: SearchResult[] = this.ms.search(query, {
      ...(opts.filter ? { filter: (r) => opts.filter!(r as unknown as Bm25Doc) } : {}),
    });
    return results.slice(0, opts.k).map((r) => ({ chunk_id: String(r.id), score: r.score }));
  }

  private static options() {
    return {
      idField: 'chunk_id' as const,
      fields: FIELDS,
      storeFields: STORE_FIELDS,
      tokenize: bm25Tokenize,
      processTerm: bm25ProcessTerm,
      searchOptions: {
        boost: { section_title: 2, title: 1.5 },
        prefix: (term: string) => term.length >= 4,
        fuzzy: (term: string) => (term.length >= 6 ? 0.15 : false),
        combineWith: 'OR' as const,
      },
    };
  }

  private static newMiniSearch(): MiniSearch<Bm25Doc> {
    return new MiniSearch<Bm25Doc>(Bm25Index.options());
  }
}

const STOPWORDS = new Set(
  (
    'a an and are as at be by can do does for from has have how i if in is it its many much my of on ' +
    'or that the this to was we what when where which who will with you your'
  ).split(' '),
);

/**
 * Normalise one term for both indexing and querying: lower-case, drop stopwords, and fold regular
 * English plurals so "three day vacation" meets "three to five days". Deliberately lighter than a
 * Porter stemmer: policy text is full of terms of art ("notice", "witness") that aggressive
 * stemming would collide.
 */
export function bm25ProcessTerm(term: string): string | null {
  const t = term.toLowerCase();
  if (STOPWORDS.has(t)) return null;
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && /(ches|shes|sses|xes)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us'))
    return t.slice(0, -1);
  return t;
}

/**
 * Tokeniser shared by indexing and querying. Keeps `§3.2` and `3.2` as single tokens so section
 * references in a question match the section path, and splits on everything else non-alphanumeric.
 */
export function bm25Tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}§.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0);
}
