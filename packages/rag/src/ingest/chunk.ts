import { sha256 } from '@westline/shared';
import { effectiveAudience, leafUnits, parseSections, type ChunkUnit } from './headings.js';
import type { Chunk, LoadedDocument } from '../types.js';

/**
 * Bump when chunk boundaries or ids would change for an unchanged corpus. Recorded in
 * `index.meta.json` so a stale index is rebuilt even though the corpus hash matches.
 */
export const CHUNKER_VERSION = 'heading-aware/1';

/** PRD §4.3: ~450 tokens per chunk, 60-token overlap, tokens approximated as chars/4. */
export const CHARS_PER_TOKEN = 4;
export const MAX_CHUNK_TOKENS = 450;
export const OVERLAP_TOKENS = 60;
export const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;
export const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;
export const SNIPPET_CHARS = 240;

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

/**
 * Heading-aware chunking: one chunk per leaf section (plus substantive parent preambles), and a
 * windowed split with overlap only when a section is longer than the budget. Deterministic by
 * construction -- no randomness, no clock, no dependence on iteration order of anything unsorted.
 *
 * Invariant enforced by `tests/ingest.test.ts`: `doc.markdown.slice(char_start, char_end) === text`.
 */
export function chunkDocument(doc: LoadedDocument, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? MAX_CHUNK_CHARS;
  const overlapChars = opts.overlapChars ?? OVERLAP_CHARS;
  const chunks: Chunk[] = [];

  for (const unit of leafUnits(parseSections(doc.markdown))) {
    const windows = splitUnit(unit, maxChars, overlapChars);
    const audience = effectiveAudience(
      unit.section_path,
      doc.front_matter.audience,
      doc.front_matter.section_audience_overrides,
    );
    windows.forEach((w, chunk_index) => {
      chunks.push({
        chunk_id: `${doc.doc_id}#${unit.section_path}#${chunk_index}`,
        doc_id: doc.doc_id,
        title: doc.title,
        section_path: unit.section_path,
        section_title: unit.section_title,
        chunk_index,
        source_format: doc.source_format,
        audience,
        char_start: w.start,
        char_end: w.end,
        snippet: makeSnippet(w.text),
        content_hash: sha256(w.text),
        text: w.text,
      });
    });
  }
  return chunks;
}

export function chunkCorpus(docs: LoadedDocument[], opts: ChunkOptions = {}): Chunk[] {
  return [...docs]
    .sort((a, b) => a.doc_id.localeCompare(b.doc_id))
    .flatMap((d) => chunkDocument(d, opts));
}

/**
 * Hash of the corpus as the chunker sees it: every document's id and normalised markdown, in
 * doc_id order. `index:build` compares this with `index.meta.json` to decide whether to rebuild.
 */
export function corpusHash(docs: LoadedDocument[]): string {
  const parts = [...docs]
    .sort((a, b) => a.doc_id.localeCompare(b.doc_id))
    .map((d) => `${d.doc_id}\n${sha256(d.markdown)}`);
  return sha256(parts.join('\n'));
}

interface Window {
  text: string;
  start: number;
  end: number;
}

/**
 * Split one section into windows of at most `maxChars`, preferring paragraph boundaries, then
 * sentence boundaries, then whitespace. Each window after the first begins with the trailing
 * `overlapChars` of the previous one (snapped to a word boundary) so a rule that straddles the cut
 * is present in full in at least one chunk.
 */
function splitUnit(unit: ChunkUnit, maxChars: number, overlapChars: number): Window[] {
  const text = unit.text;
  const base = unit.char_start;
  if (text.length <= maxChars) return [{ text, start: base, end: base + text.length }];

  const windows: Window[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) end = pickBreak(text, start, end);

    // Trim whitespace at both edges without breaking the slice invariant.
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) windows.push({ text: text.slice(s, e), start: base + s, end: base + e });

    if (end >= text.length) break;
    let next = Math.max(start + 1, end - overlapChars);
    // Snap the overlap start forward to a word boundary so the chunk never begins mid-word.
    while (next < end && !/\s/.test(text[next - 1]!)) next++;
    start = next;
  }
  return windows;
}

/** Best break position in (start, limit]: last paragraph break, else sentence end, else space. */
function pickBreak(text: string, start: number, limit: number): number {
  const floor = start + Math.floor((limit - start) / 2); // never shrink a window below half
  const slice = text.slice(start, limit);

  const para = slice.lastIndexOf('\n\n');
  if (para > 0 && start + para >= floor) return start + para;

  const sentence = lastMatchEnd(slice, /[.!?]["')\]]?(?=\s)/g);
  if (sentence > 0 && start + sentence >= floor) return start + sentence;

  const space = slice.lastIndexOf(' ');
  if (space > 0 && start + space >= floor) return start + space;

  return limit;
}

function lastMatchEnd(s: string, re: RegExp): number {
  let last = -1;
  for (const m of s.matchAll(re)) last = m.index + m[0].length;
  return last;
}

/** First 240 characters, whitespace collapsed, so a citation card reads as one line. */
export function makeSnippet(text: string, max = SNIPPET_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
