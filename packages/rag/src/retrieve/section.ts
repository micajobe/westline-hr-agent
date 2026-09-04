import type { Audience } from '@westline/shared';
import type { IndexStore } from '../store/sqlite.js';
import type { Viewer } from '../types.js';
import { canRead } from './audience.js';

export interface PolicySection {
  doc_id: string;
  title: string;
  section_path: string;
  section_title: string;
  text: string;
  audience: Audience;
  effective_date: string;
}

export type PolicySectionResult =
  | { ok: true; section: PolicySection }
  | { ok: false; error: 'NOT_FOUND' | 'FORBIDDEN_AUDIENCE'; reason: string };

/**
 * `get_policy_section` semantics (PRD §6.1): the section's full text, reconstructed from the stored
 * document rather than by concatenating overlapping chunks, and refused -- not hidden -- when the
 * viewer's audience does not cover it. NOT_FOUND is checked first so a forbidden reader cannot probe
 * which section numbers exist, but a section they *may* read is never masked as missing.
 */
export function getPolicySection(
  store: IndexStore,
  viewer: Viewer,
  doc_id: string,
  section_path: string,
): PolicySectionResult {
  const path = section_path.startsWith('§') ? section_path : `§${section_path}`;
  const section = store.getSection(doc_id, path);
  if (!section) {
    return { ok: false, error: 'NOT_FOUND', reason: `${doc_id} has no section ${path}` };
  }
  if (!canRead(section.audience, viewer)) {
    return {
      ok: false,
      error: 'FORBIDDEN_AUDIENCE',
      reason: `${doc_id} ${path} is tagged ${section.audience}; not available to this reader`,
    };
  }
  return { ok: true, section };
}
