import type { Audience, Scope, WorkforceClass } from '@westline/shared';

export type SourceFormat = 'md' | 'html' | 'pdf';

export interface DocumentFrontMatter {
  doc_id: string;
  title: string;
  version: string;
  effective_date: string;
  owner: string;
  audience: Audience;
  /** Section path prefix (`§7`) to the audience that overrides the document's own. */
  section_audience_overrides?: Record<string, Audience>;
}

export interface LoadedDocument {
  doc_id: string;
  title: string;
  source_format: SourceFormat;
  /** Path relative to the repo root, for provenance. */
  path: string;
  front_matter: DocumentFrontMatter;
  /** Every format is normalised to markdown before chunking. */
  markdown: string;
}

export interface Section {
  /** `§3` or `§3.2`. Stable across minor versions -- see HANDBOOK §3.2. */
  section_path: string;
  section_title: string;
  level: number;
  /** Offset of the heading line itself; the body runs from `char_start`. */
  heading_offset: number;
  text: string;
  char_start: number;
  char_end: number;
}

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  title: string;
  section_path: string;
  section_title: string;
  chunk_index: number;
  source_format: SourceFormat;
  /** Effective audience: the document's, unless a section override is more specific. */
  audience: Audience;
  char_start: number;
  char_end: number;
  snippet: string;
  content_hash: string;
  text: string;
}

export interface IndexMeta {
  corpus_hash: string;
  doc_count: number;
  chunk_count: number;
  embedding_model: string;
  embedding_dimensions: number;
  chunker: string;
  built_at: string;
}

export interface RetrievedChunk {
  chunk_id: string;
  doc_id: string;
  title: string;
  section_path: string;
  section_title: string;
  snippet: string;
  text: string;
  score: number;
  source_format: SourceFormat;
}

export type RetrievalMode = 'hybrid' | 'vector' | 'bm25';

export interface RetrievalOptions {
  query: string;
  k?: number;
  mode?: RetrievalMode;
  doc_ids?: string[];
  section_prefix?: string;
  /** Prior user queries in this conversation, newest last. Drives follow-up rewriting. */
  prior_queries?: string[];
  rerank?: boolean;
}

/** Who is asking. Audience filtering is a function of these two fields and nothing else. */
export interface Viewer {
  workforce_class: WorkforceClass | null;
  scope: Scope | null;
}

export interface RetrievalResponse {
  results: RetrievedChunk[];
  withheld_by_audience: boolean;
  withheld_doc_ids: string[];
  retrieval: {
    mode: RetrievalMode;
    k: number;
    rerank: boolean;
    rewritten_query?: string;
    candidates_considered: number;
    candidates_after_audience_filter: number;
  };
}

/** Parsed from HANDBOOK §2 at index-build time. */
export interface ApplicabilityRow {
  doc_id: string;
  title: string;
  scope: 'full' | 'partial' | 'none';
  sections?: string[];
  note: string;
}

export type ApplicabilityMatrix = Record<WorkforceClass, ApplicabilityRow[]>;

/** Parsed from HANDBOOK §4 "Who owns what": the browse taxonomy behind the Handbook tab. */
export interface PolicyCategory {
  /** The `Area` cell, e.g. "Editorial standards and disclosure". */
  area: string;
  owner: string;
  doc_ids: string[];
}

/** One numbered section as the browse listing sees it. No text: the listing is a table of contents. */
export interface LibrarySection {
  section_path: string;
  section_title: string;
  level: number;
  /** Effective audience after `section_audience_overrides`. */
  audience: Audience;
  /** False when this viewer's class and scope do not cover `audience`. */
  readable: boolean;
}

export interface LibraryDocument {
  doc_id: string;
  title: string;
  source_format: SourceFormat;
  version: string;
  effective_date: string;
  owner: string;
  audience: Audience;
  /** True when at least one section is readable -- `BENEFITS` §6 opens the door for contractors. */
  readable: boolean;
  section_count: number;
  readable_section_count: number;
  sections: LibrarySection[];
}

export interface LibraryCategory extends PolicyCategory {
  documents: LibraryDocument[];
}

export interface PolicyLibrary {
  categories: LibraryCategory[];
  viewer: Viewer;
  /** Documents whose every section is closed to this viewer. Named, never hidden: HANDBOOK §2 is public. */
  withheld_doc_ids: string[];
  doc_count: number;
  readable_doc_count: number;
}

/** A section in the reading view: its own body only, children excluded, text present iff readable. */
export interface DocumentSection extends LibrarySection {
  text: string | null;
  /** Set when `text` is null, in the shape of `getPolicySection`'s FORBIDDEN_AUDIENCE reason. */
  withheld_reason: string | null;
}

export interface DocumentView {
  doc_id: string;
  title: string;
  source_format: SourceFormat;
  version: string;
  effective_date: string;
  owner: string;
  audience: Audience;
  /** Text under the document's `#` title, before the first numbered section. Null when withheld. */
  preamble: string | null;
  sections: DocumentSection[];
  withheld_section_count: number;
}
