import {
  buildDocumentView,
  buildLibrary,
  type ApplicabilityRow,
  type DocumentView,
  type PolicyLibrary,
} from '@westline/rag';
import type { WorkforceClass } from '@westline/shared';
import type { PolicyContext } from './context.js';

/**
 * Read-only browse over the corpus, for the app's Handbook tab. This is not an MCP tool and the
 * agent never calls it -- it is served over the host's HTTP routes the way `/desk` is (ADR 0011) --
 * but it lives here because CLAUDE.md puts audience filtering inside `policy-mcp` and nowhere else.
 * `buildLibrary` and `buildDocumentView` apply exactly the filter retrieval applies.
 */
export interface LibraryView extends PolicyLibrary {
  workforce_class: WorkforceClass | null;
  /** HANDBOOK §2 row per doc_id for this viewer's class: full / partial (§n) / none, with the note. */
  applicability: Record<string, ApplicabilityRow>;
}

export interface DocumentReadView extends DocumentView {
  /** Null for an anonymous reader, who has no class and so no row in the matrix. */
  applicability: ApplicabilityRow | null;
}

export function listPolicyLibrary(ctx: PolicyContext, acting_person_id: string | null): LibraryView {
  const viewer = ctx.people.viewer(acting_person_id);
  const library = buildLibrary(ctx.store, viewer, ctx.categories);
  return { ...library, workforce_class: viewer.workforce_class, applicability: rowsFor(ctx, viewer.workforce_class) };
}

export type DocumentReadResult =
  | { ok: true; document: DocumentReadView }
  | { ok: false; error: 'NOT_FOUND' | 'FORBIDDEN_AUDIENCE'; reason: string };

export function readPolicyDocument(
  ctx: PolicyContext,
  acting_person_id: string | null,
  doc_id: string,
): DocumentReadResult {
  const viewer = ctx.people.viewer(acting_person_id);
  const id = doc_id.toUpperCase();
  const view = buildDocumentView(ctx.store, viewer, id);
  if (!view) return { ok: false, error: 'NOT_FOUND', reason: `no policy document ${id}` };
  // Every section closed means the document itself is closed -- refused, not served empty, so the
  // reading view and `get_policy_section` agree about what this reader may see.
  if (view.sections.length > 0 && view.sections.every((s) => !s.readable)) {
    return {
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
      reason: `${id} is tagged ${view.audience}; not available to this reader`,
    };
  }
  const rows = rowsFor(ctx, viewer.workforce_class);
  return { ok: true, document: { ...view, applicability: rows[id] ?? null } };
}

function rowsFor(ctx: PolicyContext, cls: WorkforceClass | null): Record<string, ApplicabilityRow> {
  if (!cls) return {};
  return Object.fromEntries(ctx.applicability[cls].map((r) => [r.doc_id, r]));
}
