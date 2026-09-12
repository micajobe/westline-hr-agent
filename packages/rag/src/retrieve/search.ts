import { effectiveAudience, parseSections, sectionOwnBody } from '../ingest/headings.js';
import type { IndexStore } from '../store/sqlite.js';
import type { LibrarySearch, LibrarySearchHit, LoadedDocument, Section, Viewer } from '../types.js';
import { canRead } from './audience.js';

/** Chars of context around the best match. Two lines in the 300px contents rail. */
const SNIPPET_CHARS = 190;
const DEFAULT_LIMIT = 40;

/** Title hits outrank body hits: a query naming a section usually means that section, not a mention of it. */
const WEIGHT = { body: 1, section_title: 8, doc_title: 4, phrase_body: 25, phrase_title: 40 };

export interface LibrarySearchOptions {
  limit?: number;
}

/**
 * Lexical search over the corpus a section at a time, for the Handbook tab's search field
 * (ADR 0018). Deliberately not the retriever: this answers "which section says this" for a person
 * reading the handbook, so it matches the words typed rather than embedding them, and it ranks
 * sections rather than chunks -- a chunk boundary is an artifact of ingestion and means nothing to
 * a reader.
 *
 * Audience is applied *before* matching, never after: a section this viewer may not open is not
 * searched at all. Filtering after the fact would let a snippet -- or the mere fact of a hit --
 * report the contents of a closed section. Sections skipped this way are counted into
 * `sections_withheld` so the result says what it did not look at, the way the listing names
 * `withheld_doc_ids` rather than hiding them (ADR 0015).
 */
export function searchLibrary(
  store: IndexStore,
  viewer: Viewer,
  query: string,
  opts: LibrarySearchOptions = {},
): LibrarySearch {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const phrase = query.trim().toLowerCase();
  const terms = tokenize(query);
  if (terms.length === 0) {
    return {
      query,
      terms: [],
      hits: [],
      sections_searched: 0,
      sections_withheld: 0,
      truncated: false,
    };
  }

  const hits: LibrarySearchHit[] = [];
  let sections_searched = 0;
  let sections_withheld = 0;

  for (const doc_id of store.documentIds()) {
    const doc = store.getDocument(doc_id);
    if (!doc) continue;
    const sections = parseSections(doc.markdown);

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!;
      if (!readable(doc, s, viewer)) {
        sections_withheld++;
        continue;
      }
      sections_searched++;
      const body = sectionOwnBody(doc.markdown, s, sections[i + 1]);
      const hit = score(doc, s, body, terms, phrase);
      if (hit) hits.push(hit);
    }
  }

  // Ties broken on doc_id then section order, so the same query always lists in the same order.
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.doc_id.localeCompare(b.doc_id) ||
      comparePaths(a.section_path, b.section_path),
  );

  return {
    query,
    terms,
    hits: hits.slice(0, limit),
    sections_searched,
    sections_withheld,
    truncated: hits.length > limit,
  };
}

function readable(doc: LoadedDocument, s: Section, viewer: Viewer): boolean {
  const audience = effectiveAudience(
    s.section_path,
    doc.front_matter.audience,
    doc.front_matter.section_audience_overrides,
  );
  return canRead(audience, viewer);
}

/**
 * Every term must appear somewhere in the section -- its body, its heading, or its document's title
 * -- so "creator expense receipts" narrows instead of returning everything about expenses. The
 * whole query appearing verbatim scores far above the same words scattered, which gives phrase
 * search without asking a reader to type quotation marks.
 */
function score(
  doc: LoadedDocument,
  s: Section,
  body: string,
  terms: string[],
  phrase: string,
): LibrarySearchHit | null {
  const haystacks = {
    body: body.toLowerCase(),
    section_title: s.section_title.toLowerCase(),
    doc_title: doc.title.toLowerCase(),
  };

  let score = 0;
  for (const term of terms) {
    const inBody = count(haystacks.body, term);
    const inSection = count(haystacks.section_title, term);
    const inDoc = count(haystacks.doc_title, term);
    if (inBody + inSection + inDoc === 0) return null;
    score += inBody * WEIGHT.body + inSection * WEIGHT.section_title + inDoc * WEIGHT.doc_title;
  }

  const phraseAt = haystacks.body.indexOf(phrase);
  if (phraseAt >= 0) score += WEIGHT.phrase_body;
  if (haystacks.section_title.includes(phrase)) score += WEIGHT.phrase_title;

  return {
    doc_id: doc.doc_id,
    doc_title: doc.title,
    section_path: s.section_path,
    section_title: s.section_title,
    level: s.level,
    score,
    snippet: snippet(body, terms, phrase),
  };
}

/** Occurrences of `term` in `haystack`, both already lowercased. */
function count(haystack: string, term: string): number {
  let n = 0;
  for (let at = haystack.indexOf(term); at >= 0; at = haystack.indexOf(term, at + term.length)) n++;
  return n;
}

/**
 * A window of the section around the best match, as one line of plain text. Policy bodies are full
 * of tables, lists and emphasis whose markup carries nothing once the text is a snippet -- and the
 * rail renders the snippet as text, not markdown, so leaving `**` in it would print the asterisks.
 */
function snippet(body: string, terms: string[], phrase: string): string {
  const flat = flatten(body);
  if (flat.length <= SNIPPET_CHARS) return flat;

  // Located in the flattened text, so the window lands on the match rather than near it.
  const lower = flat.toLowerCase();
  const at = lower.includes(phrase) ? lower.indexOf(phrase) : firstTermAt(lower, terms);

  let start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  start = Math.max(0, end - SNIPPET_CHARS);
  // Don't cut a word in half at either edge.
  const head = start > 0 ? nextSpace(flat, start, at) : start;
  const tail = end < flat.length ? Math.max(head + 1, flat.lastIndexOf(' ', end)) : end;
  return `${head > 0 ? '…' : ''}${flat.slice(head, tail).trim()}${tail < flat.length ? '…' : ''}`;
}

/** Markdown reduced to the words it wraps, then collapsed to a single line. */
function flatten(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, ' ') // a table's separator row says nothing
    .replace(/\|/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first word boundary at or after `from`, without stepping past the match itself. */
function nextSpace(text: string, from: number, limit: number): number {
  const space = text.indexOf(' ', from);
  return space >= 0 && space < Math.min(from + 20, limit) ? space + 1 : from;
}

function firstTermAt(lower: string, terms: string[]): number {
  const offsets = terms.map((t) => lower.indexOf(t)).filter((offset) => offset >= 0);
  return offsets.length > 0 ? Math.min(...offsets) : 0;
}

/** Terms are matched as substrings, so `pto` finds `PTO` and `notice` finds `notices`. */
function tokenize(query: string): string[] {
  const raw = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’./-]*/gu) ?? [];
  return [...new Set(raw.map((t) => t.replace(/[./-]+$/, '')).filter((t) => t.length > 1))];
}

/** `§10` sorts after `§9`, which a string compare gets wrong. */
function comparePaths(a: string, b: string): number {
  const na = a.replace('§', '').split('.').map(Number);
  const nb = b.replace('§', '').split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}
