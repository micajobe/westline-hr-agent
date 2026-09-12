import { effectiveAudience, parseSections, sectionOwnBody } from '../ingest/headings.js';
import { assignCategories } from '../ingest/categories.js';
import type { IndexStore } from '../store/sqlite.js';
import type {
  DocumentSection,
  DocumentView,
  LibraryCategory,
  LibrarySection,
  LibraryDocument,
  LoadedDocument,
  PolicyCategory,
  PolicyLibrary,
  Section,
  Viewer,
} from '../types.js';
import { canRead } from './audience.js';

/**
 * The categorised table of contents behind the Handbook tab. Same audience rule as retrieval
 * (PRD §6.1, ADR 0008): a section the viewer's class and scope do not cover is listed but never
 * opened, and a document whose every section is closed is reported in `withheld_doc_ids` rather
 * than quietly dropped -- HANDBOOK §2 already tells everyone which documents exist.
 */
export function buildLibrary(
  store: IndexStore,
  viewer: Viewer,
  categories: readonly PolicyCategory[],
): PolicyLibrary {
  const docs = store
    .documentIds()
    .map((id) => store.getDocument(id))
    .filter((d): d is LoadedDocument => Boolean(d));
  const byId = new Map(docs.map((d) => [d.doc_id, d]));

  const assigned = assignCategories(
    categories,
    docs.map((d) => ({ doc_id: d.doc_id, owner: d.front_matter.owner })),
  );

  const withheld_doc_ids: string[] = [];
  let readable_doc_count = 0;
  const out: LibraryCategory[] = assigned.map((c) => ({
    ...c,
    documents: c.doc_ids.flatMap((id) => {
      const doc = byId.get(id);
      if (!doc) return [];
      const entry = libraryDocument(doc, viewer);
      if (entry.readable) readable_doc_count += 1;
      else withheld_doc_ids.push(entry.doc_id);
      return [entry];
    }),
  }));

  return {
    categories: out,
    viewer,
    withheld_doc_ids,
    doc_count: docs.length,
    readable_doc_count,
  };
}

/**
 * One document opened for reading. Each section carries its *own* body, with descendants excluded,
 * so rendering the list top to bottom reproduces the document exactly once -- `parseSections` gives
 * a `##` section the text of its `###` children too, which would otherwise print twice.
 */
export function buildDocumentView(
  store: IndexStore,
  viewer: Viewer,
  doc_id: string,
): DocumentView | undefined {
  const doc = store.getDocument(doc_id);
  if (!doc) return undefined;
  const sections = parseSections(doc.markdown);
  const fm = doc.front_matter;

  let withheld_section_count = 0;
  const views: DocumentSection[] = sections.map((s, i) => {
    const meta = librarySection(s, doc, viewer);
    if (!meta.readable) {
      withheld_section_count += 1;
      return { ...meta, text: null, withheld_reason: forbidden(doc_id, meta) };
    }
    return { ...meta, text: sectionOwnBody(doc.markdown, s, sections[i + 1]), withheld_reason: null };
  });

  const docReadable = canRead(fm.audience, viewer);
  return {
    doc_id: doc.doc_id,
    title: doc.title,
    source_format: doc.source_format,
    version: fm.version,
    effective_date: fm.effective_date,
    owner: fm.owner,
    audience: fm.audience,
    preamble: docReadable ? preamble(doc.markdown, sections[0]) : null,
    sections: views,
    withheld_section_count,
  };
}

function libraryDocument(doc: LoadedDocument, viewer: Viewer): LibraryDocument {
  const sections = parseSections(doc.markdown).map((s) => librarySection(s, doc, viewer));
  const readable_section_count = sections.filter((s) => s.readable).length;
  const fm = doc.front_matter;
  return {
    doc_id: doc.doc_id,
    title: doc.title,
    source_format: doc.source_format,
    version: fm.version,
    effective_date: fm.effective_date,
    owner: fm.owner,
    audience: fm.audience,
    readable: readable_section_count > 0,
    section_count: sections.length,
    readable_section_count,
    sections,
  };
}

function librarySection(s: Section, doc: LoadedDocument, viewer: Viewer): LibrarySection {
  const audience = effectiveAudience(
    s.section_path,
    doc.front_matter.audience,
    doc.front_matter.section_audience_overrides,
  );
  return {
    section_path: s.section_path,
    section_title: s.section_title,
    level: s.level,
    audience,
    readable: canRead(audience, viewer),
  };
}

/** Wording matched to `getPolicySection`, so the two refusals read the same to a user. */
function forbidden(doc_id: string, s: LibrarySection): string {
  return `${doc_id} ${s.section_path} is tagged ${s.audience}; not available to this reader`;
}

/** The unnumbered lede under the `#` title -- usually the "who this binds" paragraph. */
function preamble(markdown: string, first: Section | undefined): string | null {
  const body = markdown.slice(0, first ? first.heading_offset : markdown.length);
  const text = body.replace(/^#\s+.*$/m, '').trim();
  return text.length > 0 ? text : null;
}
