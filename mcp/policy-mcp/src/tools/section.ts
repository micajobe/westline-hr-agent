import { getPolicySection } from '@westline/rag';
import type { PolicyContext } from '../context.js';

export interface SectionArgs {
  acting_person_id: string | null;
  doc_id: string;
  section_path: string;
}

/** `get_policy_section` (PRD §6.1): full text, or a structured NOT_FOUND / FORBIDDEN_AUDIENCE. */
export function getPolicySectionTool(ctx: PolicyContext, args: SectionArgs) {
  const viewer = ctx.people.viewer(args.acting_person_id);
  const result = getPolicySection(ctx.store, viewer, args.doc_id.toUpperCase(), args.section_path);
  if (!result.ok) return { error: result.error, reason: result.reason };
  return result.section;
}
