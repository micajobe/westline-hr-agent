import type { Citation, TraceCitationRef } from '@westline/shared';

/**
 * Everything cited this turn must have come back from a policy tool this turn (PRD §7.1 VERIFY).
 * This registry is filled from tool results and consulted by the verifier; the model only ever sees
 * chunk ids that are in here.
 */
export class CitationRegistry {
  private readonly byId = new Map<string, Citation>();

  add(c: Citation): void {
    if (!this.byId.has(c.chunk_id)) this.byId.set(c.chunk_id, c);
  }

  has(chunk_id: string): boolean {
    return this.byId.has(chunk_id);
  }

  get(chunk_id: string): Citation | undefined {
    return this.byId.get(chunk_id);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  all(): Citation[] {
    return [...this.byId.values()];
  }

  toJSON(): Citation[] {
    return this.all();
  }

  static fromJSON(list: Citation[]): CitationRegistry {
    const r = new CitationRegistry();
    for (const c of list) r.add(c);
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
    const push = (c: Citation) => {
      this.add(c);
      refs.push({ doc_id: c.doc_id, section_path: c.section_path });
    };
    if (Array.isArray(r.results)) {
      for (const h of r.results) if (h?.chunk_id) push({ chunk_id: h.chunk_id, doc_id: h.doc_id, title: h.title, section_path: h.section_path, snippet: h.snippet ?? '' });
    }
    if (Array.isArray(r.rules)) {
      for (const h of r.rules) if (h?.chunk_id) push({ chunk_id: h.chunk_id, doc_id: h.doc_id, title: h.doc_id, section_path: h.section_path, snippet: h.snippet ?? h.rule ?? '' });
    }
    if (tool.endsWith('get_policy_section') && r.doc_id && r.section_path && typeof r.text === 'string') {
      push({ chunk_id: sectionChunkId(r.doc_id, r.section_path), doc_id: r.doc_id, title: r.title ?? r.doc_id, section_path: r.section_path, snippet: r.text.slice(0, 240) });
    }
    if (tool.endsWith('get_policy_applicability') && r.source?.doc_id) {
      push({ chunk_id: sectionChunkId(r.source.doc_id, r.source.section_path), doc_id: r.source.doc_id, title: 'Westline Employee Handbook', section_path: r.source.section_path, snippet: 'Policy applicability matrix: which documents bind each workforce class.' });
    }
    return refs;
  }
}

export const sectionChunkId = (doc_id: string, section_path: string): string => `${doc_id}#${section_path}#s`;
