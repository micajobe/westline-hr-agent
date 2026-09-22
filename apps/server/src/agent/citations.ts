import type { Citation, TraceCitationRef } from '@westline/shared';

/** A citation as the registry keeps it: the §7.3 `Citation` plus the full chunk text, which never enters the answer. */
export type StoredCitation = Citation & { text?: string };

/**
 * Everything cited this turn must have come back from a policy tool this turn (PRD §7.1 VERIFY).
 * This registry is filled from tool results and consulted by the verifier; the model only ever sees
 * chunk ids that are in here. Full chunk text is kept alongside each citation (server-internal) so
 * semantic verification (ADR 0019) can judge the passage rather than the 240-character snippet.
 */
export class CitationRegistry {
  private readonly byId = new Map<string, Citation>();
  private readonly texts = new Map<string, string>();

  add(c: Citation, text?: string): void {
    if (!this.byId.has(c.chunk_id)) this.byId.set(c.chunk_id, c);
    if (text && !this.texts.has(c.chunk_id)) this.texts.set(c.chunk_id, text);
  }

  has(chunk_id: string): boolean {
    return this.byId.has(chunk_id);
  }

  /** The §7.3 citation only -- safe to copy into an answer. */
  get(chunk_id: string): Citation | undefined {
    return this.byId.get(chunk_id);
  }

  /** Full chunk text when the tool returned it; undefined for synthetic or text-less citations. */
  textOf(chunk_id: string): string | undefined {
    return this.texts.get(chunk_id);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  all(): Citation[] {
    return [...this.byId.values()];
  }

  toJSON(): StoredCitation[] {
    return this.all().map((c) => {
      const text = this.texts.get(c.chunk_id);
      return text ? { ...c, text } : c;
    });
  }

  static fromJSON(list: StoredCitation[]): CitationRegistry {
    const r = new CitationRegistry();
    for (const { text, ...c } of list) r.add(c, text);
    return r;
  }

  /**
   * Pull citable chunks out of a policy tool result, whatever its shape: search `results[]`,
   * compliance `rules[]`, or a single section (given a synthetic `<DOC>#<§n>#s` id so it can be cited).
   * Returns the trace-level refs for the `retrieval` event.
   */
  ingest(tool: string, result: unknown): TraceCitationRef[] {
    if (!result || typeof result !== 'object') return [];
    const r = result as Record<string, any>;
    const refs: TraceCitationRef[] = [];
    const push = (c: Citation, text?: unknown) => {
      this.add(c, typeof text === 'string' && text.length > 0 ? text : undefined);
      refs.push({ doc_id: c.doc_id, section_path: c.section_path });
    };
    if (Array.isArray(r.results)) {
      for (const h of r.results) if (h?.chunk_id) push({ chunk_id: h.chunk_id, doc_id: h.doc_id, title: h.title, section_path: h.section_path, snippet: h.snippet ?? '' }, h.text);
    }
    if (Array.isArray(r.rules)) {
      for (const h of r.rules) if (h?.chunk_id) push({ chunk_id: h.chunk_id, doc_id: h.doc_id, title: h.doc_id, section_path: h.section_path, snippet: h.snippet ?? h.rule ?? '' }, h.text);
    }
    if (tool.endsWith('get_policy_section') && r.doc_id && r.section_path && typeof r.text === 'string') {
      push({ chunk_id: sectionChunkId(r.doc_id, r.section_path), doc_id: r.doc_id, title: r.title ?? r.doc_id, section_path: r.section_path, snippet: r.text.slice(0, 240) }, r.text);
    }
    if (tool.endsWith('get_policy_applicability') && r.source?.doc_id) {
      push({ chunk_id: sectionChunkId(r.source.doc_id, r.source.section_path), doc_id: r.source.doc_id, title: 'Westline Employee Handbook', section_path: r.source.section_path, snippet: 'Policy applicability matrix: which documents bind each workforce class.' });
    }
    return refs;
  }
}

export const sectionChunkId = (doc_id: string, section_path: string): string => `${doc_id}#${section_path}#s`;
